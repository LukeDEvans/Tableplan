# Finance: personal accounts — design & plan

Status: **DRAFT for Luke's review (2026-10-20). Nothing built.** Follows VIEWS_DESIGN.md decision 5 and Luke's choice of "Option 2" (2026-10-20): personal accounts are **truly private**, not just hidden, using **one SimpleFIN connection** that the server splits.

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

## 3. Questions for Luke

1. **Which accounts are Personal?** You'll pick them in the app; nothing moves until you confirm the dry run. Likely candidates are the ones with owner "Luke". Marijane's and Sophia's stay Household (Marijane has no Personal view).
2. **Personal spending and the household budget.** When you pay a household expense from a personal card, should it:
   - (a) stay personal (the household budget never sees it), or
   - (b) be "sent" to the household budget one transaction at a time, as a shared expense?

   Recommendation: (a), with (b) later if you miss it. Transfers from a joint account to a personal one still show on the joint side, as today.
3. **Receipts.** Receipts are one shared Shop list. Should a receipt linked to a personal-account transaction stay visible in Shop's receipts (only the bank match is personal), or be hidden from Marijane too? Recommendation: stays in Shop. It's a shopping record, and only the bank side is private.
4. **Income and people** (`financePeople`, incomes) stay household? Recommendation: yes.
5. **The daily finance email / alerts.** Should alerts for personal accounts (low balance, a dropped connection) go only to you? Recommendation: yes.

---

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
