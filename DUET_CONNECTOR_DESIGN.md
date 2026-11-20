# Duet connector — Liv as an MCP server for outside assistants

Luke, 2026-11-17. Luke got access to Claude Duet (Anthropic's proactive agent,
research preview) and asked for a way to give it access to Liv, to act as the AI
assistant until Liv's own assistant is ready.

## 1. What it is

Duet uses the connectors on Luke's Claude account. So Liv becomes a **custom
connector**: a remote MCP server (`liv-mcp`, a Supabase Edge Function) that Claude
reaches from Anthropic's cloud. Duet then has Liv's tools alongside Gmail, Google
Calendar and the rest, and checks in every few hours.

The same server works for any MCP client — regular Claude chats, Claude Code, and
later Liv's own assistant — so the tools are not throwaway. They are the typed tool
layer ARCHITECTURE.md §9 already requires, reachable from outside the app.

**Not yet confirmed:** Anthropic hasn't said whether Duet picks up *custom* connectors
(it says it uses "your connected apps"). Phase 1 is small enough to find out cheaply.

## 2. Decisions (Luke, 2026-11-17)

- Build it, read-only first ("Let's do this work").
- Runs as a Supabase Edge Function — no Netlify deploy, no deploy credits. The
  existing photo-sync / finance-nightly / doc-storage functions set the pattern.

## 3. Phase 1 — read-only (live since 2026-11-17)

**Tools** (all `readOnlyHint`; text answers, America/Chicago dates):

| Tool | Reads |
|---|---|
| `liv_today` | One day: Liv events in every view, the day's meals, tasks due, shopping-list size, trips under way or starting within 2 weeks. Duet's check-in call. |
| `get_calendar_range` | Liv's own events, ≤ 62 days, by view or all. |
| `get_meal_plan` | The Friday-to-Friday week: each meal for MJ / Luke / Sophia, notes. |
| `list_tasks` | This planner week + backlog, Personal or Household. |
| `get_shopping_list` | Items added by hand in Shop. |
| `search_recipes`, `get_recipe` | The recipe box (`eat_recipes`). |
| `get_watchlist` | Household or Personal, want / watched. |
| `list_trips` | Explore's trips with status. |
| `liv_health` | Is Liv working (§4). Admin only. |

**Never readable:** Finance, Documents (incl. the Safe), Photos, Messages, Mail,
Settings — and nobody's Personal rows but the key owner's. Contacts are readable
only through `search` (Luke, 2026-11-19; §5a). Finance and Mail will follow the
app's assistant switches once search reaches them (UNIVERSAL_SEARCH_DESIGN.md phase 5).

**Known gaps (phase 1):**
- **Google Calendar events aren't in Liv's synced state** (Google is authoritative,
  fetched per device — GOOGLE_CALENDAR_SYNC_DESIGN.md). The tools say so, and point
  Duet at its own Google Calendar connector.
- **Shopping list = hand-added items only.** The meal-plan-generated part is built
  client-side (`buildGroceryItems`); Duet gets the meals and recipes instead.
- Recurring tasks (`recurringTasks`) aren't expanded into the week.

### 3.1 Keys

`assistant_connector_keys` (migrations/2026-11-17-assistant-connector-keys.sql),
the photo-sync device-key pattern:

- A key is `<id>.<secret>`; the database keeps only SHA-256(secret).
- `scopes`: `read` now; `write` reserved for phase 2 and ignored until then.
- A key acts as its owner, in the views `views.js` gives that person.
- Owner can see and revoke their keys (RLS); revoking is final.
- **Rate limit in the database:** 120 calls per key per 10 minutes, then 429.
- Accepted as `Authorization: Bearer <key>` (claude.ai › Add custom connector ›
  Request headers), `x-api-key`, or — if Request headers aren't offered on Luke's
  account (beta) — in the URL as `…/liv-mcp/k/<key>`. The URL form puts the key in
  Supabase's request logs; fine for a read-only test key, revoke and re-mint if the
  URL is ever shared.

