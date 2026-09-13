# Live App — Claude Instructions

## What this app is

**Live** (a.k.a. **"Tableplan"** / "Eat") is a single-page, **vanilla-ESM web app —
no framework**. Its entire UI and most logic live in one very large file,
**`app.js`** (~55k lines), backed by domain-specific helper **modules** at the repo
root (`finance-*.js`, `travel-*.js`, `music-*.js`, `media-*.js`, the `calendar/`
dir, etc.). It spans many domains in one app: **calendar/tasks · recipes /
meal-plan / groceries · finance · travel · health / nutrition · contacts · music &
media · mail · publications · weather**, and more.

Built with **Vite → `dist`**; shipped as a PWA and wrapped as a native iOS app via
Capacitor (see [CAPACITOR.md](CAPACITOR.md)). Backend is **Netlify Functions +
Supabase**. State is a per-user JSONB blob, sectioned and merged (not a relational
model, except recipes). See the domain map and parallel-development rules at the
bottom of this file.

## Backend & infrastructure (Supabase + Netlify)

- **Supabase** is the backend — Postgres + Auth + Storage. **Project ID:
  `noyocjcltrenwdovqrql`** (prod). App state lives in **`tableplan_states.state`**
  (one JSONB row per user/group, sectioned — see [ARCHITECTURE.md](ARCHITECTURE.md)
  §5). Recipes are the one relational domain (`eat_recipes` / `eat_folders`).
- **Netlify** hosts the site (prod: `effervescent-malabi-e0af55.netlify.app`) and
  the serverless functions. **All external API calls and secrets go through a
  Netlify Function** — never browser→vendor with a key (ARCHITECTURE §7).

### Supabase — hard-won cautions (read before writing any data-access code)

- **DO NOT poll Supabase tables aggressively.** A prior **egress blowout** was
  traced to a client **polling `tableplan_states` every 5–15 seconds**. Never add a
  `setInterval`/recursive-`setTimeout` loop that re-reads a Supabase table on a
  short cadence. Instead **throttle/debounce**, **cache** in memory/state, or use
  **Supabase Realtime subscriptions** (push, not poll). Any read loop against a
  Supabase table must be bounded and justified (ARCHITECTURE §8: bounded,
  idempotent, rate-limited, non-self-amplifying).
- **Beware unguarded effect/retry loops around auth.** An **auth request storm**
  was previously caused by an unguarded retry / `useEffect`-style loop re-running
  session/auth checks. When touching auth/session code, guard re-entry, **bound
  retries**, and pin effect dependencies so a session check can't re-trigger itself.
- **Don't trust infra status alone when debugging Supabase.** The Supabase
  `get_project` API can report **`ACTIVE_HEALTHY`** even while the dashboard shows
  billing / quota / egress problems. Cross-check the dashboard (usage, billing,
  logs) — a green API status is **not** proof the project is healthy.
- **Applying DB changes:** the bundled Supabase MCP has been unreliable here
  (crypto errors) and no DB password/PAT ships in the repo, so DDL/migrations and
  Storage RLS policies are applied via the **Supabase SQL editor** (or `migrations/`
  run there). Don't assume programmatic DDL access.

## Architecture

**Before making substantial architectural or cross-domain changes, read [ARCHITECTURE.md](ARCHITECTURE.md) and follow its conventions.** It is the governing architectural reference: system layers, module/data ownership, and the rules for state/sync, integrations, background jobs, AI tools, and adding new modules. When a project convention exists there, use it rather than inventing a new pattern.

## Working style

**Ask questions when you need further guidance.** If a request is ambiguous or a decision could go multiple ways that Luke would care about, ask rather than guessing.

## Development workflow & principles

The recommended flow for substantial work — and the conventions behind it — live in [DEVELOPMENT.md](DEVELOPMENT.md): `INTENT → SPEC → PLAN → IMPLEMENT → ADVERSARIAL REVIEW → FIX → VERIFY → SHIP`, plus the `/recap` loop for resuming long-running work. Core principles that govern every session:

- **Evidence beats assertion.** Distinguish observed fact, verified behavior, inferred behavior, assumption, and proposed change — and label which is which. **"Tests pass" is never proof the whole feature works**; say what you actually verified and how.
- **Decision boundaries.** Make ordinary implementation calls autonomously, but **stop and ask** when a choice materially affects architecture, data integrity, security, auth, secrets, production infra, DB migrations, deployment, destructive/irreversible operations, or major product behavior.
- **Audit ≠ implementation.** When asked for an audit or review, inspect → analyze → report → recommend. **Do not silently start fixing** unless implementation was explicitly authorized.
- **Verification is mandatory.** "Implementation complete" (code written) and "task verified" (evidence it behaves correctly) are different states — a finished task carries verification evidence.
- **Don't restart from zero.** When continuing work, run `/recap` first: inspect git state, artifacts, tests, and memory to establish what's actually done before assuming it isn't.

