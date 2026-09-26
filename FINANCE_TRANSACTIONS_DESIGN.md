# Durable Finance Transaction Store — Design (INTENT → SPEC → PLAN)

> **Status: APPROVED 2026-09-26 (Q1 90-day backfill · Q2 annotations deferred · Q3 60-day deck).**
> Progress:
> - **Done:** steps 1 (pure core), 3 (server ingest), 4 (client store module) and 5 (read
>   flip behind `financeTxnSource`, **default "feed"**).
> - **Waiting on you:** applying the step 2 SQL (`migrations/2026-09-26-finance-transactions.sql`),
>   then turning on "Use stored transaction history" (Settings › Finance › Bank link) to compare
>   against the feed.
> This is a **finance data-authority change** (CLAUDE.md decision boundary): it has the same
> shape as the calendar authority flip, so every phase that changes what finance *reads*
> is gated separately.
>
> **Sequencing (Luke, 2026-09-26):** this ships **before** the receipts ledger
> ([RECEIPTS_LEDGER_DESIGN.md](RECEIPTS_LEDGER_DESIGN.md)). Receipts will link to rows in this
> store.

Evidence labels: **[observed]** = read in code (file:line). **[inferred]** = reasoned from
code, not run. **[proposed]** = new design.

---

## 0. Audit findings that shape the design

| # | Finding | Evidence |
|---|---|---|
| T1 | Bank transactions exist only in the `finaccts_<group>` cache row, overwritten on every pull with a **45-day** window. Nothing older than ~45 days survives anywhere. | `daily-briefing.js:233-273`, `simplefin.js` `accounts`, `finance-ui.js:430` |
| T2 | There are exactly two bridge callers, both server-side: the daily cron (one call per group per day) and `simplefin accounts` when the cache is stale or forced. | same |
| T3 | `financeLabeledTxns()` builds the list from `financeLive.accounts[].transactions` + `state.financeManualTxns`. The downstream steps are pending→posted dedupe, sign flips, offsetting pairs, transfer pairs, labels, rules and return links. | `finance-ui.js:542-690` |
| T4 | Per-txn annotations (`financeTxnLabels`, `financeTxnNoteOverrides`, `financeTxnLinks`, `financeTxnSignFlips`) are JSONB maps keyed by raw txn id, each **capped at 600** (least-recent evicted). | `finance-ui.js:756,789,2024,2052,2065` |
| T5 | ⚠️ **Critical interaction.** `financeMonthsToSnapshot` re-snapshots every past month that the loaded txns "fully cover" (earliest txn ≤ the 1st of the month). If the list suddenly covers years, **every past month is recomputed**. Old txns whose labels were evicted by the 600 cap would come back unlabeled, and **past budget actuals would silently shrink or get overwritten**. | `finance-actuals.js:28-37`, `finance-ui.js:1726-1760` |
| T6 | CSV import writes **only** month aggregates (`financeMonthActuals`), and only for months with no snapshot yet. Rows are discarded. | `finance-ui.js:257-293`, `finance-csv.js:91` |
| T7 | Manual txns live in JSONB `financeManualTxns`, which is a `FINANCE_LOCAL_AUTHORITATIVE_KEYS` member and unioned on merge. | `finance-sync.js`, `finance-ui.js:817-859` |
| T8 | SimpleFIN returns up to ~90 days on request. The app always asks for 45 today. | `simplefin.js` (`days` clamp 1–90) |

T5 is the main risk in this project. §5 is designed around it.

---

## 1. Intent

**Problem.** The app forgets every bank transaction after ~45 days, and CSV history is turned
into anonymous monthly totals. Nothing can be matched, searched, reported on, or linked (to
receipts) beyond that window.

**Outcome.** Every transaction the app ever sees, from SimpleFIN, CSV or manual entry, is
stored permanently, **once**. The app keeps its own ledger and SimpleFIN becomes one feed into
it.

**Non-goals (this project).**
- Moving labels, splits and notes out of JSONB. That's §9, a later decision.
- Changing how budgets are computed.
- Adding bank API calls.
- Polling.
- Realtime.

---

## 2. Schema — `finance_transactions` [proposed]

