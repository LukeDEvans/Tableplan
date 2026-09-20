# Calendar authority flip — decision record (HELD)

Status: **Calendar unification (Architecture Decision #1) is closed at its safe
Phase-3 state. The Phase-4 authority flip is HELD** (Luke, 2026-09-19) pending a
prerequisite fix in shared merge infrastructure. This file is the durable record of
*why* — it was moved out of local-only Claude Code project memory into the repo so a
cloud session (or a future contributor) sees it.

## Current state — safe and proven (do NOT change without re-opening the design)

- `state.calendars` (linked feeds) + `state.planCalendars` (ICS/local) are
  **authoritative**.
- `state.calendarSources` is a **forward-only derived mirror**, rebuilt on every
  `persist()` via `normalizeCalendarSources(state.calendars, state.planCalendars)`
  (app.js — search `calendarSources = normalizeCalendarSources`). Readers read it
  (Phase 2); fetch/cache is unified through it (Phase 3).
- All three lists are `unionById` + per-key-tombstone merged in `mergeStates`.

This is the Phase 2/3 end state, already shipped to `origin/integration` and proven
safe. `STATE_SCHEMA_VERSION` is **5** and stays there.

## Why Phase 4 (authority flip via read-compat shim) is held

The Phase-4 plan was: make `calendarSources` authoritative, repoint the ~11 write
sites to it, and **reverse-derive** the legacy lists from it in `persist()` (a
read-compat shim for not-yet-updated clients), with **no** `STATE_SCHEMA_VERSION`
bump. Design review + a runnable proof against the real merge primitive
(`state-sync.js` `unionById`) found a correctness gap:

**Delete-resurrection.** Calendar deletes tombstone **only** under `"calendars"` /
`"planCalendars"` (`recordDeletion(...)`, app.js:17586 and ~26325) — **never**
`"calendarSources"`. `unionById` filters each key by *its own* tombstone set. Today
this is harmless because `persist()` re-derives `calendarSources` *from* the
(correctly tombstone-filtered) legacy lists — the forward-derive masks the missing
`calendarSources` tombstone. **The flip inverts that ordering**, so `calendarSources`
becomes authoritative while still carrying the deleted entry, and reverse-derivation
puts the deleted calendar back into the legacy lists.

Proof result (cross-device sim, old-code client vs new-code client both syncing one
row): **ADD reconciles cleanly; DELETE resurrects.** The sharp edge is an **old
(deployed) client's delete** — old code tombstones only the legacy key and cannot be
changed, so on any new client that reverse-derives, that delete is silently undone.
(id-safety was fine: reverse-derive is a `filter` by `source` plus id-preserving
normalizers — no new ids, round-trips cleanly.)

## The prerequisite if the flip is ever revisited (Option A)

Make `mergeStates` filter `calendarSources` by the **union** of
`tombstones["calendars"] ∪ tombstones["planCalendars"] ∪ tombstones["calendarSources"]`,
so a delete recorded under a legacy key also purges the derived/authoritative list
(covering old-client deletes too).

**This touches shared merge infrastructure (`mergeStates`), not just calendar** — see
`ARCHITECTURE.md` §19 (shared infra: flag, don't silently change). So it needs its
**own scoped design + proof pass to the same standard** used here — structural
argument + live-data check + a cross-device old/new-client merge simulation — **before**
any authority flip. It must **not** be folded in as a side effect of finishing the
calendar migration.

## The schema bump is finance-only (do not bump it for calendar)

`STATE_SCHEMA_VERSION` has exactly one consumer: the `tp_protect_finance_merge`
Supabase trigger, which rejects **finance-key** writes from clients whose
`schemaVersion` is lower than the row was last written with. It does nothing for
calendar. Bumping it for a calendar change would only start rejecting old-code
**finance** writes — an unrelated side effect. Keep it at 5 unless a *finance* change
justifies a bump.

## Pointers

- Merge primitives: `state-sync.js` (`unionById`, tombstones) — unit-tested.
- Merge orchestration + the calendar keys: `mergeStates` in `app.js`.
- Decision context: `CLAUDE.md` → "Architecture Decisions" → Decision #1.