**Skills:** `/recap` (re-establish reality, read-only) and `/adversarial-review` (fresh subagent attacks a change before it ships). Durable project knowledge lives in `ARCHITECTURE.md` (the constitution) and the file-based memory (`~/.claude/projects/-Users-luke/memory/`) — prefer those over re-deriving context each session.

## UI conventions

**Toggle switches:** the house toggle is `<input type="checkbox" class="live-toggle">` — a 36×20 pill with sliding knob, defined in styles.css (search "House toggle switch"). Use it for every new on/off control instead of inventing a style. Beware the `.recipe-form label` grid rule: labels containing a toggle must be added to its `:not(...)` exclusion list or laid out with their own flex row.

## Mail AI features

Every AI email-processing feature MUST have an on/off toggle in Settings → Mail AI. To add one: (1) add an entry to the `MAIL_AI_FEATURES` registry in app.js (key, label, description) — the toggle UI renders automatically; (2) the server-side function must check its flag in `state.mailAiSettings.<key>` (config section, row `personal:config`) and do nothing when off. Features are off by default.

## Git / GitHub

**Local commits are welcome — commit freely as work completes.** Luke likes reviewing changes locally before they go out.

**Never `git push` without explicit permission — ask first, every time.** Pushing to main auto-triggers a Netlify deploy, which spends limited deploy credits (and GitHub pushes are capped ~20/month). Batch work into local commits, then when ready ask: "OK to push?" Never push automatically as part of a task.

**Before any push, run through [PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md)** — especially the mobile horizontal-fit pass (every page must lay out within a ~360px phone; no sideways scroll, nothing clipped at the right edge). Report anything that fails before pushing.

## Domains & parallel-agent development

This repo is set up for **parallel, multi-agent work** (Claude Code subagents and
cloud/web sessions) — one agent per domain. Per-domain subagents live in
[.claude/agents/](.claude/agents/). [ARCHITECTURE.md](ARCHITECTURE.md) §4 is the
source of truth for boundaries; this table maps the parallel-work domains to their
code. Read **Architecture Decisions** (below the table) before working calendar,
the recipes cluster (recipes / meal-plan / groceries / cook), or health.