| column | type | notes |
|---|---|---|
| `id` | text PK | **The id the app already uses**, so every existing JSONB annotation keeps working unchanged. Bank: the SimpleFIN txn id. Manual: the existing `fin-man-…` id. CSV: `csv_<hash>` (§4.2). |
| `group_id` | text | group, or `u-<uid>` (same RLS pattern as the receipts design) |
| `origin` | text | `simplefin` \| `csv` \| `manual` |
| `account_id` | text | SimpleFIN account id, `manual:<slug>`, or a CSV-assigned account |
| `posted` | timestamptz | |
| `amount` | numeric(12,2) | signed, as the bank reports it (sign flips stay a JSONB overlay) |
| `description` | text | raw bank/CSV text (≤ 200) |
| `pending` | bool | |
| `status` | text | `active` \| `superseded` (pending replaced by its posted copy) \| `vanished` (pending that never posted, e.g. a declined pre-auth) \| `deleted` (**soft delete** for CSV undo / manual delete — incremental `updated_at` sync can't see a hard delete, so clients never hard-delete; re-importing an undone CSV revives its rows back to `active`) |
| `superseded_by` | text null | id of the posted row that replaced this pending one |
| `import_label` | text null | category key supplied **by the source** (the CSV Category column). It's the lowest-priority label, below explicit labels and rules, so CSV categories never touch the 600-capped `financeTxnLabels` (T4). |
| `import_batch` | text null | CSV import batch id, so a batch can be undone |
| `first_seen_at`, `last_seen_at` | timestamptz | |
| `created_at`, `updated_at` | timestamptz | trigger-maintained |

- **Primary key `(group_id, id)`.** The app already keys every annotation by the raw txn id
  (T4), so the store keeps that same assumption: SimpleFIN ids are treated as unique within a
  group.
  - **Known risk:** if SimpleFIN is ever reconnected and the bank issues new account/txn ids,
    the same charges would re-ingest under new ids. The pending/posted reconcile won't catch
    that; it needs an explicit "reconnect remap" tool. That's out of scope here, logged in §11.
- **Indexes:**
  - `(group_id, posted desc)`
  - `(group_id, updated_at)` (incremental sync)
  - `(group_id, account_id, posted)`
  - `(group_id, status)`
- **RLS:**
  - members may **read** all rows;
  - members may **insert/update/delete** only rows where `origin in ('csv','manual')`;
  - `simplefin` rows are **service-role-only writes**, so a client can never fabricate or
    edit a bank row.

---

## 3. Ingest — SimpleFIN → store (server, additive) [proposed]

- **Where.** Both existing bridge callers (T2): the daily cron, and `simplefin accounts` on a
  real bridge fetch (not on a cache hit). Right after they write `finaccts_`, they call the
  shared `_finance-ingest.js` `ingestFeed(serviceKey, groupId, accounts)`. **No new bridge
  calls, no new schedules.**
- **"Only take in what it hasn't already."** One bulk
  `POST /finance_transactions?on_conflict=group_id,id` with
  `Prefer: resolution=merge-duplicates`. Payload is bank-owned columns only: `amount, posted,
  description, pending, account_id, last_seen_at`. Consequences:
  - A txn seen before is an upsert that changes nothing (or updates a posted amount the bank
    corrected).
  - A new txn is inserted.
  - App-owned columns (`import_label`, `status` when set by reconcile) are never overwritten.
- **Pending → posted** (pure `reconcilePending(storeRows, feedTxns)`, unit-tested). After the
  upsert, for each `pending` row **absent** from a feed that covers its date:
  - **Posted successor found:** same account, posted 0–7 days later, shared merchant token.
    The amount may differ (gas / pre-auth). If there is **exactly one**, set
    `status='superseded'` and `superseded_by=<posted id>`. The client's existing label
    migration (`finance-ui.js:579-612`) is generalized to follow `superseded_by`, which also
    fixes the pre-auth case it misses today.
  - **No successor after 10 days:** `status='vanished'`. It's hidden from lists, kept for
    audit.
  - **Ambiguous:** leave the row as is and let the existing client-side dedupe decide, as
    today.
- **Backfill.** On the first ingest per group, request `days=90` (SimpleFIN's max) once, so
  the store starts with ~90 days rather than 45. This runs once, guarded by a
  `finance_ingest_state` marker in the existing `finaccts_` cache row, so there's no new table.
- **Bounded (ARCH §8).**
  - ≤ 90 days × accounts per call, in one bulk request.
  - Idempotent by PK.
  - Can't re-trigger itself: ingest never calls the bridge.
  - Failure is isolated. An ingest error is logged and **never** blocks the cache write or
    the balance snapshot.

---

## 4. CSV import → real rows [proposed]

### 4.1 Flow
1. Pick a file.
2. **Pick the account it belongs to:** a linked account, or "New imported account" (name it).
3. **Preview (dry run):**
   - rows parsed / invalid,
   - new rows vs duplicates of rows already stored (per §4.2),
   - categories recognised / unrecognised,
   - the months affected.
4. Confirm → bulk insert → month actuals filled **only for months with no snapshot**
   (preserves today's never-clobber rule, T6), now computed from rows.
5. **Undo import** deletes by `import_batch`.

### 4.2 Duplicate rules ("don't take in what we already have")
- **Same file twice.** The id is `csv_<hash(account|date|amount|normalized description|n)>`,
  where `n` is the occurrence index of identical rows within the file. That keeps two real
  identical charges on the same day as two rows, while re-importing the file inserts nothing.
- **CSV overlapping SimpleFIN history.** Same account, date ±1 day, same amount, and an
  overlapping merchant token → **skip**, and count it in the preview as "already have
  (from bank)". Where several candidates tie, pair them one-to-one by date order.
- **A CSV row whose account wasn't chosen as a linked account** is never deduped against bank
  rows (different accounts).

`finance-csv.js` gains pure `csvRowsToTxns(rows, {accountId, nameToKey})` and
`dedupeImport(candidates, existing)`, with tests. The `Account`/`Description` columns are read
when present.

---

## 5. Read path — finance reads the store [proposed; the authority flip, gated]

### 5.1 What changes
`financeLabeledTxns()` sources `bankTxns` from the **store** instead of
`financeLive.accounts[].transactions`. Everything downstream is unchanged:
- dedupe,
- sign flips,
- offsetting and transfer pairs,
- labels, rules, return links.

`import_label` is inserted as a new label tier, after explicit labels and before
rules/auto:

`explicit (manual) > import_label ("imported") > rule/auto`

Balances, account names and orgs still come from `financeLive` (the accounts payload). Only
*transactions* move.

### 5.2 Loading without egress blowups (CLAUDE.md)
- `finance-txn-store.js` is the data module (ARCH §15): it's the only code touching the table.
- On boot it hydrates from an **IndexedDB mirror**: account-scoped, added to the
  `auth-account-reset.js` purge list, and **never** in the localStorage state mirror (finance
  stays cloud-only).
- It then does **one incremental fetch**: `updated_at > lastSyncedAt`, paged at 1,000.
- Triggers: finance page open, after a manual Refresh, after CSV import. **No timers, no
  Realtime.**
- The first load pulls everything once (~100–200 rows/month, so a few hundred KB even for
  years of history). After that, only changes come down.

### 5.3 ⚠️ Protecting past budget actuals (T5)
The snapshot window is pinned to what it covers **today**. `financeMonthsToSnapshot` is fed
the **live-window subset** (txns with `posted` ≥ today − 45 days, plus manual txns) instead
of the whole store. So:
- **Current behaviour is preserved exactly:** only the current month (and a past month the
  45-day window fully covers) is auto-recomputed.
- **Older months stay frozen** at their existing snapshots, however much history the store
  holds.
- A new explicit **"Recompute this month"** action on the Budget month view lets you refresh
  an older month deliberately, after relabeling old transactions. It shows the before and
  after totals and asks for confirmation.
- Unit test: a store covering 3 years with evicted labels must leave every past-month
  snapshot byte-identical.

### 5.4 Keeping the review deck sane
With years of rows, unlabeled old txns (labels evicted by the 600 cap, or never labeled) would
flood "to label" and the bell count. So `financeBellCount` and the review deck consider only
txns in the **last 60 days**. The full transaction list still shows everything, with a date
filter.

### 5.5 Kill switch / rollback
- A per-group setting, `financeTxnSource: "store" | "feed"`, sits in the finance *config*
  JSONB (additive scalar, newer-wins merge).
- `"feed"` restores today's behaviour exactly. The ingest keeps running either way (it's
  additive), so flipping back and forth loses nothing.
- If the store fetch fails and there is no mirror, it falls back to the feed automatically,
  with a banner.

---

## 6. Manual transactions → store [proposed; separate gated phase]

- Copy `financeManualTxns` into the table (`origin='manual'`, same ids, so labels/notes/links
  keep working). This is idempotent by PK.
- New and edited manual txns are written to the table; deletes are row deletes.
- `financeManualTxns` becomes **read-only legacy**. It's kept (not cleared) until you confirm,
  then cleared in a separate step. While both exist, reads use the table, plus any legacy
  JSONB entry not yet copied (this covers a device that hasn't synced yet).
- This removes the JSONB delete-resurrection risk for manual txns (T7), because relational
  deletes are real deletes.

---

## 7. What this means for the receipts ledger

- `receipt_txn_links.txn_ref` → `finance_transactions.id`. That's a real FK-shaped
  reference, with `on delete set null` semantics handled in the data module, since a
  receipt link may outlive an undone CSV batch.
- The receipts SPEC's snapshot/relink machinery shrinks. Posted rows persist forever, and
  pending→posted is resolved once, server-side, through `superseded_by`. The receipt relink
  just follows `superseded_by`.
- CSV rows are matchable by receipts from day one.

---

## 8. Flagged changes outside the new module

| Area | Change | Kind |
|---|---|---|
| DB | `finance_transactions` + RLS (Appendix A) | you apply |
| Server | `_finance-ingest.js` called from `daily-briefing.js` + `simplefin.js`; one-time 90-day backfill | additive |
| Finance **logic** | `financeLabeledTxns` source switch + `import_label` tier + `superseded_by` label migration; snapshot window pinned (§5.3); bell/deck 60-day scope; "Recompute this month"; CSV import rewritten to rows | **authority flip, gated by §5.5** |
| Finance **state** | + `financeTxnSource` scalar (config). After phase 6 confirmation, `financeManualTxns` cleared. | additive, then a confirmed clear |
| Shared infra | new IndexedDB store + account-reset purge entry | flagged |

---

## 9. Explicitly deferred (the next decision after this ships)

The per-txn annotations (`financeTxnLabels`, notes, links, sign flips) stay in JSONB with
their 600 caps. With permanent history, **old txns will show as unlabeled once their label
ages out of the cap.** Budget totals are safe (§5.3 freezes them). The durable fix is to
move annotations onto the rows as columns (`label`, `split`, `note`, …). That's a second
authority flip with the same risk shape, so I'm proposing it as its own SPEC rather than
folding it in. **Q2 below.**

---

## 10. Plan (each step: tests, build, boot-check, commit, push; stop where marked)

1. **Pure core:**
   - `reconcilePending`,
   - `csvRowsToTxns`,
   - `dedupeImport`,
   - store row ⇄ model mapping,
   - the pinned snapshot window,
   - the label-tier order,

   plus tests, including the T5 byte-identical-actuals test.
2. **SQL** `migrations/2026-09-xx-finance-transactions.sql` → **stop, you apply it.**
3. **Server ingest** (additive) in the cron + `simplefin accounts`, plus the one-time 90-day
   backfill. Verify with an ingest integration test against a mocked PostgREST. After
   deploy, you can confirm the row count in the SQL editor.
4. **Client store module** + IndexedDB mirror + account-reset purge. Flag defaults to `"feed"`
   (no behaviour change yet).
5. **Read flip** behind the flag, plus the 60-day deck scope and "Recompute this month". **Stop:
   you flip the flag to `"store"` on your account and compare against the feed view before
   it becomes the default.**
6. **CSV import → rows** with preview, dedupe and undo.
7. **Manual txns → store** (copy + write path). The legacy clear is its own confirmed step.
8. **Docs:** ARCHITECTURE §5 data-ownership row, CLAUDE.md finance row,
   FINANCE_EXTRACTION note. Then an adversarial review → fix → re-verify.

**Verification plan.**
- Unit tests:
  - ingest idempotency (same payload twice leaves the same rows),
  - pending→posted with an amount change,
  - a vanished pre-auth,
  - CSV re-import inserts nothing,
  - CSV vs bank overlap,
  - two identical same-day charges both kept,
  - past-month snapshot immutability,
  - label-tier precedence,
  - the flag in `"feed"` mode leaves `financeLabeledTxns` output identical to today (golden
    test).
- Plus `npm test`, `npm run build`, `npm run check:boot`, and a local-dev walkthrough.
- **I can't verify live ingest from here** (no service key, no deploy). I'll say exactly
  that and give you the SQL-editor queries to confirm row counts after deploy.

---

## 11. Decisions (Luke, 2026-09-26)

- **Q1 — backfill:** 90 days, once, at the first ingest.
- **Q2 — annotations onto rows (§9):** deferred to its own SPEC, after the receipts ledger.
- **Q3 — deck/bell scope:** last 60 days.
- **Known risk (logged in ISSUES.md):** re-linking SimpleFIN could re-ingest the same charges
  under new ids (§2). A "reconnect remap" tool is out of scope for now.

## Appendix A — SQL

Canonical: **`migrations/2026-09-26-finance-transactions.sql`**. Not yet applied. Compared
with the earlier draft:
- `status` gains `deleted`, because clients soft-delete;
- the client DELETE policy is removed, so deletes fail closed.
