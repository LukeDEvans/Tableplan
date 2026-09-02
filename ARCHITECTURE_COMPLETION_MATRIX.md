# Architecture Completion Matrix

> The single authoritative tracker for the maximalist architecture program (started
> 2026-09-02). Every architectural item from the prior audit, addendum, constitution
> known-debt, and design docs is listed here and driven to a **resolved** state:
> **IMPLEMENTED**, **DESIGNED** (concrete design, implementation gated on a named
> external prerequisite), **INCORPORATED** (folded into another mechanism), or
> **REJECTED** (with architectural rationale + a concrete revisit trigger — never
> "premature" alone). No item may remain an unexplained yellow.
>
> Baseline: the 12-commit local checkpoint (finance-sync, account-boundary, calendar
> dialog, podcast, workflow infra, audit addendum, QA doc). **This program is
> local-commit-only: no push, no deploy, no production DB/infra change.**
>
> Status column: `RESOLVED` = the slice landed; `PROPOSED` = disposition decided,
> slice not yet executed. This file is updated at the end of every slice.

## Protected invariants (must not be undermined by any item)

- **Account boundary:** after an authenticated account transition, no state,
  hydration flag, pending write, IndexedDB store, or locally-authoritative data of
  the previous account may be used for or persisted to the new account. Any new
  cache/persistence/job/event/tab mechanism MUST declare its account ownership +
  lifecycle and be covered by the account-scoped completeness fitness test.
- **Local-first:** truth is in-memory + local mirror; cloud is a replica. No item
  may introduce a hard network dependency for personal-domain read/write.
- **Infra portability:** no item may hard-code the Netlify/Supabase topology into
  domain logic (home-server/Postgres future must stay reachable).
- **No-deploy:** the program commits locally only.

## A. Already implemented (baseline — no new work; listed so nothing is re-audited)

Local-first sectioned state/sync (`state-sync.js`, unionById + tombstones + CAS) ·
finance sync safety (`finance-sync.js`) · single-tab account-boundary reset
(`auth-account-reset.js`) · unified import gateway (`CONTENT_IMPORT.md`, `_import-*`) ·
capability/provider registry (`media-provider.js` `MEDIA_CAP`/`PROVIDER_CATALOG`) ·
media provider architecture · playback coordinator/engine · content store
(`content-store/`) · TTS provider architecture · architecture constitution
(`ARCHITECTURE.md`) + audit + addendum · CI + ~1011 tests · incremental app.js
extraction (ongoing process, not a discrete item).

## B. Remaining inventory — proposed dispositions

