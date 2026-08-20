# ARCHITECTURE.md — Live (a.k.a. "Eat" / "Tableplan")

> **Status:** Proposed architectural constitution (v1, 2026-08-20). Produced from a
> full-system audit. This document describes how the app is built today and the
> rules future work should follow. **Read this before making substantial changes.**

---

## 1. Purpose & long-term vision

A **single, coherent personal platform** integrating many life domains — calendar,
tasks, email, meals/recipes/groceries, travel, media, music, radio, books, piano
practice, weather, sports, finance, AI assistance, notifications, search — for one
primary user (with optional family/group sharing). Not a suite of isolated tools:
domains share infrastructure (auth, sync, people, notifications, media playback,
AI) while keeping their own logic.

Secondary vision: **data ownership / future self-hosting** — preserve the option to
move off Supabase to a home server + local-first storage without a rewrite.

## 2. Architectural principles

1. **Preserve working systems.** This is mature prior work; extend, don't rewrite.
2. **Capability-honest integrations.** Represent what a provider can actually do;
   never circumvent DRM/auth/anti-embedding/rate limits (see the Media hub).
3. **One representation per shared concept** (people, locations, media, events).
4. **Fail closed on background work.** Every non-interactive process must be
   bounded, idempotent, rate-limited, observable, and killable.
5. **AI acts through bounded tools, never arbitrary DB writes.**
6. **Preserve future optionality** — abstract data access so Supabase is replaceable.
7. **Cohesion without coupling** — domains depend on shared infra, not each other.
8. **Test the pure core; keep logic out of the DOM.**

## 3. System architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ CLIENT (browser PWA, vanilla ESM — no framework)                       │
│   app.js  ← monolithic shell: routing, state, sync, most domain UI     │
│   Extracted domain modules (pure-ish, tested):                         │
│     media-*  music-*  radio-*  nutrition-*  receipt-*  playback-engine  │
│     weather-cache  grocery-catalog  daily-dozen  food-health           │
│   Cross-app surfaces: window.LiveMedia (media verbs)                    │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ PostgREST (user JWT, RLS)      │ HTTPS
                ▼                                 ▼
┌───────────────────────────┐     ┌──────────────────────────────────────┐
│ SUPABASE                  │     │ NETLIFY FUNCTIONS (~57)               │
│  Postgres + RLS           │     │  Integration/proxy layer + jobs:      │
│  tableplan_states (JSONB  │     │   tmdb-*, youtube-search, weather,    │
│    app-state blob/section)│     │   google-*, simplefin, showtimes…     │
│  eat_recipes/eat_folders  │◀────│  AI: chat.js, voice-command,_claude.js│
│  mail_* (jobs, hardened)  │ svc │  Background: sweep-background, gmail-  │
│  live_group_* (sharing)   │ role│    webhook, import-pdf-background      │
│  Auth (JWT, email-scoped) │     │  Cron: scheduled-email(15m), daily-   │
│  state_history (snapshots)│     │    briefing, gmail-watch-rearm, digest │
└───────────────────────────┘     └──────────────────────────────────────┘
                ▲                                 │
                └───────── external APIs ─────────┘
        TMDB, Gmail/Google, OpenWeather, SimpleFIN, Anthropic,
        Internet Archive, Jamendo, Jellyfin, radio-browser, iTunes
