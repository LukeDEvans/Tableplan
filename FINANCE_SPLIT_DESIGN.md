# Finance: personal accounts — design & plan

Status: **APPROVED (Luke, 2026-10-20; recommendations accepted, §3). Step 1 built (§6); its migration applied to prod 2026-10-20.** Follows VIEWS_DESIGN.md decision 5 and Luke's choice of "Option 2" (2026-10-20): personal accounts are **truly private**, not just hidden, using **one SimpleFIN connection** that the server splits.

Goal: Luke marks some accounts **Personal**. Their balances, transactions, labels and history then live only in Luke's own data. His wife's app never receives them, not even in the background. Household accounts work exactly as today.

---

## 1. What exists today (read from code and the live database, 2026-10-20)

**Live data:** 19 accounts (14 linked to SimpleFIN, 5 manual), with owners **Family, Luke, Marijane, Sophia**; 2 people with income; 3 budget groups; 450 stored transactions across 11 accounts; the transaction read path is the durable store (`financeTxnSource: "store"`).

**Where each piece lives, and who can read it:**

| Piece | Where | Who reads it today |
|---|---|---|
| SimpleFIN access URL | `tableplan_states` row `simplefin_<groupId>` (no ":", so no client can read it) | server only |
| Bank cache: every account's balance + ~45 days of transactions | `finaccts_<groupId>` (server-only row) | **any household member**, through `simplefin` action `accounts`, which returns the whole cache |
| Durable transactions | `finance_transactions`, `group_id = <groupId>` | every household member (RLS); the policy already also allows `group_id = 'u-<uid>'` rows for their owner |
| Accounts list, labels, rules, notes, budgets, actuals, goals… | the `finance` section of `tableplan_states`, household row only (`SECTION_SCOPE.finance = "household"`) | every household member |
| Daily balance history / net worth | `finhist_<groupId>`, written by the daily snapshot | household members via `simplefin` action `history` |
| Daily finance backup | written by the snapshot from `<groupId>:finance` | server only |
| Emailed receipts inbox | `finreceipts_<groupId>` | household members |

So today **four separate paths** carry every account to every member: the bank cache, the transaction store, the finance section, and the balance history. All four have to split, or a "personal" account isn't private.

**Guards that matter:** `STATE_SCHEMA_VERSION` plus the `tp_protect_finance_merge` trigger (an older build can't overwrite newer finance data); `guardBootEmptyFinance` (an empty-looking finance copy at boot can't wipe the real one); the daily finance backup (skips a snapshot emptier than the last).

---

## 2. Design

### 2.1 One connection, split on the server

Nothing changes in SimpleFIN. The household's one connection keeps pulling every account. Before anything is saved or returned, the server sorts each account by its **view assignment**:

- **Household** accounts → today's household paths, unchanged.
- **Personal** accounts → the owner's paths: `finaccts_u-<uid>`, `finance_transactions` with `group_id = 'u-<uid>'`, `finhist_u-<uid>`, and `u-<uid>:finance`.

The household cache, store, history and section never hold a personal account again.

### 2.2 Where the assignment lives

A new table, written only by the account's owner and read by the server:

```sql
create table live_finance_account_views (
  group_id   uuid not null references live_groups on delete cascade,
  linked_id  text not null,                 -- the SimpleFIN account id
  owner_id   uuid not null references auth.users on delete cascade,
  view       text not null check (view in ('personal')),  -- absent row = household
  updated_at timestamptz not null default now(),
  primary key (group_id, linked_id)
);
-- RLS: a member reads only their own rows; writes only for themselves, only if
-- they're the group admin (multi-view is admin-only). Server (service role) reads all.
```

- A row exists only for Personal accounts, so the default is Household, which is today's behavior.
- It isn't in synced state, so an older app build can't strip or revert it.
- Manual accounts (no `linkedId`) are moved by the client between the two finance sections; they need no row.

### 2.3 What each view shows