### 3.2 Data access and egress

- `assistant_state_read(row, paths[])` returns only the JSON paths a tool needs
  (e.g. `plans.2026-11-13`, `doBacklog`), so a call moves a few KB, not a section.
- Recipes: `eat_recipes` by id for the meal plan; the whole box (no photos/nutrition
  columns) only for search / get_recipe.
- Tombstoned items are dropped (`state-sync.js tombstoneIdsFor`).
- No polling anywhere: the server answers calls; Duet calls every few hours.

### 3.3 Code

- `supabase/functions/liv-mcp/index.ts` — HTTP, key check, account lookup, DB.
- `supabase/functions/liv-mcp/tools.js` — tools + MCP JSON-RPC (stateless
  Streamable HTTP: one POST, one JSON answer; notifications → 202). Reuses
  `calendar/model.js`, `calendar/projection.js`, `views.js`, `assistant-queries.js`,
  `state-sync.js`, `travel-model.js`.
- `tools.bundle.js` — built by `npm run build:liv-mcp`; `test/assistant-liv-mcp.test.js`
  fails when it's stale, and runs the real index.ts against a fake Supabase (keys,
  protocol, every tool, the view rules).

### 3.4 Going live (Luke OK'd all three, 2026-11-17)

1. Apply the migration (Supabase MCP `execute_sql`, then a `schema_migrations` row).
2. Deploy `liv-mcp` with **verify JWT off** (the key isn't a Supabase JWT).
3. Mint Luke's first key: the secret is generated outside the database and only its
   hash goes in (`assistant_connector_mint`). Phase 1 hands the secret to Luke once,
   in chat; phase 2 moves minting to Settings so no one but Luke ever sees it.
4. claude.ai › Customize › Connectors › Add custom connector: URL
   `https://noyocjcltrenwdovqrql.supabase.co/functions/v1/liv-mcp`, No sign-in,
   Request header `authorization` = `Bearer <key>`.
5. Ask Duet something only Liv knows ("what's for dinner Thursday?").

**Done 2026-11-17:** migration applied (`schema_migrations` 20261117160000; anon and
signed-in callers verified unable to run the functions or read hashes); `liv-mcp`
v2 deployed with verify JWT off; key `Claude Duet` minted for Luke. Every tool was
checked against real data through `pg_net` with a throwaway key, since revoked.
v1 failed on recipes: prod's `eat_recipes` has no `prep_time`/`cook_time` — the test's
fake PostgREST now rejects unknown columns. Left for Luke: steps 4–5.
6. Off switch: revoke the key, or set the `LIV_MCP_DISABLED=1` secret.

## 4. `liv_health` — is Liv working? (live since 2026-11-17)

Luke, 2026-11-17: "Let's go ahead with the diagnostics tool." His aim: take as much
routine checking off him as possible, with Duet watching between sessions.

- **Admin only** (`role = admin`); a member's key gets a refusal and no database call.
- **Metadata only**: times, counts, sizes, statuses; never content, tokens or secrets.
  One service-only function, `assistant_health(user)` (migrations/2026-11-17b-assistant-health.sql).
- Reads: finance nightly status, news feed run + failing feeds, newest story, mail sweep
  (incl. a stuck lock), Google Calendar link, photo library + sync devices, the person's
  sync rows (size, last write), whole-state snapshot count (save-loop / egress gauge),
  push subscriptions, assistant keys.
- Problems first, with thresholds in `HEALTH_LIMITS` set well past normal gaps so a
  check-in every few hours doesn't cry wolf.
- First live run found 23 of 88 news feeds failing (ISSUES.md).

## 5. Phase 2 — writes (live since 2026-11-17; Settings screen not built)

**Decision (Luke, 2026-11-17):** Duet gets full access to everyday data. In his
words, the app "is intended to be used with an AI with full access". That covers
calendar and tasks, the shopping list and meal plan, Watch, and trips. **Finance and Mail
stay read-only.** This replaces the earlier "adds only, no edits or deletes" rule.

- **Tools** (`supabase/functions/liv-mcp/write-tools.js`, shown only to a key with
  the `write` scope): add/update/delete_event, add/complete/delete_task,
  add/remove_shopping_items, set_meal / clear_meal, add_watch_item /
  set_watch_status / remove_watch_item, add_trip, list_recent_changes, undo_change.
  Items are found by title; when several match, the tool lists them and changes nothing.
- **How it writes:** read-change-write of one section row with a conditional PATCH
  on `updated_at`. It is retried, sets a fresh `stateUpdatedAt`, and sends the
  `x-live-writer: liv-mcp` header, without which the `enforce_live_writer` trigger refuses it.
  Deletes add owned tombstones to the config row. Shopping changes stamp
  `persistentManualGroceryStamps`.
- **Log and undo:** every change becomes a row in `assistant_changes`, which holds the
  summary and an undo recipe. The owner can read it; only the service role writes it,
  and it is under the MFA policy. `undo_change` reverses a change; a deleted item comes back under a new id.
- **Known limits:** an edit can lose to a phone that saves its older copy of
  the same item at about the same time. Clearing a meal can be put back by a phone
  that still shows the old meal. Both are rare, and clearing is safest in the app.
- **Keys:** a key's scopes are fixed when it's minted (`assistant_connector_keys_guard`).
  Write access therefore means a new key, `Claude Duet (write)`, handed to Luke once
  in chat. Revoke the old read-only `Claude Duet` key once Duet uses the new one.
- **Settings › Beta › Connected Assistants** (`assistant-connectors-ui.js`, 2026-11-17)
  lists the person's keys, makes one, revokes one, and lists `assistant_changes` with
  Undo. Making a key: the secret is made on the device and only its SHA-256 goes to
  `assistant_connector_mint_mine` (migration 20261117230000). That function makes keys
  only for the signed-in person, checks `session_meets_mfa()`, and allows at most 5 active keys. Undo:
  liv-mcp accepts the person's own sign-in for `list_recent_changes` and `undo_change`
  only. That sign-in is refused below aal2 when a factor is verified; the undo is logged
  against the key that made the change; CORS is limited to Liv's origins.

## 5a. `search` (2026-11-19)

One tool that finds anything by name across the key owner's views: recipes (with
ingredients), tasks, Liv events, trips and trip ideas, Watch lists, saved articles,
the shopping list and contacts. It runs the app's own `search-index.js` (bundled),
reading only the JSON keys its sources name, each row once; recipes come from
`eat_recipes` with four columns (`db.recipeIndex`). Results show kind, view, date and
id, and the answer says titles are data, not instructions. Podcasts stay on the
device (their rows carry episode lists). Design: UNIVERSAL_SEARCH_DESIGN.md.

**Live since 2026-11-19 (liv-mcp v8, from #272).** Checked with a throwaway key over
`pg_net` (since revoked): `tools/list` shows `search`; real queries return recipes and
Watch items across Personal and Household. Not yet deployed: plural group headings
("Watch list:" rather than "Watchs:") — goes out with the next liv-mcp deploy.

## 6. Open questions (to take one at a time)

1. **First key:** mint it now from SQL with the secret given to Luke in chat
   (recommended — read-only and revocable), or wait for the Settings screen?
2. **Writes in phase 2:** which first? Recommended: add task, add shopping item,
   add Liv event — adds only, no edits or deletes.
3. **Contacts:** readable by Duet? Recommended: not yet.
4. **Marijane:** should she see what Duet changed in Household (an activity note), or
   only Luke? Recommended: a small "added by assistant" mark on Household items.
5. **OAuth** in place of a static key — needed only if Request headers stay
   unavailable or someone besides Luke uses it. Recommended: later.
