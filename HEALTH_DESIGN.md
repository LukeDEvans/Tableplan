# Apple Health in Liv: design & plan

Status: **BUILT** (2026-11-24, branch `claude/apple-health`; see §11 *As built*). Decisions in §10. Written against `main` @ `11b4938`.

Goal: workouts recorded on Luke's Apple Watch appear in Liv's **Exercise** page on their own. They check off the matching planned workout, fill its log (time, distance, heart rate) and show on the Calendar, with no manual entry. Liv keeps its own copy of the summaries, so the history survives a later move away from Apple.

**No Watch app is planned.** The Watch already saves every workout to Apple Health on the iPhone, and the iPhone app reads it from there. A watch face complication or a Liv Watch app is a separate, later decision (§9).

---

## 1. What exists today

**Exercise page** (Recreate group, `play` section, **Personal only**: `views.js` "Exercise is exclusively individual"):
- `state.workouts[]`: the workout library. Each workout has a kind (`timed` | `reps` | `game`) and `logs[]` (`normalizeWorkoutLogs`, app.js ~6671): date, `timedHours/Minutes/Seconds`, `distanceWhole/Decimal/Unit`, `repWeights`, `setCompletion`, game name/rating/notes, `taskId`.
- `state.playPlans[week][dayId]`: the planned week's tasks, with `done`, `sourceWorkoutId` and `exerciseData`. `upsertWorkoutExecutionLog` writes a log when a planned task is done.
- `exercise-history.js`: History sorts (Date/Time/Distance/Speed, Sets/Heaviest, Rating/Event).
- Planned workouts already show on the Calendar through the app-data index (`planAppDataIndex`).
- Everything is entered by hand today.

**iOS shell:**
- Capacitor 6 with Liv's own Swift plugins (`PhotoLibraryPlugin`, `LiveClockPlugin`, …). No HealthKit capability, entitlement or usage strings.
- `UIBackgroundModes`: audio, fetch.
- **`PhotoSyncEngine.swift`** is the model to copy. It syncs natively without the web view, uses a scoped **device key** kept in the Keychain (never the sign-in), and talks plain HTTP + JSON to a **Supabase edge function** (`supabase/functions/photo-sync`), so any other client could speak the same protocol later.

**Constraints:**
- Apple only exposes Health on the device. Neither the web app nor the laptop can read it; they see whatever the phone has copied into Liv.
- Health data must not be used for ads or sold. A privacy policy is required for App Store review; internal TestFlight doesn't need one, but write it anyway.
- Health rows never go into `tableplan_states`. The one exception is the filed log itself: a filled log carries the workout's summary fields (`healthId`, start/end, avg/max HR, kcal) in Luke's personal `play` section, like any log. None of it goes into AI prompts unless Luke switches that on (§7).
- Keep the Apple-specific part thin, as Photos does: only reading HealthKit is Apple code, and the rest is a portable protocol.

---

## 2. What it reads (v1, decided)

| Data | Used for | Stored in Liv |
|---|---|---|
| **Workouts** (`HKWorkout`): type, start/end, duration, distance, active energy, avg/max heart rate, indoor/outdoor, source device | Exercise logs, Calendar, matching | Summary row per workout |
| **Daily activity rings** (`HKActivitySummary`): move/exercise/stand vs goals | Exercise header, week strip | One small row per day |
| Steps, sleep, resting HR, weight, routes, per-second HR | Later / not planned | No |

Raw samples (second-by-second heart rate, GPS routes) are never copied. Liv stores only the summaries.

---

## 3. Native side