- **Household** (Luke and Marijane): household accounts only. Every card, total, chart, budget, alert and insight counts household accounts only.
- **Personal** (Luke): his personal accounts, with their own budget, labels and alerts, plus a read-only **Household summary** card (net worth, this month's spending) with "Open in Household". A fuller household layer can come later.
- **Business**: no Finance page yet.

The finance section becomes switchable per view like Calendar and Listen (`SECTION_SCOPE.finance = "toggle"`; Household reads `<groupId>:finance`, Personal reads `u-<uid>:finance`), through the same `setSectionScope` swap. **This bumps `STATE_SCHEMA_VERSION`** (8). Older builds then can't save finance until updated, so the TestFlight build ships first.

### 2.4 Moving what's already there (one time, after a dry run)

The history of accounts Luke marks Personal is already in household data. A one-time move, run only after Luke reviews a dry run:

1. **Back up** the household finance section, the bank cache and the balance history (server-side copy, kept 30 days).
2. **Dry-run report** (Finance › Accounts › "Review the move"), per account: its transactions in the store, its labels, rules, notes, links, receipts and history days. It also lists anything that can't move cleanly (see §3).
3. **Move**, server-side, in one function:
   - store rows: `group_id` → `u-<uid>`;
   - balance history: the account's balances leave the household days, go into `finhist_u-<uid>`, and household net worth is recomputed;
   - the bank cache is rebuilt split on the next pull;
   - account entries, labels, rules, notes and links for those transactions move from `<groupId>:finance` to `u-<uid>:finance`;
   - household month actuals are recomputed without the moved accounts (they're derived).
4. **Verify**, with a check that runs as Marijane under RLS: none of the personal accounts' ids, transactions or balances are readable.

A move back (Personal → Household) is the same function in reverse.

### 2.5 Egress

Nothing new reads on a timer. The split adds one tiny read per bank pull (the assignment table) and one more cache row for Luke. A Finance view switch costs a stamp check, as for the other pages (VIEWS_DESIGN §14).

---

## 3. Decisions (Luke, 2026-10-20: "go with your recommendations")

1. **Which accounts are Personal:** Luke picks them in the app (step 3); nothing moves until he confirms the dry run. Marijane's and Sophia's accounts stay Household (Marijane has no Personal view).
2. **Personal spending stays personal.** The household budget never sees it. A household bill paid on a personal card doesn't count toward the household budget; a "send to household" action can come later if missed. Transfers from a joint account still show on the joint side.
3. **Receipts stay in Shop's shared list.** Only the bank side (the transaction match) is private.
4. **Income and people stay household.**
5. **Alerts for a personal account go only to its owner.**

## 4. Build order

1. **Assignment table + server split** (migration, gated). The server sorts by assignment, but no account is personal yet, so nothing changes. Tests: ingest, cache and history split with mocked bridge data; RLS check as Marijane.
2. **Client: finance per view** (`STATE_SCHEMA_VERSION` 8): the finance section swaps with the view; Personal's Finance page; the Household summary card; the account picker (admin only, disabled until step 3). Every total and alert respects the view. TestFlight build before any account is marked.
3. **The move:** dry-run report, backup, move, verify as Marijane. Luke confirms in the app.
4. **Clean-up:** after 30 days, drop the move backup; ISSUES entries closed.

Each step is its own PR with QA. Steps 1 and 3 touch production data and wait for Luke's OK.

## 5. Risks

- **Finance is the most protected area of the app.** Every step keeps the existing guards (schema version, boot-empty guard, daily backup) and adds the move backup.
- **Old app builds.** The schema bump blocks their finance saves. Marijane's phone needs the new build before step 3.
- **SimpleFIN account ids change on a relink** (`remapAccount`). The assignment must follow a remap, or a re-linked personal account would land in household paths. Step 1 handles that: a remap carries the row over.
- **Partial move.** The move runs in one server function and is idempotent: re-running finishes a half-done move, never duplicates.

## 6. As built: step 1 (branch `claude/finance-split-step1`, 2026-10-20)

Nothing is marked Personal yet, so step 1 changes nothing anyone sees. Its tests prove what happens once an account is.

- **`migrations/2026-10-20-finance-account-views.sql`**: `live_finance_account_views` (a row = that SimpleFIN account is personal to `owner_id`). The owner reads their own rows; nobody else reads any; **no app can write**, only the server. Checked in PGlite (`scripts/check-finance-account-views-migration.mjs`, 9 checks).
- **`netlify/functions/_finance-split.js`**: loads the assignments (a missing table = none, i.e. today; any other read error = **fail closed**), splits accounts, and builds what one member receives (household accounts plus only their own personal ones, marked `scope: "personal"`).
- **`simplefin.js`**:
  - `accounts` saves household accounts to `finaccts_<groupId>` and each personal account to `finaccts_u-<owner>`; the transaction store gets `group_id = u-<owner>` rows for them.
  - It filters every response, so even a cache written before an account was marked never reaches another member.
  - Unreadable assignments → 503, nothing saved or served.
  - `history` adds the owner's `personalDays`.
  - `remapAccount` refuses a personal account until step 3 can move the relinked account first.
- **Daily snapshot** (`daily-briefing.js` `snapshotFinanceBalances`, exported for tests): the same split for the cache and the store. Household backup and history (`snapshotScope`) skip assigned accounts; each owner gets `finbackup_u-<owner>` and `finhist_u-<owner>` from `u-<owner>:finance`. Unreadable assignments → the group is skipped that day.
- **Tests:** `test/finance-split.test.js` (14). The pure split; `accounts` with no, one and stale assignments as Luke and as Marijane; fail-closed; history; remap refusal; the daily snapshot's caches, store rows, history, backup and fail-closed.
- **Deploy order:** either. Before the migration the server reads "no personal accounts", which is today's behaviour.
- **Known gap (until step 3):** after a SimpleFIN relink, a personal account's new id isn't assigned yet, so it lands in the household paths until it's merged. Step 3's move marks the new id and moves its rows. Logged in ISSUES.md.
