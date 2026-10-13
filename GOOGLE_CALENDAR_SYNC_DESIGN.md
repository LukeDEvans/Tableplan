# Google Calendar two-way sync — design & plan

Status: **Phase 1 merged to `main` (PR #90, 2026-10-13), not deployed.** Phase 2 not started. Direction approved by Luke 2026-10-12.

Goal: events and calendars added in Google Calendar appear in Tableplan automatically, and events created/edited/deleted in Tableplan on a Google-backed calendar land in Google.

**Why (the arc):** Luke and his wife currently use Google Calendar for everything. Through the transition, Luke experiments in the app while his wife stays exclusively on Google, and **both must see the same information.** Tying the app to Google in the mid-term is accepted. **Long term the app becomes the master copy and is severed from Google** (§9). Every phase is built so that exit stays cheap.

---

## 1. What exists today (findings)

**Linked Google calendars are read-only iCal scraping.**
- `state.calendars` holds Google *secret iCal URLs*. `loadCalendarEvents()` (app.js ~19235) calls `netlify/functions/google-calendar.js`, which fetches the `.ics` and parses only `SUMMARY` + `DTSTART` date + a yearly flag.
- Render (app.js ~24512–24530) projects every Google event as **all-day, no start/end time**, with id `gcal:<calendarId>:<date>:<summary>`.
- Consequences:
  - Google events never carry times, so the meal-plan "place by time of day" rule can't work for them (an 8a–4p shift can't land on lunch).
  - Ids are built from the title, so renaming an event in Google silently breaks local hides (§16) and overrides (§15).
  - No write path exists, and the iCal URL can't support one.

**Useful infrastructure already in place:**
- A working Google OAuth flow for Gmail (`gmail-auth.js` / `gmail-callback.js` / `_gmail-shared.js#getValidAccessToken`) using `GOOGLE_CLIENT_ID/SECRET`, offline refresh tokens, and a daily re-arm scheduler (`gmail-watch-rearm.js`).
- The provider registry in `calendar/sources.js` already models `readOnly` / `writable`, and `calendar/normalize.js` already produces canonical events with stable `externalId`.
- `calendar/reconcile.js` (hide/override) is pure and ready to key off real Google event ids.
- The event editor already distinguishes "this occurrence" vs "series" (exceptions + one-off split, app.js ~24356). That maps directly onto Google instance vs. master edits.

**Constraints to respect:**
- `CALENDAR_AUTHORITY_FLIP.md` holds Phase 4. Nothing here may make `calendarSources` authoritative or touch `mergeStates` tombstone semantics.
- Egress lesson: keep new per-user/per-poll state **out of `tableplan_states`** and use dedicated tables, as `mail_accounts` / `mail_sweep_state` do.
- `STATE_SCHEMA_VERSION` is finance-only. Don't bump it for this.

---

## 2. Core decision (recommended): Google is the authority for Google calendars

Don't mirror Google events into `planEvents`. Treat Google-backed calendars like the ICS sources already are: **fetched, cached per device, never written into synced state.** The only difference is that they're writable through a server function.

Why:
- **No merge/tombstone exposure.** Google events never pass through `mergeStates`, so the held authority-flip problem and delete-resurrection can't occur.
- **No echo loops and no two-master conflicts.** Each event has exactly one owner. App edits go straight to Google, then the cache refreshes.
- **Low Supabase egress.** Event data flows Google → Netlify → device. Supabase only stores tokens and small sync metadata.
- **Shared Google calendars come free.** If Luke's wife shares a calendar with him in Google, it shows up in his `calendarList` automatically.

Tradeoff: editing a Google event requires being online. Phase 2 blocks offline edits with a clear message; an offline queue is optional later (§6).

The alternative (mirror into `planEvents` with a `googleEventId` map plus a server writer into section rows) was rejected. It needs server writes into hot merged rows, loop suppression, and conflict resolution. That's far more risk for little gain.

---

## 3. Data model

New Supabase table (migration in `migrations/`), RLS: service role only.

```sql
create table gcal_accounts (
  user_id       uuid primary key references auth.users on delete cascade,
  google_email  text not null,
  refresh_token text not null,          -- consider pgsodium/vault encryption
  access_token  text, expires_at timestamptz,
  scopes        text[],
  updated_at    timestamptz default now()
);
create table gcal_channels (            -- Phase 3 only (push)
  channel_id text primary key, user_id uuid, google_calendar_id text,
  resource_id text, expires_at timestamptz, token text
);
```