```

- **Frontend:** static PWA, Vite build, vanilla ESM. `app.js` (~52k lines) is the
  shell holding routing, the single `state` object, sync, and most domain UI.
  Newer domains are extracted into tested ESM modules.
- **Backend:** Netlify Functions only (no long-running server). `server.js`
  mirrors a subset locally for `dev:local`.
- **Data:** Supabase Postgres. Most app state is a **sectioned JSONB blob** in
  `tableplan_states`; recipes and mail-jobs are **relational** tables.
- **Auth:** Supabase Auth; RLS scopes the personal state row to the owner's email.

## 4. Module / domain boundaries

**Shared platform infrastructure** (must stay generic, changes reviewed hardest):
auth/session · state + sync (`STATE_SECTIONS`, `mergeStates`, tombstones) ·
notifications/push · media playback engine (`playback-engine.js`) · media hub
(`media-*`) · AI tool layer (`chat.js` TOOLS) · integration/proxy functions ·
settings · design tokens (`styles.css`).

**Domain-specific** (own logic, depend on infra not each other): recipes/meals/
groceries · travel · finance · piano practice (`music/`) · weather · sports ·
watch · read/podcasts.

Rule: a domain may use shared infra and the canonical shared models; it may **not**
reach into another domain's internals. Cross-domain needs go through a shared model
(e.g. media envelope) or a documented interface (e.g. `window.LiveMedia`).

## 5. Data ownership

| Concept | Canonical home | Notes |
|---|---|---|
| App state (calendar, tasks, media, finance, travel, …) | `tableplan_states.state` JSONB, sectioned | one row per user (`personal`) or group |
| Recipes / folders | `eat_recipes`, `eat_folders` (relational) | the one fully-normalized domain |
| Mail processing | `mail_accounts`/`mail_sweep_state`/`mail_processed` | service-role only, hardened |
| Sharing | `live_groups`/`live_group_members`/`live_group_invites` | family/group model |
| Push | `live_push_subscriptions` | web-push endpoints |
| History/backup | `tableplan_state_history` | periodic snapshots |
| Media (content/provider/target/user-state) | canonical envelope in `media-model.js` | wraps native records, no migration |

**Known ownership gaps (see §21):** `people`, `locations`, `events`, `tasks`,
`subscriptions`, `documents` do not yet have a single canonical representation —
several domains model them ad hoc inside the state blob.

## 6. Database conventions

- Prefer the JSONB state blob for **personal, low-contention, whole-loaded**
  domains; promote to a **relational table** when data is large, list-queried,
  shared, or independently mutated at high frequency (recipes, mail did this).
- Every table: `id` PK, `created_at`/`updated_at` (`now()`), **RLS enabled**.
- Owner scoping via `auth.uid()`/`auth.jwt()->>'email'`; wrap auth calls as
  `(select auth.uid())` in policies (perf; see §21).
- Service-role-only tables: RLS on, **no policy** (deny-all = fail closed) — this
  is intentional, document it in the migration.
- `SECURITY DEFINER` functions must `SET search_path = ''` and be `REVOKE`d from
  `authenticated` unless deliberately callable.
- Add a covering **index for every foreign key**.

## 7. Integration conventions

- **All external API calls go through a Netlify Function**, never browser→vendor
  with a secret. The function: verifies the session, holds the key server-side,
  handles errors, and returns a normalized shape.
- Client providers take an **injected `fetchJson`** and are pure/testable (see the
  `media-*` and `music-*` providers — the reference pattern).
- Store external IDs on the canonical record (`meta.tmdbId`, `ProviderIds.Tmdb`).
- **Retries must be bounded** and must never re-enter a webhook/notification loop
  (see §8). Prefer "return empty on missing config" over erroring (YouTube proxy).
- New integrations follow: *Domain → Domain service → Integration function → vendor.*

## 8. Background-job conventions (highest-risk area)

Every non-interactive process MUST be:

1. **Bounded** — a hard cap on items per run (mail sweep: ≤10 messages).
2. **Idempotent** — DB-enforced (mail: `mail_processed` PK + `ON CONFLICT`).
3. **Atomically claimed** — one conditional UPDATE gates the work
   (`mail_claim_sweep`: not-locked AND debounced AND under window cap).
4. **Rate-limited / circuit-broken** — per-window counter that self-trips.
5. **Non-self-amplifying** — an action must not generate the event that re-triggers it.
6. **Killable** — a persisted kill-switch (`mail_sweep_state.enabled`).
7. **Observable** — structured single-line stdout logs, no PII/bodies.

No new DB triggers that do network I/O; no `pg_cron`/`pg_net` (both currently
uninstalled — keep it that way unless a job is designed to §8). Scheduling lives in
`netlify.toml` cron. **Gmail webhook must always fast-ACK 200** and must never do
per-notification unbounded reads.

## 9. AI architecture

- The AI acts **only through the typed tool layer** (`chat.js` `TOOLS`): each tool
  is a bounded, validated action (`add_task`, `set_meal`, `add_event`,
  `add_to_watchlist`, `write_note`, …). **No arbitrary AI-generated SQL/DB writes.**
- Tool results are applied to `state` on the client and synced through the normal
  path (so RLS, merge, and tombstones all still apply).
- Keys server-side only (`ANTHROPIC_API_KEY`). Default model Haiku 4.5; escalate
  per task. Prompt caching on the tools/system block.
- Confirmation-first for outward or destructive actions; the model suggests, the
  user confirms. Context is passed as a `CURRENT CONTEXT` snapshot, not DB access.
- Adding a tool = adding a typed entry + a client applier; never widen to raw writes.

## 10. Authentication / security rules

- Supabase Auth (JWT). Personal state RLS-scoped to the owner's email; groups by
  membership. Never ship a `service_role` key to the browser (`supabase-config.js`
  holds the **anon** key only).
- Functions that touch user data **verify the session** (`verifySession`) before
  acting. Secrets live in Netlify env / `.env` (gitignored), never in the client.
- Security headers set in `netlify.toml` (XFO deny, nosniff, HSTS, referrer).
- Webhooks validate origin/shape and fast-ACK.

## 11. State management rules

- One in-memory `state` object; persisted per **section** (`STATE_SECTIONS`) to
  `tableplan_states`. Cross-device merge is **compare-and-swap + `mergeStates`**:
  id-keyed arrays `unionById`, tombstones for deletes, deep-merge for finance,
  newer-wins for scalars.
- Any new synced **id-keyed list** must: give every record a stable `id`, be added
  to the `mergeStates` union list, and (for deletes) write a tombstone. Otherwise it
  will be clobbered or resurrected across devices.
- Never let a just-booted empty client overwrite cloud data (the finance
  deep-merge + DB `tp_protect_finance_merge` trigger exist because this happened).

## 12. Error-handling rules

Provider/network failures are **isolated** (`Promise.allSettled`, per-source status)
and must never break an aggregate view. User-facing errors say what failed and how
to fix it. Background failures are logged structurally and bounded, never retried
unboundedly.

## 13. Testing requirements

- **Pure logic must be extracted and unit-tested** (vitest). Reference: `media-*`,
  `music-*`. New domain logic ships with tests.
- Every background-job decision (claim/debounce/rate-trip/idempotency) has a test
  (`mail-jobs`, `mail-sweep-integration`).
- Before any push: `npx vitest run`, `esbuild` bundle check, and the 360px
  mobile-fit pass (`PRE_PUSH_CHECKLIST.md`).
- **Gap to close (§21):** the `app.js` shell (state/sync/routing) has no direct
  tests; extract and test `mergeStates`, section persistence, and routing.

## 14. Performance principles

Don't pre-optimize. Do avoid architectural cost traps: no per-notification
unbounded DB reads on hot tables; isolate provider failures; cache external
lookups (weather, Jellyfin index); wrap RLS auth calls in `(select …)`; index FKs.
The JSONB blob is loaded whole — keep per-section size bounded and promote
large/hot sections to tables before they dominate sync payloads.

## 15. Offline / synchronization principles

Local-first is the direction. Keep **all data access behind a small set of
functions** (currently the `tableplan_states` REST calls + `persist`/merge) so a
future adapter can target local storage / a home-server Postgres. Sync is
already merge-based (not last-write-wins), which is the hard part and is
migration-friendly. Avoid Supabase-only features in app logic (Realtime, Storage,
Edge Functions) unless wrapped.

## 16. Deployment principles

- Build: `vite build` → `dist` → Netlify. Cron + functions in `netlify.toml`.
- **Never push/deploy without explicit approval** (deploy credits + push cap; see
  `CLAUDE.md`). Run the pre-push checklist first.
- **CI:** `.github/workflows/ci.yml` runs `npm ci` → `npm test` → `npm run build`
  on every push/PR (no deploy step). **Remaining gap (§21):** no staging; SQL
  migrations live in `migrations/` but there is no ordered runner yet.

## 17. Observability requirements

Structured single-line JSON logs from functions (no PII/email bodies). Track:
which job, item, claimed?, counts, ms, result, skip-reason. Use Supabase
`pg_stat_statements` and advisors regularly. Add error tracking before production.

## 18. Rules for adding a new module/domain

1. Read this file. 2. Identify the affected domains + shared infra. 3. Model shared
concepts with the **canonical shared representation** (don't invent a parallel one).
4. Put external calls behind an integration function. 5. Extract pure logic into a
tested ESM module; keep the DOM glue thin in `app.js`. 6. If it syncs, follow §11.
7. If it runs in the background, satisfy every rule in §8. 8. If the AI should use
it, add a typed tool (§9). 9. Run tests + bundle + mobile-fit.

## 19. Rules for modifying shared infrastructure

Shared infra (§4) changes need extra care: preserve existing behavior, add a test
first, verify all dependent domains, and never regress the sync/merge invariants
(§11) or the background-job guarantees (§8). Prefer additive/adapter changes.

## 20. Anti-patterns to avoid

- Browser → external vendor with a secret. · AI → raw DB writes. · New synced list
  not registered in `mergeStates`. · A background action that regenerates its own
  trigger. · Unbounded retries/reads. · A second parallel representation of a shared
  concept. · Business logic living inside DOM render functions. · Adding to `app.js`
  when the logic could be an extracted, testable module.

## 21. Known technical debt

- **`app.js` is ~52k lines** — the shell holds state, sync, routing, and most
  domain UI. Mostly untested; the sync core (`state-sync.js`) is now extracted +
  tested. (Incremental extraction ongoing — the model, not a big-bang split.)
- **No staging**; SQL migrations in `migrations/` have no ordered runner yet.
- **No shared canonical models** for people/locations/events/tasks/subscriptions/
  documents — modeled ad hoc per domain inside the state blob.
- **RLS perf (partial):** `tableplan_states` consolidated to 1 policy/action with
  `(select auth.*)` (2026-08-20 migration). The low-value `auth_rls_initplan` wraps
  on the tiny (0–229 row) domain tables (eat_*, live_*, history, push) are
  intentionally deferred — no real perf value at current scale.
- **By design, not debt:** 3 `live_*` SECURITY DEFINER helpers stay EXECUTE-able by
  `authenticated` (the group RLS policy calls them; already `search_path=public`).
  `mail_*` deny-all RLS = fail-closed (service-role only).
- **Leaked-password protection** disabled in Auth (manual dashboard toggle).
- **Storage adapter** deferred: `tableplan_states` access = ~14 heterogeneous call
  sites behind `supabaseBaseUrl()`/`supabaseHeaders()`. Wrap the ~8 operations
  (load-sections, compare-and-swap persist, upsert) behind a `Storage` interface
  when a concrete second backend (PGlite / home-server PG) is on the table; the
  merge half of optionality already lives in `state-sync.js`.
- No music/audiobook **position persistence** (blocks unified Continue for audio).
- Multiple legacy names (Eat / Tableplan / Live) across repo, tables, prod URL.

*Fixed in the 2026-08-20 hardening pass: 6 function `search_path` warnings; 6
unindexed foreign keys; `tableplan_states` policy overlap + per-row auth
re-evaluation; CI added.*

## 22. Planned migrations

See the incremental migration plan in the audit. Headline items, all incremental
and non-destructive: (a) introduce an ordered migration runner + CI; (b) fix the DB
advisor findings (search_path, FK indexes, RLS `(select …)`, policy consolidation);
(c) extract `mergeStates`/state-sync from `app.js` into a tested module; (d) define
shared canonical models for people/locations/events as domains next touch them;
(e) wrap data access behind a storage adapter to preserve self-host optionality.

---

*Future development agents: follow the protocol in §18–19. When a project
convention exists, use it rather than inventing a new pattern.*