| # | Item | Prior state | Proposed disposition | Slice | Depends on | Revisit trigger | Rationale (short) |
|---|---|---|---|---|---|---|---|
| 1 | North-star / target-state architecture | partial (ARCH §1) | **IMPLEMENTED** (consolidate 1-page North Star) | 1 | — | — | Anchors every downstream disposition. |
| 2 | Scorecard / quality attributes | none | **IMPLEMENTED** (living scorecard, 13 attributes) | 1 | 1 | — | Makes future decisions measurable. |
| 3 | Complexity budget / do-nothing / negative recs / reversibility / invalidation / revisit triggers | partial (addendum) | **IMPLEMENTED** as operational guardrails (this matrix + ARCH) | 1 | 1 | — | Turns principles into per-item guardrails. |
| 4 | Architecture fitness tests / quality gates | 1 exists (storage-key completeness) | **IMPLEMENTED** (fitness test suite) | 2 | 1 | — | Encodes invariants so drift fails CI. |
| 5 | Multi-tab account isolation | yellow/outstanding | **IMPLEMENTED** (cross-tab transition detection + coordinated reset) | 3 | 4 | — | Real safety gap; extends the protected invariant across tabs. |
| 6 | Provenance / data lifecycle | none formal | **IMPLEMENTED** (lightweight provenance contract at ingress) | 4 | 4 | — | Substrate for AI, search, diagnostics, recovery. |
| 7 | Cross-domain domain-model convergence (people/locations/events/…) | yellow (ARCH §21) | **DESIGNED** + incremental (canonical refs as-touched) | 5 | 6 | a domain re-models one of these | Big-bang unification is the wrong move; converge on contact. |
| 8 | Platform capabilities | partial (media registry) | **INCORPORATED** into a capability catalog over the existing registry | 5 | — | — | Generalize what exists; no parallel registry. |
| 9 | Reorderable-list primitive | design-only (~85 sites) | **IMPLEMENTED** (one interaction primitive) | 6 | 4 | — | Highest concrete duplication win; audit-flagged. |
| 10 | Developer diagnostics | none | **IMPLEMENTED** (dev-only diagnostics surface) | 7 | 6 | — | Observes sync/hydration/account/providers/errors. |
| 11 | Today projection / orchestration | design-only (audit §13) | **IMPLEMENTED** (`projectToday(state, now)` per-domain + compose) | 8 | 6 | — | Deterministic substrate for Home + AI. |
| 12 | Full AI-readiness substrate | design-only (audit §14) | **INCORPORATED** (provenance + projections + contracts + diagnostics) | 9 | 6,11 | — | Make the app legible/operable; no AI framework. |
| 13 | Search / indexing | deferred | **DESIGNED** + lightweight IMPLEMENT (projection-backed in-memory index) | 10 | 11 | multi-thousand-item scale / cross-domain query need | No external engine; index the projections. |
| 14 | Rules / automation engine | deferred | **REJECTED (generic)** — keep deterministic domain logic | 11 | — | ≥3 domains grow declarative user-authored rules | A generic engine has no consumer; domains own their invariants. |
| 15 | Generic jobs / operations framework | deferred | **INCORPORATED** — minimal async-operation status contract; reject generic job engine | 11 | 10 | background job *types* outgrow ARCH §8 | §8 already governs jobs; add only a status contract diagnostics can read. |
| 16 | Generic workflow orchestration | deferred | **REJECTED** — the one multi-step flow (import) owns its steps | 11 | — | a 2nd genuine multi-step, resumable workflow appears | A workflow engine with one consumer is overhead. |
| 17 | Event bus | deferred | **REJECTED (generic)** — direct calls + derived state; narrow emitter only if a slice proves need | 11 | — | a consumer needs a signal it cannot read from `state` | Everything is one in-memory `state`; pub/sub adds indirection. |
| 18 | Plugin architecture | deferred | **REJECTED** — provider/capability registry IS the extension boundary | 11 | 8 | real 3rd-party/out-of-tree extension demand | Interfaces + capability discovery already solve it. |
| 19 | Storage adapter (infra portability) | deferred (ARCH §21) | **DESIGNED** + partial wrap of the ~8 state ops | 12 | — | a concrete 2nd backend (PGlite/home Postgres) is chosen | Keeps the self-host future reachable; full swap gated on a real backend. |
| 20 | Ordered migration runner + CI | yellow (ARCH §22a) | **DESIGNED** (local runner convention; infra-gated) | 12 | — | staging env or >1 SQL migration/week | Applying migrations = prod DB change, out of this local-only program. |
| 21 | Remaining DB advisor fixes | partial | **DESIGNED / deferred (infra-gated)** | — | 20 | next DB hardening pass w/ approval | Needs `apply_migration` + approval; low value at scale. |
| 22 | Offline mutation queue (per-op ordering) | deferred | **REJECTED** — retry-reflush + CAS suffices | 12 | — | a domain needs cross-device per-op ordering | Union+tombstone merge doesn't need an oplog yet. |
| 23 | Music/audiobook position persistence | yellow | **DESIGNED** (fold into media progress + projection) | 8 | 11 | unified audio Continue is scheduled | Feature-level; the projection slice gives it a home. |
| 24 | Legacy naming (Eat/Tableplan/Live) | debt | **REJECTED as architectural** (cosmetic; no boundary) | — | — | a user-facing rename is scheduled | Not an architectural boundary; churn > value now. |

## C. Dependency-aware execution order (slices)

1. **Architectural framework** — North Star, scorecard, guardrails (reversibility /
   invalidation / complexity / do-nothing / negative-recs) → into ARCHITECTURE.md +
   this matrix. *(items 1-3)*