- **`HealthKitPlugin.swift`** (web-facing: authorization, status, "sync now", reading the day's rings for display) plus **`HealthSyncEngine.swift`** (runs without the web view, like `PhotoSyncEngine`).
- Capability **HealthKit** plus **Background Delivery** go into `App.entitlements`. Info.plist gets `NSHealthShareUsageDescription` ("Liv reads your workouts and activity rings to fill in your Exercise log.") and no write permission (read-only, Q5).
- **Incremental reading:** `HKAnchoredObjectQuery` on workouts, with the anchor saved on the device. Each run returns only new or deleted workouts.
- **Background:** `HKObserverQuery` plus `enableBackgroundDelivery(for: workoutType, frequency: .immediate)`. Finishing a workout on the Watch wakes Liv shortly after it syncs to the phone, which uploads the summary. Opening Liv also syncs, at most every 10 minutes, as Photos does.
- **Device key:** setup, done from the open, signed-in app, trades the sign-in for a **health-only device key** (Keychain, this device only, after-first-unlock). The key can only add, update or delete its owner's health summaries, and it can be revoked in Settings.
- Deleting a workout in Apple Health deletes it in Liv (the anchored query reports deletions).

## 4. Server & data

The Supabase edge function **`health-sync`** has the same shape as `photo-sync`: a device-key hash check, then batched upserts. **No Netlify function is involved**, so the sync itself never needs a Netlify deploy.

```sql
create table public.live_health_workouts (
  user_id      uuid not null references auth.users on delete cascade,
  id           text not null,                 -- sha256(device key + HKWorkout UUID)
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  activity     text not null,                 -- portable name: 'run', 'walk', 'cycle', 'strength', 'soccer'…
  indoor       boolean,
  duration_s   integer not null,
  distance_m   numeric,
  energy_kcal  numeric,
  hr_avg       smallint, hr_max smallint,
  source       text,                          -- 'Apple Watch', 'iPhone', other app name
  matched      jsonb,                         -- { filed: true } | { dismissed: true }; null = not filed yet (§5)
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index live_health_workouts_recent on public.live_health_workouts (user_id, started_at desc);

create table public.live_health_days (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  move_kcal numeric, move_goal numeric,
  exercise_min smallint, exercise_goal smallint,
  stand_h smallint, stand_goal smallint,
  primary key (user_id, day)
);
-- RLS: owner only (select/update own rows). Device-key writes only through health-sync. No anon.
```

- `activity` uses Liv's own vocabulary rather than Apple's enum names, so a future Garmin or Android source maps into the same column.
- **Egress:** about one workout a day at roughly 300 bytes, and ring rows about the same. The Exercise page reads a bounded range (`started_at >= now() - 90 days`, explicit `select=`), and history pages in further. This adds well under 1 MB a month.
- Included in Liv's data export (`data-export.js`, Exercise section).

## 5. Matching to the Exercise page

When a Health workout arrives (on the phone, or the next time any device opens Exercise):

1. **Planned the same day?** Look for an unfinished task in `playPlans` for that date whose workout maps to the same activity. A per-workout "Apple Health type" setting is set once and guessed from the name ("Run" → run). If it matches, mark the task **done** and write or merge its log: the time fields from `duration_s`, the distance fields from `distance_m` in the log's unit, plus avg/max HR and calories on the log (new optional fields).
2. **In the library but not planned?** Add a log to that workout, dated that day.
3. **Neither?** It goes to a small **"From Apple Watch"** list at the top of Exercise, where one tap files it to a workout (and teaches the mapping) or dismisses it.

- `reps` workouts (strength) get duration and heart rate only, because Apple has no sets or weights. Luke's set ticks and weights stay manual and are merged into the same log.
- Filing is idempotent twice over: each filled log carries the row's `healthId` (a second device sees it and only marks the row), and filed rows get `matched` so they're never read again.

## 6. What it looks like

- **Exercise header:** today's three rings as small arcs and a 7-day strip. Tapping a day shows that day's workouts.
- **Logs:** a Watch-sourced log gets a small watch glyph. History gains "Avg HR" and "Calories" sorts for `timed` workouts.
- **Calendar:** completed workouts show at their real time (Personal view only), and a planned one turns into the done version instead of appearing twice.
- **Settings › Exercise › Apple Health:** connect / status / last sync / which data / revoke device key / delete all Health data from Liv.
- **Laptop:** sees everything the phone has synced. It can't connect Health, so the setting there reads "Set up on your iPhone".

## 7. Privacy

- Personal view only, for each person. Nothing is shown in Household. Marijane can connect her own phone, and her data is visible only to her.
- Owner-only RLS, device keys that are hashed at rest and can be revoked, and "Delete all Health data from Liv" as a single action.
- **Not sent to AI by default.** Duet and Liv's future assistant get Exercise Health data only through a new assistant switch (next to Finance and Mail), off by default.
- No receipts, finance or other data is joined to health data on the server.

## 8. Build order

1. **Migration** (tables, RLS, device-key table/RPC, the same pattern as Photos). Applied via the Supabase MCP.
2. **`health-sync` edge function**, deployed to Supabase (not a Netlify deploy).
3. **Swift plugin + engine, entitlements, usage strings.** TestFlight build. Luke enables HealthKit on the App ID in the Developer portal (about 2 minutes).
4. **Web:** Settings connect flow, matching (§5), Exercise header and log glyph. These ship in the same TestFlight build for the phone. The laptop web app picks them up in the **next batched Netlify deploy**.
5. **Backfill** of past workouts (see Q4) on first connect.

**Tests:** vitest for activity mapping, matching (planned / library / unmatched, idempotent across two devices, deletion), unit conversion, ring parsing; edge-function tests for device-key scope (can't touch another user's rows or other tables); an egress guard (no health code touches `tableplan_states`).
**Manual (iPhone):** finish a Watch run with Liv closed, then confirm it's in Exercise and the planned run is ticked; delete it in Health, then confirm it's gone; revoke the key, then confirm syncing stops.

## 9. Later, not in v1

- **Watch complication / Watch app:** next event, tonight's dinner, today's planned workout. Needs a SwiftUI watchOS target, which is a separate decision.
- **Starting a Liv workout from the Watch:** only worth it if Apple's Workout app proves limiting.
- Sleep, resting HR, weight and steps; route maps for runs and rides.

---

## 10. Decisions (answered one at a time, 2026-11-24)

1. ~~What to read in v1~~ **Decided (2026-11-24): workouts plus daily activity rings**, as in §2.
2. ~~Unmatched Watch workouts~~ **Decided (2026-11-24): the "From Apple Watch" inbox**, as in §5 step 3. Filing one teaches the mapping, so later workouts of that type file themselves.
3. ~~Where the copy lives~~ **Decided (2026-11-24): summaries in Luke's Liv account (Supabase)**, as in §4. No raw samples or routes; the laptop sees the history, and it survives a move away from Apple.
4. ~~Backfill~~ **Decided (2026-11-24): import all past workouts and rings on first connect**, filed by the same §5 rules. Past unmatched workouts land in the inbox grouped by activity type, so one tap files every past workout of that type. The import runs in batches through `health-sync` and can stop and resume, like the Photos first sync.
5. ~~Write back to Health~~ **Decided (2026-11-24): no, read-only, probably never.** Luke doesn't really use the Apple Health app itself; Liv is where he looks. Liv-only workouts stay in Liv. No `NSHealthUpdateUsageDescription`.
6. ~~Assistant access~~ **Decided (2026-11-24): an "Exercise health data" assistant switch, off by default**, next to the Finance and Mail switches (§7). While it's off, Duet and Liv's assistant see planned workouts and hand-entered logs, but no Watch-sourced fields (HR, calories, rings, `live_health_*` rows).
7. ~~Who gets it~~ **Decided (2026-11-24): Luke only for now.** "Connect Apple Health" shows only for Luke's account until it has run well for a few weeks. Opening it to Marijane or other family members later is a single switch, since the data is already private to each person.


---

## 11. As built (2026-11-24)

**Database** (`migrations/2026-11-24c-health.sql`, applied 2026-11-24 via `execute_sql`, schema_migrations `20261124120000`):
- `health_sync_devices`, `live_health_workouts`, `live_health_days`, with RLS (owner only) plus `require_mfa_when_enrolled` on all three.
- `health_sync_register` / `health_sync_device` / `health_sync_put` are callable by `service_role` only.
- Signed-in owners can select and delete their own rows, update only `matched`, and only revoke devices. Anon has nothing.
- Checked live: grants and privileges as above, and the 3 tables start empty. A rolled-back run put a workout and a ring day, re-put the workout (it kept its `matched`), deleted it, and saw a wrong secret refused (42501).

**Sync service** (`supabase/functions/health-sync`, deployed version 1, `verify_jwt` off because it checks sign-in and device keys itself):
- `register` (with the sign-in) and `put` (with `x-health-device`).
- Checked live: an unknown device gets 401, no sign-in gets 401, and a malformed workout gets 400.

**iPhone** (`HealthSyncEngine.swift`, `LiveHealthPlugin.swift` registered as `LiveHealth`):
- HealthKit plus background-delivery entitlements, and `NSHealthShareUsageDescription`. There's no write permission.
- At launch, `AppDelegate` starts the workout observer query, which uses `.immediate` background delivery. `SceneDelegate` syncs on open, at most every 10 minutes.
- Workouts come through an anchored query in batches of 200. The anchor is saved only after the server has the batch.
- Rings are read from 2015 on the first run, in 400-day chunks with a resume point, then from 2 days back on each later run.
- A workout's id is `sha256("live-health-workout|<device key>|<HK uuid>")`, first 32 hex characters.

**Web** (`health-workouts.js` pure, wired in app.js "Apple Health"):
- Exercise shows today's rings, a 7-day strip and the "From Apple Watch" inbox button. Tapping today's rings opens Settings › Apple Health, which is also in Exercise's gear menu.
- Reads happen only while Exercise is open, at most every 10 minutes: unfiled rows (`matched=is.null`, ≤1000) and the last 8 days of rings.
- Filing ticks the planned task when there is one. It merges into the single hand-entered log that day if there is one, and otherwise adds a log. The distance is in the unit of the workout's last distance log, or miles.
- The inbox closes by itself when it's empty. Filing a kind makes a "new workout" or teaches an existing one (`workout.healthActivity`, one workout per activity).
- History shows a ⌚ line on Watch logs and offers Avg HR and Calories sorts when any log has them. Calendar shows Watch logs at their real times.
- Settings › Beta › Assistant has "Assistant can read Exercise health data" (`aiSettings.assistantHealthRead`, off; only an explicit true counts). While it's off, the assistant's workout context leaves out Watch-filled logs.
- The data export adds `health_workouts.csv` and `health_rings.csv`. "Delete All Health Data from Liv" turns off the phone, revokes keys and deletes both tables' rows; filled logs stay.
- **Luke only:** `healthEnabledForUser()` requires the admin.

**Verified:** `test/exercise-health.test.js` (17), new history-sort tests and the full suite (4397) all pass. The boot check passes. `scripts/qa-health.mjs` runs the real Exercise page at 360px with fake rows and passes 18/18. It covers the planned run ticked and filled in km with heart rate and start time, an older run filed to the library, the inbox with 3 entries grouped newest first, filing swims into a new "Swim", dismissing yoga closing the window, rows marked, and the history ⌚ lines and sorts.

**Not verified yet (needs the iPhone):**
- The Swift code has only been compiled by CI, not run.
- HealthKit's permission sheet, background delivery with Liv closed, the full first import on real data, and the rings matching the Fitness app.

**Before the TestFlight build:** HealthKit must be turned on for the App ID `com.mrlukedevans.live` (developer.apple.com › Identifiers). Otherwise App Store signing refuses the new entitlement.