In synced `plan` state, a Google-backed calendar entry in `state.calendars` gains fields but **keeps its existing app `id`**, because local events and meal-plan settings reference calendars by id (Decision #1):

```js
{ id, name, color, enabled, source: "linked",
  provider: "google-api",               // vs legacy iCal "google-ics"
  googleCalendarId: "primary" | "…@group.calendar.google.com",
  ownerUserId,                          // whose token reads/writes it
  accessRole: "owner"|"writer"|"reader",// from calendarList
  readOnly: accessRole === "reader",
  showOnMealPlan }                      // existing per-calendar switch
```

Register a provider in `calendar/sources.js`: `{ id: "google-api", readOnly: false, writable: true }`.

Device-local (localStorage, alongside the existing linked-source cache): event cache per calendar plus `lastSyncedAt`.

---

## 4. Server functions (Netlify, alongside the Gmail ones)

| Function | Purpose |
|---|---|
| `gcal-auth` | Builds the consent URL. Scope: `https://www.googleapis.com/auth/calendar` (the one configured in Phase 0; needed for creating calendars in Phase 2). Uses `access_type=offline`, `include_granted_scopes=true`. **Sign `state`** with an HMAC + nonce. The Gmail flow's `state` is plain base64 `{userId}`, which is forgeable; fix it there too. |
| `gcal-callback` | Exchanges the code and upserts `gcal_accounts`. Redirects to `/#plan?gcal_connected=1`. |
| `gcal-calendars` | `calendarList.list` → returns calendars with id, summary, color, accessRole. |
| `gcal-events` | `events.list` per calendar with `singleEvents=true` over a window (e.g. −60d…+400d). Delta mode uses `updatedMin=<lastSyncedAt>&showDeleted=true`. Returns normalized events (see mapping). Authorizes that the caller owns the token **or** the calendar is household-visible (`showOnMealPlan`) and the caller is in the same `live_group`. |
| `gcal-write` | `{op: insert\|patch\|delete, calendarId, eventId?, scope: "instance"\|"series", event, etag}`. Sends `If-Match: etag`. A 412 means it changed in Google: return the fresh event and let the client re-prompt. |
| `gcal-watch-rearm` *(Phase 3)* | Hooked into the existing daily schedule: renews `events.watch` channels. |
| `gcal-webhook` *(Phase 3)* | Validates `X-Goog-Channel-Token`, bumps a tiny `gcal_sync_state.version`, and ACKs 200 always (same pattern as `gmail-webhook`). |

Share token refresh with `_gmail-shared.js#getValidAccessToken` by extracting a `_google-oauth.js`. On `invalid_grant`, clear the row and surface "Reconnect Google Calendar" in the app.

**Event mapping (Google → canonical, via `normalizeExternalEvent`):**
- `externalId` = Google `id` (instance ids for recurring occurrences); `recurringEventId` is kept for series edits.
- `start.date` → `allDay:true`; `start.dateTime` → `date` / `startTime` / `endTime` in the event's `timeZone`, converted to the viewer's local time.
- Multi-day: `end.date` is exclusive in Google, so subtract a day for `endDate`.
- `summary → title`, `description → notes`, `location → location.name`.
- `reminders.overrides[0].minutes → reminder`.
- Keep `etag` and `htmlLink`.

Real start/end times also fix meal-plan placement for Google events.

---

## 5. Client changes (app.js + calendar/)

1. **Connect UI** in Calendar settings: "Connect Google Calendar" → `gcal-auth`. After connecting, show the `calendarList` with a toggle per calendar (default on for owned calendars, off for subscribed ones like holidays). New calendars added in Google show up on the next list refresh with a "New" badge.
2. **Migrate legacy iCal entries in place.** The secret iCal URL contains the calendar id (`/calendar/ical/<urlencoded-id>/private-…/basic.ics`). On connect, match each `provider`-less linked entry to its `calendarList` item, set `provider:"google-api"` + `googleCalendarId`, and **keep the app id and color**. Re-key existing hides/overrides from `gcal:<cal>:<date>:<summary>` to the new `<calId>:<googleEventId>` by matching date+title once. Leave unmatched entries on the iCal path.
3. **Fetch path.** `loadCalendarEvents()` branches:
   - `google-api` calendars go through `gcal-events` (delta after the first load), with timed events.
   - Legacy ones go through the existing iCal function.
   - The render projection (~24512) stops forcing `allDay:true` for API-sourced events.
4. **Editing.**
   - For `google-api` calendars where `!readOnly`:
     - The editor opens normally instead of showing the read-only panel (`isExternal`, ~25132).
     - Save, delete, drag/resize, and "this event / all events" call `gcal-write`.
     - The local cache updates optimistically and rolls back on error.
   - Google-backed writable calendars appear in the editor's calendar picker, so "new event in the app → lands in Google" is just picking that calendar.
   - Offline: disable save with "Needs a connection to update Google".
5. **Freshness (Phase 1–2):** refetch deltas on app open, on `visibilitychange` to visible, and every 5 min while visible. No polling in the background or when hidden. Delta requests are tiny.

---

## 6. Phases

**Phase 0: Google Cloud console — ✅ DONE (Luke, 2026-10-12)**
- ✅ Google Calendar API enabled on the existing OAuth project.
- ✅ Scope `https://www.googleapis.com/auth/calendar` added to the consent screen. This single full scope covers Phases 1–2 (events, calendar list, and creating calendars for the automatic move). `gcal-auth` should request exactly this scope.
- ✅ Publishing status confirmed **In production** (Luke, 2026-10-12). Keep it there: in *Testing*, refresh tokens for sensitive scopes expire after 7 days.

**Phase 1: Read via API (biggest immediate win) — ✅ MERGED to `main` (PR #90, 2026-10-13), not deployed**
- As built: `migrations/2026-10-12-gcal-accounts.sql` (`gcal_accounts` + `gcal_links`), `netlify/functions/_gcal.js` + `gcal-auth` / `gcal-callback` / `gcal-calendars` / `gcal-events`, `calendar/google.js` (pure mapping + severance converter), `calendar/google-client.js` (device cache + link reconciliation), app.js glue (search "Google Calendar API sync"), panel in Settings → Calendars and the sidebar's Add Calendar dialog.
- Deviations from §3–5, on purpose:
  - The app↔Google mapping is authoritative in **`gcal_links`** (server), not only on the `state.calendars` entry. Older deployed clients strip unknown fields from `state.calendars` when they re-save the plan row, so the entry's `googleCalendarId` is just a cache that every status sync re-applies.
  - A removed calendar is a `gcal_links` row with `enabled=false`, so discovery never re-adds it. Re-adding mints a fresh app id, because the old one is tombstoned.
  - Plan-calendar event ids stay `gcal:<cal>:<date>:<title>`, so hides and renames made before the switch keep working. A second same-titled event that day gets `#<googleId>` appended. Stable Google-id-based ids are a Phase 2 item (needed for editing anyway).
  - The 5-minute refresh touches only API calendars, never the legacy iCal feeds.
  - The iPhone app connects in Apple's sign-in sheet (WebAuth plugin, `?client=ios`), exactly like Gmail; `gcal-callback` sends the sheet back to `com.mrlukedevans.live://gcal`. Older app builds without the plugin are told to connect from a browser. The signed state reuses `_oauth-state.js` with its own purpose (`gcal-oauth-state-v1`).
  - Google API calendars can be switched to **Show on Meal Plan** (Edit Calendar dialog). Their timed events flow through `calendar/meal-plan-share.js` like subscribed feeds, read from the device's Google cache. After a refresh, the share is re-saved only if its snapshot actually changed.
  - Originally built on `integration`, which turned out to be far behind `main`. It was ported onto `main` the same day; `main` is the real base.
- QA: `test/calendar-google.test.js`, `test/calendar-gcal-server.test.js`, and `scripts/qa-gcal.mjs` (headless, 20 checks against the real client paths with mocked functions; run on a fresh local state).
- **Before it works in production (Luke):**
  1. ✅ Migration applied to prod (2026-10-12, via the Supabase MCP). Verified: both tables exist, RLS on, no policies, only `postgres`/`service_role` hold privileges.
  2. Redirect URI `https://effervescent-malabi-e0af55.netlify.app/.netlify/functions/gcal-callback` (see 3).
  3. ✅ Redirect URI added to the OAuth client (Luke, 2026-10-12).
  4. ✅ Merged to `main` (PR #90, 2026-10-13). **Remaining: a `[deploy]` (needs Luke's OK) and a TestFlight build.** No new env vars. Post-deploy steps are in `UNDEPLOYED.md`.
- Original Phase 1 scope:
- Ship: `gcal_accounts` migration, `gcal-auth/callback/calendars/events`, connect UI, in-place migration, timed events, auto-discovered new calendars.
- Also ship the **severance converter + dry-run report** (§9) now, not at the end.
- Done when: an event added in Google appears in the app with correct times on next open/focus, and a new Google calendar shows up in settings.

**Phase 2: Write-back + move to Google (automatic)**
- Ship: `gcal-write`, editor/drag/delete wiring, instance vs. series, etag conflicts, Google calendars in the picker.
- **Automatic move to Google on connect.**
  - Show one confirmation screen listing every local calendar, **pre-checked to move**; Luke can uncheck any to keep it app-only.
  - Requires the full `calendar` scope (to create calendars).
  - Household calendars are created in one owner's Google and shared to the other spouse via Google ACL.
  - Copy events with idempotency keys (`extendedProperties.private.tpEventId`) so retries or a second device can't duplicate.
  - Keep the app calendar id; flip the entry to `provider:"google-api"`.
- **New calendars created in the app default to Google.**
- **App-only fields round-trip through `extendedProperties.private`**: `showInMealPlan`, `chores`, `addToDo`, `attachment`, per-event `color`, `tpEventId`. Unit-test the round-trip, because a Google edit must never drop them.
- **Offline outbox (required, since local calendars now live in Google):** queued `gcal-write` ops in IndexedDB, replayed in order on reconnect with etag checks. Conflicts surface as a "changed in Google" prompt.
- Done when:
  - an event created/edited/moved/deleted in the app appears in Google Calendar on the phone within seconds;
  - an offline edit lands after reconnect;
  - a conflicting edit shows a clear "changed in Google" prompt.

**Phase 3: Near-real-time (optional)**
- Ship: `events.watch` push → `gcal-webhook`, re-arm in the daily schedule.
- Clients learn about changes via a cheap version check on focus, **not** a Realtime subscription on a hot table.
- Only worth doing if the 5-min focus refresh feels slow.

*(Former Phase 4, "Move to Google," is now automatic and part of Phase 2.)*

---

## 7. Tests

- Unit (vitest, `test/`): Google→canonical mapping (all-day exclusive end, timezones, DST boundary, cancelled instances), iCal-URL→calendarId extraction, hide/override re-keying.
- Function tests with mocked Google responses: 401 refresh, `invalid_grant`, 412 etag conflict, household authorization check.
- Manual QA (`POST_DEPLOY_CHECKS.md` additions):
  - Create, edit, and delete in both directions on phone and laptop.
  - Recurring "this event" vs "all events".
  - Wife's meal-plan-flagged calendar is visible on Luke's device.
  - Revoke access in Google → "Reconnect" prompt appears.

---

## 8. Decisions (Luke, 2026-10-12)

1. **Authority model:** Google-authoritative through the transition; the app becomes master at severance (§9).
2. **Connect flow:** a separate "Connect Google Calendar" button, independent of Gmail.
3. **Local calendars:** automatic move to Google on connect, with per-calendar opt-out (Phase 2).
4. **Offline edits:** the outbox is built in Phase 2, not later.
5. **Phase 3 push:** only if the 5-minute focus refresh feels slow.
6. **Severance:** planned from day one, with a dry-run report (§9).

---

## 9. Severance: making the app the master copy

The end state: the app owns all calendar data and the Google connection is removed. Because Google is authoritative until then, severance is a one-time **"Bring home" import**, not a toggle.

**Converter (built in Phase 1, kept green by tests):**
- Fetch each Google-backed calendar **unexpanded** (`singleEvents=false`) to get series masters + RRULEs.
- RRULE → app `recurrence` (`calendar/recurrence.js`):
  - daily;
  - weekly + `BYDAY`;
  - monthly by day or nth/last weekday;
  - yearly;
  - `INTERVAL`, `UNTIL`, `COUNT`;
  - `EXDATE` → `exceptions`.
- Anything the engine can't express (e.g. multiple `BYSETPOS`, `RDATE`, hourly) imports as individual expanded events within a horizon and is **listed in the report**.
- Modified single instances become an `exceptions` date on the series plus a one-off event, the same pattern the editor already uses for "this event only."
- App-only fields are restored from `extendedProperties.private`.
- If `tpEventId` exists, reuse it as the app event id, so events originally created in the app keep their ids.
- Calendars keep their **app ids and colors**, so meal-plan and household references survive.

**Dry-run report** (Settings → Calendar → "Ready to leave Google?"):
- Runs the converter without writing anything.
- Shows: N events / M series import cleanly, plus a list of anything that would degrade.
- Also lists what Google-only data would be lost (guests/RSVPs, Meet links, Google attachments).
- Usable any time during the transition, so readiness is measured, not guessed.

**The cutover (needs Luke's confirmation; irreversible in spirit):**
1. Run the report; resolve or accept any flagged items.
2. Write imported events into `planEvents` through the normal local write path (ordinary merge/tombstones; no `mergeStates` changes).
3. Flip each calendar entry from `google-api` to `local`, same id.
4. Disconnect: revoke the token, delete the `gcal_accounts` row, stop channels.
5. Leave Google's copies untouched (no deletes), so Google stays a frozen backup.

**Wife's transition:** severance only makes sense when she's moving too. Soft landing option: the app publishes a private iCal feed she subscribes to in Google, so she keeps seeing everything there (read-only) while edits happen in the app.

**Readiness criteria (what "the time is right" means):**
- [ ] Phases 1–2 shipped and stable for ≥ 4 weeks with no "missing/duplicate event" bugs in `ISSUES.md`.
- [ ] Dry-run report shows everything important importing cleanly.
- [ ] Luke has used the app (not Google) as his primary calendar for ≥ 1 month.
- [ ] His wife is willing to switch, or to use the read-only iCal feed.
- [ ] Nothing Google-only (shared invites from people outside the household, work calendars) still depends on Google.

A reminder to review these is set in Luke's Reminders app.