2. **Architecture fitness tests** — encode invariants (no cross-domain deep imports;
   providers behind adapters; every synced id-keyed list registered in merge +
   tombstones; domain modules DOM-free; account-scoped storage completeness [exists]).
   *(item 4)*
3. **Multi-tab account isolation** — cross-tab transition detection + coordinated
   reset, distinguishing a real account change from token-refresh noise. *(item 5)*
4. **Provenance / lifecycle** — an ingress-time provenance contract. *(item 6)*
5. **Domain-model convergence + platform capabilities** — canonical refs (as-touched)
   + capability catalog over the existing registry. *(items 7, 8)*
6. **Reorderable-list primitive** — one interaction primitive; migrate a first
   consumer. *(item 9)*
7. **Developer diagnostics** — dev-only surface over sync/hydration/account/providers.
   *(item 10)*
8. **Today projections** — `projectToday` per-domain + composition (+ item 23). *(item 11)*
9. **AI-readiness substrate** — incorporate provenance + projections + contracts;
   document the boundary. *(item 12)*
10. **Search / indexing** — projection-backed in-memory index. *(item 13)*
11. **Deferred-frameworks reconciliation** — rules / jobs-operations / workflow /
    events / plugin: reject-generic / incorporate-minimal with rationale + triggers.
    *(items 14-18)*
12. **Infra portability** — storage-adapter design + partial wrap; migration-runner
    design; offline-queue rejection. *(items 19-22)*

*(Slices are independently committed and reviewed; order is dependency-driven, not
the worklist's original order. Multi-tab is elevated early as an outstanding safety
item. Deferred frameworks come late because their disposition depends on whether the
earlier slices — diagnostics, projections — surface a genuine consumer.)*

## D. Progress log (updated per slice)

- **Slice 1 — Architectural framework — RESOLVED (items 1,2,3 IMPLEMENTED).** Added
  ARCHITECTURE.md §23 North Star, §24 living scorecard (13 attributes, honest grades),
  §25 decision guardrails (8-question template + standing negative-recommendation list
  with revisit triggers). No new doc; folded into the constitution. Commit: see log.
- **Slice 2 — Fitness tests — RESOLVED (item 4 IMPLEMENTED).** `test/architecture-fitness.test.js`
  (97 assertions): pure-core DOM-free, dependency direction (no domain→shell import;
  primitives import nothing), no client-shipped secrets, critical synced lists
  registered in mergeStates, finance excluded from the localStorage mirror, account-scoped
  storage guard present. Each rule adversarially confirmed to catch violations and ignore
  comment mentions. Added `test/architecture-*.test.js` to the vitest include.
- **Slice 3 — Multi-tab account isolation — RESOLVED (item 5 IMPLEMENTED).** Pure
  `accountTransitionKind(prevId, session)` (auth-account-reset.js) separates a genuine
  account transition (changed/signout) from token-refresh noise (refresh) via account
  identity (user id, email fallback; unidentifiable→refresh, never a destructive reset).
  `app.js` tracks `stateAccountId`, set at boot before the listener registers (so
  INITIAL_SESSION is a no-op) and synchronously at the top of first-hydrate; on a
  transition it clears+purges+reloads. Adversarial review (subagent) found 3 issues —
  all fixed: (1) await IDB purges before reload with provider nulled first so no write
  fires during the wait; (2) claim identity before the hydrate awaits; (3) clear the
  retry timer too. Relies on Supabase's default cross-tab auth broadcast (no parallel
  machinery). 8 new lifecycle tests; 1116 green; build clean. Manual multi-tab steps in
  QA_ACCOUNT_SWITCH.md; constitution §10 note added.
- **Slice 4 — Provenance / lifecycle — RESOLVED (item 6 IMPLEMENTED).** `provenance.js`:
  pure contract (ORIGIN manual/imported/provider/generated/derived; makeProvenance with
  origin-defaulted `refreshable`; markUserModified/markObserved immutable updates;
  describeProvenance answers where-from / current? / safelyRegenerable). Wired at genuine
  article ingress points (import-extracted, URL-quick-save, email→Media) — not blanket
  metadata; rides sync as a normal record field. 24 tests; added to pure-core fitness +
  vitest include. Constitution §5 note. Substrate for diagnostics (7), AI-readiness (9),
  search (10).
