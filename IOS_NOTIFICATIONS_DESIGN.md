# iPhone app notifications — design & plan

Status: **APPROVED DIRECTION** (Luke, 2026-10-13). Build all three phases, retire the briefing entirely, and stay well inside Supabase egress. **Phase 1 merged (PR #95) and deployed 2026-10-13, migration applied; needs a TestFlight build for the iPhone part.** Written against `main` @ `8bb21b9`.

Goal: the TestFlight app on the iPhone shows real iOS notifications, both for what the phone already knows about (event reminders) and for what happens elsewhere (a dropped connection, a reminder set on another device). **The app becomes the source of reminders**, including for Google-calendar events, so Luke can see exactly what the app sends while working toward dropping Google.

---

## 1. What exists today (findings)

**Web Push is already half-built, but for browsers only.**
- `live_push_subscriptions` (RLS on, `user_id` index), `push-subscribe.js` (upsert/delete), and `sw.js` (`push` + `notificationclick`) all exist.
- **The only sender is the daily briefing**, at the end of `daily-briefing.js`.

**`daily-briefing.js` does more than the briefing.** Its handler (`0 13 * * *`) runs:
1. `cleanupOldTtsAudio()`;
2. `snapshotFinanceBalances()`: SimpleFIN pull, durable-store ingest, finance backup. **This must keep running.**
3. The briefing:
   - it reads up to 20 `tableplan_states` rows plus household state;
   - it calls Claude;
   - it pushes to **every subscription across all users** (no `user_id` filter).

**Briefing surfaces in the client** (all being removed, §3):
- Home: `#homeBriefing` panel (index.html ~248) with AI text, refresh, and the Calendar/To-do glance panels; `renderHomeBriefing`, `renderHomeBriefingPanels`, `readBriefingCache` (app.js ~46092–46190), and the refresh handler (~2446).
- Chat: `#aiChatBriefingBtn` (index.html ~189, app.js ~40125) and client `buildBriefingContext` (~41396). There's also a briefing-style line in `chat.js`'s system prompt (~27).
- Settings → AI: the "Daily briefing" toggle and push subscribe block (~17199–17262). `aiSettings.dailyBriefingEnabled` (~5011) is also a fixture in `test/settings-sync.test.js`.

**Reminders today**
- `planEvents[].reminder` is a single, household-shared number of minutes. It fires only while the app is open (`checkEventReminders()` ~25673: toast plus a `Notification` if granted).
- `calendar/model.js` normalizes events through a **field whitelist**. Older clients, including any TestFlight build in the wild, **drop unknown fields** like a new per-user reminders map when they re-save an event.
- Google events (`calendar/google.js` ~380) take only `reminders.overrides[0]`. Events using the calendar's **default reminders** (`useDefault: true`, which is most Google events) come through with no reminder, and `gcal-calendars` doesn't return `defaultReminders`.

**The iOS shell has no notification support.**
- Capacitor 6.2, no push/local-notification plugin, no `.entitlements`, `UIBackgroundModes = audio`.
- WKWebView has no `PushManager` or `Notification`.

**Constraints:**
- No notification path reads `tableplan_states` (§2).
- Don't bump `STATE_SCHEMA_VERSION`.
- ARCHITECTURE.md §8: bounded retries.
- No finance data in AI prompts. Alerts are templates.
- Revoke the `anon` grants on `live_push_subscriptions` (ISSUES.md).

---

## 2. Egress budget (the hard constraint)

Supabase bills bytes **sent from** the database. Every notification path is designed around tiny, indexed reads.

**Rules**
1. **No notification code reads `tableplan_states`.** Senders read only `live_push_subscriptions`, `live_notification_prefs` and `live_reminders`, with explicit `select=` and a `limit`.
2. **All client writes use `Prefer: return=minimal`**, so the response is about 0 bytes.
3. **Clients upload diffs only.** A per-device hash of the last upload means nothing is written when nothing changed, and nothing is written on a timer.
4. **The one recurring server poll is a single claim RPC** that's empty almost every time.
5. **The prefs row is read on app open only if the local copy is older than 10 minutes or another device changed it.** The client sends `If-None-Match`-style `updated_at=gt.<cached>`, so an unchanged row returns `[]`.
6. **Kill switch:** env `NOTIFICATIONS_DISABLED=1` stops all senders and crons immediately.
7. Every sender logs `{rowsReturned, sent, pruned}`. Check the Supabase API logs (`service: api`) for 48h after each deploy.

**Estimate** (2 users, ~4 devices):

| Source | Frequency | Bytes out of Supabase | Monthly |
|---|---|---|---|
| Phase 1 local scheduling | every app open | 0 | 0 |
| Prefs freshness check | app open (≤ every 10 min) | ~0.3 KB when unchanged, ~2 KB when changed | ~1–3 MB |
| Token registration, prefs/reminder writes | on change | ~0 (`return=minimal`) | ~0 |
| Connection alerts | only when an outage starts | ~1 KB | < 0.1 MB |
| Reminder claim poll | every 5 min | ~0.5 KB, mostly empty | ~4–5 MB |
| Reminder sends | per due reminder the device lacks | ~1 KB | < 1 MB |
| **Removed:** briefing's daily state read + Home briefing generation | daily / per open | full household state JSON + AI calls | **saves** ~1–10 MB+ |

**Net effect: about flat, likely lower than today.**

---

## 3. Retire the briefing entirely (ships with Phase 2)

Luke plans a significantly reworked version later. Nothing here needs preserving for that.

- **Server:**
  - rename `daily-briefing.js` → `daily-maintenance.js`;
  - keep `cleanupOldTtsAudio()` + `snapshotFinanceBalances()` exactly as they are, and add the Phase 3 prune;
  - update the `netlify.toml` block (schedule and `included_files` unchanged);
  - delete the briefing code and its `web-push` import;
  - drop the briefing guidance line from `chat.js`'s system prompt.
- **Client:**
  - remove `#homeBriefing` (markup, CSS, render/cache/refresh code) and `#aiChatBriefingBtn` + client `buildBriefingContext`;
  - remove the Settings → AI briefing block and the `dailyBriefingEnabled` default;
  - clear stale `briefing_ai_*` localStorage keys once on boot;
  - switch the `settings-sync` test fixture to another `aiSettings` key.
- The Calendar/To-do glance panels go with the Home briefing. If Home looks bare afterwards, that's a separate design question.
- The stored `dailyBriefingEnabled` key stays harmlessly in old states; there's no migration.
- Old TestFlight builds still show the Home briefing until the Phase 2 build ships. The AI call it makes keeps working, so nothing breaks in between.

---

## 4. Per-user reminders (data model, needed by all phases)

**Rule (Luke): a reminder goes only to each user who asked for it.** Nobody is notified because someone else set a reminder.

**Where it lives:** in the per-user `live_notification_prefs` row, **not on the shared event**.
- It's per-user by nature, so there's no clobbering when both spouses edit one event.
- Old clients' `model.js` whitelist never touches it, so they can't strip it.
- It's readable by the server for Phase 3 without plan state.

```jsonc
// live_notification_prefs.reminders  (per user)
{
  "evt_123":        { "min": 30 },              // a local plan event (all occurrences)
  "evt_123@2026-11-02": { "min": 0 },           // optional per-occurrence override; {"off":true} to skip one
  "gcal:<calId>:<googleEventId>": { "min": 10 } // app-side override for a Google event
}
```

**Sources, combined per user:**
1. **Local plan events:** this user's entries in `reminders`.
2. **Google-calendar events** (calendars this user's token reads):
   - Google's own reminders for that user: `overrides` (popup method), or the calendar's `defaultReminders` when `useDefault` is set;
   - unless this user has an app-side override in `reminders`.
   - Google reminders are already per-user in Google, so they map naturally to "the user who asked".
   - **To fix in `calendar/google.js` + `gcal-calendars`:** return `defaultReminders`, and honor `useDefault`, every popup override, and cancelled instances.
3. **Legacy `planEvents[].reminder`** (the old shared field): migrated once to the **group admin's (Luke's)** `reminders`, since he's the only person who has used reminders in the app. Afterwards:
   - new clients ignore the legacy field for scheduling;
   - new clients stop writing it (they clear it on save);
   - if an old TestFlight build writes one, Luke's next new client folds it into his prefs and clears it.

**Editor UI:** the existing Reminder control becomes **"Remind me"** and edits only the current user's entry. It works on Google events too, as an app-side override; writing reminders back into Google waits for Google Calendar Phase 2. It's hidden for all-day events, as today.

**Google's own notifications:** to see only what the app sends, Luke turns off notifications in the Google Calendar iOS app (or per calendar in Google settings) once Phase 1 ships. His wife's Google notifications are unaffected; she gets app reminders only for ones she sets in the app.

---

## 5. Phase 1: local notifications on iOS

**As built (PR #95):**
- `migrations/2026-10-13-notification-prefs.sql`: `live_notification_prefs` + `merge_my_reminders(jsonb)`. The RPC validates values, merges key by key, and returns only `updated_at`; a `null` value removes a key. It was checked against Postgres (PGlite with stubbed `auth`): RLS isolation, no anon access, no deletes, bad values rejected. **Not applied.**
- `calendar/reminders.js` (pure core), `calendar/reminder-prefs.js` (prefs store: cache, 10-min freshness, `updated_at=gt.`, merge-RPC writes, offline outbox), `calendar/reminders-native.js` (iOS scheduler).
  - These live in `calendar/` rather than a new `notifications/` folder, because reminders are calendar-owned. Phase 2's push code is shared infra and goes elsewhere.
- `native-bridge.js`: `nativeLocalNotifications()` (null on the web and in older app builds). `@capacitor/local-notifications@6.1.3` was added, and `ios/App/Podfile` was updated by `cap update`. **`Podfile.lock` needs `npm run ios:sync` on the Mac.**
- Google:
  - `_gcal.js` now also fetches `reminders` + `defaultReminders`;
  - `gcal-events` returns `own` (read with the caller's token) and `defaultReminders`;
  - the device cache keeps both and re-pulls once to pick up reminders (at most daily against an older server).
- `app.js` (search `Event reminders (IOS_NOTIFICATIONS_DESIGN`):
  - the editor's reminder is per person, saved after the event has its final id, and no longer written onto the event;
  - event details show the viewer's own reminder, and a **Remind me** picker for Google events (Google's reminder / none / a time);
  - the web minute tick uses the same instances;
  - on the iPhone, iOS's pending notifications are kept in sync on persist, focus and the minute tick;
  - Settings → Calendars has a "Reminders on this iPhone" row (native only) to turn notifications on.
- The legacy fold waits until the device has read the server copy, so a new device that starts offline can't re-add reminders turned off elsewhere.
- QA: `test/calendar-reminders.test.js` (38 tests), `test/calendar-gcal-server.test.js` (ownership + fields), and `scripts/qa-reminders.mjs` (23 checks through the real editor/detail/prefs/tick paths with mocked Google; the picker fits 360px). `scripts/qa-gcal.mjs` still passes 20/20.
- **Before it works in production (Luke):**
  1. apply the migration;
  2. merge + deploy (Netlify: `gcal-events`/`_gcal.js` + web app);
  3. `npm run ios:sync` on the Mac and ship a TestFlight build;
  4. on the phone: Settings → Calendars → "Reminders on this iPhone" → Turn on;
  5. then turn off notifications in the Google Calendar app.

*Original plan:*

- Add `@capacitor/local-notifications@^6`, then run `npm run ios:sync`. This needs a TestFlight build.
- Pure module `notifications/schedule.js`:
  - `reminderInstances({ planEvents, googleEvents, calendars, prefs, userId, now }, { horizonDays: 14, max: 50 })` builds this user's `{ key, fireAt, title, body, url, version }`. Recurrence comes from `calendar/recurrence.js` with exceptions; Google instances come from the device cache.
  - `notificationId(key)` is a stable 31-bit hash.
  - `diffSchedule(wanted, pending)` returns `{ add, cancel }`.
  - The cap is 50 (iOS holds 64), nearest-first.
- Glue `notifications/local.js`, native only:
  - reschedule on open, on `visibilitychange` → visible, after the Google 5-minute refresh, and 2 s (debounced) after any persist touching events, calendars or prefs;
  - tapping opens the event.
- Permission is requested the first time the user sets "Remind me". If denied, show a one-line hint pointing to iPhone Settings.
- On native, `fireEventReminder()` keeps the toast and skips the OS notification. The web keeps today's behaviour until Phase 3.
- Reminders need `live_notification_prefs`, so **the Phase 2 migration's prefs table ships with Phase 1** (one migration, gated). Until the row exists, the device uses a localStorage copy and uploads when online.

**Done when:**
- a "Remind me" on a local event and a Google event with a default reminder both fire on the lock screen with the app killed;
- they survive a reboot;
- editing or deleting the event, or turning the reminder off, cancels or moves the notification;
- Luke's wife gets nothing for reminders Luke set.

---

## 6. Phase 2: native push (APNs) + connection alerts

**Apple / Xcode (Luke, about 15 minutes, one time)**
1. Identifiers → `com.mrlukedevans.live` → enable **Push Notifications**.
2. Keys → create an **APNs key** (.p8, downloads once). Note the Key ID and Team ID.
3. Xcode → Signing & Capabilities → **+ Push Notifications** (creates `App.entitlements`).
4. Netlify env vars: `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID=com.mrlukedevans.live`.

TestFlight uses **production** APNs; Xcode debug builds use **sandbox**. An Info.plist key `LiveApnsEnv = $(LIVE_APNS_ENV)` (per build configuration) is sent with the token.

**Native shell**
- Add `@capacitor/push-notifications@^6`.
- Add the standard `AppDelegate.swift` forwards (`.capacitorDidRegisterForRemoteNotifications` / `…DidFailToRegister…`).
- Tapping routes to `data.url`.

**Migration** (one file covering Phases 1–2; Phase 3 adds its own):

```sql
alter table public.live_push_subscriptions
  add column if not exists platform  text not null default 'web',   -- 'web' | 'apns'
  add column if not exists device_id text,
  add column if not exists scheduled_through timestamptz;           -- Phase 3 dedupe
-- APNs rows: endpoint = 'apns:' || token; subscription = {"token","env"}.
create unique index if not exists live_push_subscriptions_user_device
  on public.live_push_subscriptions(user_id, device_id) where device_id is not null;
revoke all on public.live_push_subscriptions from anon;

create table if not exists public.live_notification_prefs (
  user_id    uuid primary key references auth.users on delete cascade,
  categories jsonb not null default '{"reminders":true,"connections":true}',
  reminders  jsonb not null default '{}',     -- §4
  quiet      jsonb,                           -- optional, later
  updated_at timestamptz not null default now()
);
-- RLS: user selects/upserts own row only. Grants: authenticated + service_role. No anon.
```

**Server**
- `push-subscribe.js` accepts `{ platform: "apns", token, env, deviceId }` and upserts on `(user_id, device_id)` with `return=minimal`.
- `_push.js`, the shared sender: `sendToUser(userId, { category, title, body, url, collapseId, skipDevicesScheduledAfter })`.
  - It does one read of that user's subscriptions (explicit columns) and one read of `categories`.
  - It fans out via `web-push` and APNs (HTTP/2, ES256 JWT cached for about 50 minutes).
  - It prunes on 410 / `Unregistered` / `BadDeviceToken`, with one retry on 5xx.
- `push-test.js`: own devices only, at most 1 per minute.

**Connection alerts** (`connections`): plain templates, **once per outage**, only to the affected user.

| Trigger | Hook |
|---|---|
| SimpleFIN sync failing > 24h | `snapshotFinanceBalances` / `_finance-ingest.js` |
| Google Calendar `invalid_grant` | `_gcal.js` token refresh |
| Gmail watch can't re-arm / `invalid_grant` | `gmail-watch-rearm.js` / `_gmail-shared.js` |

"Once" is enforced by a `notified_at` column on the account row, cleared on recovery.

**Settings → Notifications** (replaces the AI-settings block):
- Allow notifications (native: `requestPermissions()` + `register()`; web: the VAPID flow);
- category switches for Reminders and Connections;
- Send test notification.
- Sign-out deletes this device's row.

The Phase 2 TestFlight build also reports `scheduled_through` (§7), so Phase 3 needs no further build.

**Done when:** a test push and a forced connection alert reach the locked iPhone from TestFlight, the wife's devices never get Luke's, and uninstalled devices are pruned.

---

## 7. Phase 3: server-side reminders (cross-device)

This closes the gap where a reminder is set on the laptop and the phone hasn't opened since.

```sql
create table public.live_reminders (
  user_id    uuid not null references auth.users on delete cascade,  -- the user who asked
  key        text not null,             -- "<eventId>:<date>" / "gcal:<cal>:<id>"
  fire_at    timestamptz not null,
  title      text not null, url text,
  version    text not null,
  updated_at timestamptz not null default now(),
  sent_at    timestamptz,
  primary key (user_id, key)
);
create index live_reminders_due on public.live_reminders (fire_at) where sent_at is null;
-- RLS: user upserts/deletes own rows only. No anon.

create function public.claim_due_reminders(max_rows int default 50)
returns setof public.live_reminders language sql security definer set search_path = '' as $$
  update public.live_reminders r set sent_at = now()
  where (r.user_id, r.key) in (
    select user_id, key from public.live_reminders
    where sent_at is null and fire_at <= now() and fire_at > now() - interval '30 minutes'
    order by fire_at limit max_rows for update skip locked)
  returning r.*;
$$;
```

- **Client upload (diff only):**
  - each device uploads **only its signed-in user's** `reminderInstances()` output (14-day horizon) whenever it reschedules;
  - it upserts changed rows and deletes removed keys, all with `return=minimal`;
  - it does nothing if the hash is unchanged;
  - the web app runs this too.
- **Dedupe:**
  - after a local reschedule, a native device PATCHes `scheduled_through = now()` on its own subscription row;
  - a due reminder is pushed to a native device **only if `reminder.updated_at > scheduled_through`**, meaning the device never saw this version;
  - web devices always get the push, and the in-tab tick drops its OS notification but keeps the toast.
- **Cron:** `reminders-dispatch.js`, every 5 minutes:
  1. return immediately if `NOTIFICATIONS_DISABLED`;
  2. `rpc/claim_due_reminders` (almost always empty);
  3. otherwise call `sendToUser` per row with `collapseId = key`.
  - Rows with `fire_at < now() - 2 days` are pruned daily in `daily-maintenance.js`.
- The tradeoff: a reminder delivered this way can arrive up to 5 minutes late, and only in the "phone never saw it" case.

**Done when:** a reminder set on the laptop alerts the untouched phone, and a reminder the phone already scheduled alerts exactly once.

---

## 8. Build order & deploy notes

1. **Phase 1:**
   - prefs-table migration (gated: run via the Supabase MCP after Luke's OK);
   - Google default-reminder fix (Netlify deploy);
   - local scheduling, the "Remind me" UI, and the legacy reminder fold;
   - TestFlight build.
2. **Phase 2 + briefing removal:**
   - Luke's Apple steps;
   - push-columns migration;
   - Netlify deploy, which also renames `daily-briefing` → `daily-maintenance`;
   - TestFlight build with the push plugin, entitlements and `scheduled_through` reporting.
3. **Phase 3:** `live_reminders` migration, then a Netlify deploy (new cron plus web upload).

Watch the Supabase API logs for 48h after each step against §2. Use `NOTIFICATIONS_DISABLED=1` if anything is off.

---

## 9. Tests

- Unit (vitest):
  - `reminderInstances`: per-user filtering (wife's prefs never schedule Luke's); recurrence/exceptions/multi-day/DST; per-occurrence off; Google `useDefault` + `defaultReminders`; app override beating Google's reminder; the 50 cap; `version` stability;
  - legacy-reminder fold (idempotent, admin only);
  - `notificationId`; `diffSchedule`; upload diffing.
- Function tests with mocked APNs, Web Push and PostgREST:
  - JWT reuse; pruning; category switch;
  - `sendToUser` never touching other users' rows;
  - the `scheduled_through` dedupe; the kill switch;
  - `daily-maintenance` still runs TTS cleanup and the finance snapshot.
- Egress guard test: no notification module or sender references `tableplan_states`.
- Manual QA (TestFlight):
  - killed-app reminder; reboot; Google default reminder; turning a reminder off;
  - the wife's account receives nothing from Luke's reminders;
  - test push; connection alert; laptop-set reminder; no doubles;
  - sign-out stops delivery; a debug build via sandbox.

---

## 10. Decisions

Resolved (Luke, 2026-10-13):
1. **Briefing:** remove all of it (scheduled push, Home panel, chat button). A reworked version may come later; it's not planned.
2. **Google-calendar reminders:** the app sends them, not Google, so Luke can see what the app sends while moving off Google.
3. **Shared events:** a reminder goes only to each user who asked for it.

Open (can wait):
4. **Quiet hours:** now or later.
5. **Phase 3 cadence:** every 5 minutes (planned) or every minute (~22 MB/month, still small).