| Domain | Dedicated modules | `app.js` area (`activeAppArea`) | Data home |
|---|---|---|---|
| **finance** | `finance-actuals.js`, `finance-csv.js`, `finance-sync.js`, `finance-review-gesture.js`, `receipt-domain.js`, `receipt-scan.js` | `"finance"` | `tableplan_states` JSONB (`state.finance*`) — **Supabase-only, never localStorage** |
| **calendar** | `calendar/` (`recurrence.js`, `model.js`, `projection.js`, `tasks-project.js`, `sources.js`, `reconcile.js`, `normalize.js`, `ics.mjs`) | `"plan"` (calendar) + `"do"` (Tasks) | `state.planEvents`; **`state.calendars` + `state.planCalendars` will be unified into one canonical list (`source: "linked" \| "ics"`) — see Architecture Decision #1** |
| **recipes** | `recipe-scan.js` (recipe CRUD/folders + scan) | `"eat"` (recipes) | **relational** `eat_recipes` / `eat_folders` |
| **meal-plan** | `meal-plan-servings.js` (planning + servings scaling) | `"eat"` (meal plan) | state sections |
| **groceries** | `grocery-catalog.js`, `grocery-sources.js` | `"shop"` | state sections |
| **cook** | *(cook mode — currently in `app.js`)* | `"eat"` (cook) | state sections |
| **travel** | `travel-*.js` (geo, ingest, interpret, itinerary, mode, model, optimize, refs, transitions) | `"explore"` | `state.travel*` (canonical in `travel-model.js`) |
| **health** *(no health module yet)* | none — nutrition & Daily Dozen (`daily-dozen.js`, `nutrition-domain.js`, `nutrition-provider.js`) are **owned by the recipes cluster** (Decision #3); `food-health*.js` + the `"sweat"` exercise UI stay in `app.js` for now | `"sweat"` (exercise) | state sections |
| **contacts** | `contacts.js` (rendering, editing, groups, photo, vCard import/export, all contacts state) — `app.js` keeps only the `showContactsApp` nav entry + the injected module wiring | `"contacts"` | `state.contacts`, `state.contactGroups` (no canonical `people` model yet — §21) |
| **music** | `music-streaming.js`, `music-provider-*.js` (applemusic/internetarchive/jamendo), `music-canonical.js`, `music-library*.js`, `music-source-resolver.js`, `music-tags.js`, `media-provider-music.js` | `"media"` (music tab) | `state.musicLibrary`, `state.appleMusic`, media state |
| **weather** | `weather-ui.js` (service + page render/handlers + radar map) `createWeatherModule(deps)`; pure logic in `weather-cache.js` / `weather-condition.js` / `weather-art.js` — `app.js` keeps only `showWeatherApp` + the shared `ensureLeaflet` loader | `"weather"` | `state.weatherLocations`, `state.weatherActiveLocationId`. **Cross-domain:** `getCurrentConditions()` is consumed by Travel Mode; `ensureLeaflet` (Leaflet CDN loader) is shared with Travel Mode's map |

**⚠️ The central constraint: `app.js` is ONE shared file.** Every domain's
rendering, event handlers, and state wiring live as *sections inside* `app.js` —
only the helper modules above are physically separate. So two agents on two domains
both edit `app.js` → **merge conflicts are the default failure mode.** Mitigations:
keep each domain's edits inside that domain's own `render*`/handler sections and its
dedicated modules; prefer moving logic *into* a domain module over growing `app.js`;
land small, frequent commits; and treat any `app.js` edit outside your domain's
sections as a shared-infra change (below).

### Architecture Decisions (recorded — do not re-litigate)

Decisions Luke has already made about upcoming extractions. Agents working these
domains **follow them and do not reopen the debate.** None are implemented yet —
they are direction for when the work starts.

**1. Calendar — unify the two calendar lists.**
`state.calendars` (linked / eat-side calendars) and `state.planCalendars`
(ICS-imported calendars) will be merged into a **single canonical list**, with a
field (e.g. `source: "linked" | "ics"`) distinguishing origin. **Prerequisite before
any calendar extraction or refactor begins:** map **every** read and write of both
`state.calendars` and `state.planCalendars` across `app.js` (and record them here or
in a linked doc) — the blast radius is large (`renderPlanPage()` alone has ~42 call
sites), so it must be visible up front, **not discovered mid-refactor.** Do **not**
start the unification opportunistically inside another change, and do not begin it
until that map exists.

**2. Recipes cluster — separate modules, not one domain.**
Recipes, meal-plan, groceries, and cook are **separate modules** — not one "recipes"
domain with internal files — because they evolve independently in practice. Shared
behavior between them (meal-plan generating a grocery list; servings scaling) must be
**explicit injected interfaces between modules** — the same pattern as contacts'
`refreshPlanIfActive` hook — **never** direct cross-module reaches into another
module's internals. The single `recipes` subagent should eventually be **split to
match** (one agent per module: recipes / meal-plan / groceries / cook).

**3. Nutrition / Daily Dozen — owned by recipes for now, behind a narrow interface.**
There is **no health/wellness domain today, and none planned soon.** Nutrition and
Daily Dozen tracking (`daily-dozen.js`, `nutrition-domain.js`,
`nutrition-provider.js`) **stay owned by the recipes cluster.** Keep them behind a
**small, narrow public interface** (a limited set of functions / data shapes), not
tangled into recipe internals — so a future health/wellness domain, if one is ever
built, can consume nutrition data through that interface **without re-extracting it.**
**Do not build any health-side abstraction now** — just keep the recipes-side
interface clean.

### Shared infrastructure — flag, don't silently change

Used by every domain; a change here can break another agent's page, so **surface
the intended change (with rationale) rather than editing silently** (ARCHITECTURE
§19): auth/session · state + sync (`STATE_SECTIONS`, `mergeStates`, tombstones,
`state-sync.js`, `finance-sync.js` deep-merge) · global nav / `activeAppArea`
routing · the shared boot/render scaffolding in `app.js` · notifications/push ·
media playback (`playback-engine.js`, `playback-coordinator.js`) · the media hub
(`media-*.js`) · the settings-dialog framework · design tokens (`styles.css`).

**Naming trap:** the root `music-*.js` files + the `"media"` music tab are the
**streaming-music** domain. The `music/` **directory** is a *different* subsystem —
piano-practice / score-following (Cadence). Don't conflate them.
