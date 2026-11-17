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
Contacts, Settings — and nobody's Personal rows but the key owner's.

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

## 5. Phase 2 — writes and a Settings screen (not built)

- **Settings › Assistant:** mint (secret shown once), name, revoke, last used.
- **Write tools**, bounded and typed like `assistant-tools.js`: add task, add
  shopping item, add Liv event, set a meal, add to watchlist. Server-side appliers
  through `_state-sections.js updateSection` (optimistic locking, tombstones), never
  raw writes. Every write logged where Luke can see it in Liv.
- Duet already asks before sends, payments, signatures and deletes; Liv adds its own
  rule: **no delete or edit tools** until the adds have proven themselves.

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
