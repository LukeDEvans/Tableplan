# Finance: personal accounts — design & plan

Status: **APPROVED (Luke, 2026-10-20; recommendations accepted, §3). Step 1 built (§6); its migration applied to prod 2026-10-20. Step 2 built (§7). Steps 1–2 deployed 2026-10-20.** **Step 3 built and merged 2026-11-12 (§8), its guard migration applied; a real move stays switched off until the next deploy (§8.6). Nothing has moved. Left: merging a relinked personal account (§8.5).** Follows VIEWS_DESIGN.md decision 5 and Luke's choice of "Option 2" (2026-10-20): personal accounts are **truly private**, not just hidden, using **one SimpleFIN connection** that the server splits.

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

The finance section becomes switchable per view like Calendar and Listen (`SECTION_SCOPE.finance = "toggle"`; Household reads `<groupId>:finance`, Personal reads `u-<uid>:finance`), through the same `setSectionScope` swap. **`STATE_SCHEMA_VERSION` 8** comes with step 3 (moved from step 2, see §7): older builds then can't save finance until updated, so the TestFlight build ships first.

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
2. **Client: finance per view**: the finance section swaps with the view; Personal's Finance page; the Household summary card. Every total and alert respects the view. TestFlight build before any account is marked.
3. **The move** (`STATE_SCHEMA_VERSION` 8): the account picker, dry-run report, backup, move, verify as Marijane. Luke confirms in the app.
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

## 7. As built: step 2 (branch `claude/finance-split-step2`, 2026-10-20)

Nobody owns a personal account yet, so step 2 also changes nothing anyone sees.

- **Finance follows the view, gated.** `views.js` `scopeForView`: Household → household finance; Personal (and Business) → the person's own `u-<uid>:finance` **only when they own at least one personal account** (`hasPersonalFinance`). Otherwise Personal keeps showing household finance, as today. `SECTION_SCOPE.finance = "toggle"`, defaulting to household.
- **Where `hasPersonalFinance` comes from:** the person's own rows in `live_finance_account_views` (one tiny read with the business-space load, `limit=1`; RLS lets each person read only their own). Cached on the device as a yes/no (`live-personal-finance-v1`, cleared on account reset). No finance data is ever stored on the device: the off-screen finance copy is stripped before the shadow store is saved.
- **`finance-ui.js`:** every pulled account is kept in `financeLiveAll`; each view shows `accountsForScope` (`scope: "personal"` in Personal, the rest in Household), and the balance history picks `personalDays` vs `days` the same way. `onFinanceScopeChanged()` (called by `alignScopesToView` after a swap) re-picks, recomputes actuals and recurring, and re-renders. The transaction store reads by the scope's id (`getFinanceStoreGroupId`).
- **Household card:** Personal Finance shows a read-only card with the household's net worth and this month's spending, and **Open in Household** (switches view, stays on Finance).
- **No schema bump yet — moved to step 3.** Step 2 writes finance only to the household row (no one is personal), so older builds behave exactly as before. Step 3 is the first change that writes `u-<uid>:finance` with real data; the bump goes with it, after the TestFlight build is on both phones. Step 3 must also check that `tp_protect_finance_merge` and `guardBootEmptyFinance` cover `u-` finance rows.
- **Checks:** `test/views.test.js` (finance scope rules); `qa:views` 91/91, including flag on → Personal reads its own finance with the Household card, "Open in Household", the shadow never on the device, flag off → back to household; boot check; `qa:page-groups`; full suite 2577.

## 8. As built: step 3, the server half (branch `claude/finance-move-core`, 2026-11-12)

Merged 2026-11-12 with Luke's OK, and the guard migration applied; a real move is switched off until the next Netlify deploy (§8.6). No account is Personal and no data has moved.

### 8.1 What reading the live system changed about the plan

- **The database puts moved data straight back.** `tp_protect_finance_merge` deep-unions the per-transaction maps (labels, notes, links, sign flips, month totals) on every update of a finance row, so that a device with an old copy can't blank another device's labels. A move takes entries *out* of the household's row, and the trigger would union them back in; a device holding an old copy would also re-send them. So the move needs the trigger's help (§8.3).
- **Month totals are saved, not only derived.** `financeMonthActuals` in the household's row counts the personal account's spending until it is rebuilt, and an old copy would overwrite a rebuilt month. The move resets them and the trigger refuses month totals from a copy older than the move.
- **The nightly finance backup refuses a "poorer" copy** than its newest snapshot (the wipe guard). After a move the household's section *is* poorer, so the move writes the day's snapshot itself; otherwise the nightly backup would stop.
- **Labels point at the household's budget categories** (`cat:<group>:<category>`). Luke, 2026-11-11: copy the categories the moved transactions use into Personal (same ids, amounts blank), so labels and matching merchant rules carry over.

### 8.2 The plan of a move: `finance-move.js` (pure)

`planFinanceMove({ from, to, accountIds, storeRows })` → both finance sections as they should be saved, plus the report the dry run shows. The same function runs both directions. What follows an account: its entry, its places in the cash / emergency / retirement card lists, its sub-label, its manual transactions, and everything keyed by one of its transactions (labels, notes, sign flips, receipts, confirmations, links, dismissed notifications and alerts, per-transaction skips). What belongs to a **merchant seen only on the moving accounts** goes too (rule, display name, note counts, recurring charge, skip); a merchant also seen on an account that stays keeps all of that, and its rule and name are copied. Month totals are reset on both sides.

Reported as not moving cleanly: a return linked to a purchase in the other view (the link is dropped), a label on a category that no longer exists (arrives unlabelled), and a manual account that shares its name with one that stays (refused: their stored transactions can't be told apart).

`from` records what left in **`financeMovedOut`** (`{ epoch, accounts, linked, txns }`); `stripMovedOut(section)` removes those from any copy. `moveBalanceHistory` moves the accounts' daily balances and recomputes each day's net worth.

### 8.3 The database guard: `migrations/2026-11-11-finance-move-guard.sql` (applied to prod 2026-11-12)

Replaces the trigger function; every existing rule is kept. Adds:

- **A.** A write with the header `x-live-finance-move: 1` made with the service role is the move, and is taken as written (no union, no empty-never-erases). An app sending the header is not the move.
- **B.** Nobody else can change `financeMovedOut`, and after every other write whatever it lists is stripped from the row again: moved accounts (by entry id and by bank id, so a relinked copy is caught), their card-list places and sub-labels, and every entry keyed by a moved transaction.
- **C.** A writer whose `financeMovedOut.epoch` is lower than the row's can't replace the month totals.

`scripts/check-finance-move-guard-migration.mjs` applies it to PGlite: 30 checks (the older rules, the move, an old copy written back afterwards, a forged header, the move back).

### 8.4 The move on the server: `netlify/functions/_finance-move.js`, `simplefin` action `moveAccounts`

Admin only, into the admin's own personal finance. A dry run unless `confirm: true`; a confirmed move is refused unless `FINANCE_MOVE_ENABLED=1` (set it when the guard migration is applied; without the guard the database would put the labels back). Order, so that stopping anywhere loses nothing and a re-run finishes: (1) backup of both sections, both histories and both bank caches to `finmovebackup_<groupId>` (kept 30 days); (2) the assignment, so bank pulls already sort the new way; (3) stored transactions (`group_id`); (4) balance history and bank cache; (5) the receiving section, then the one the accounts leave, both with the move header; (6) a fresh nightly-backup baseline for both scopes; (7) read back and count anything that moved and is still where it left (`verified.clean`). Tests: `test/finance-move.test.js` (27, the plan), `test/finance-move-server.test.js` (20, against a fake Supabase: refusals, dry run, the move, the order of writes, each way of stopping part-way then re-running, the move back, the gated action).

### 8.5 The app half (same branch, 2026-11-12)

- **The app knows `financeMovedOut`.** It is a finance-section key; `mergeStates` takes the record from the later move whole (`mergeMovedOut`), drops the month totals of the side that hadn't seen that move, and runs `stripMovedOut` on the merged copy, so a device can't show or re-send what moved. Only the server's move changes the record (the trigger enforces it).
- **`STATE_SCHEMA_VERSION` stays 7 until the deploy that switches moves on** (Luke, 2026-11-12: no Netlify deploy until the app-wide work is done). A bump now would stop the not-yet-deployed web app saving finance. It is safe to wait: no move can run before that deploy, and the trigger alone keeps `financeMovedOut` and strips what it lists, whatever build writes. The bump to 8 goes in the deploy commit (§8.6).
- **The screen appears only when the server can do it:** `simplefin` `status` answers `moves: true` once this server is deployed; until then the app shows nothing new.
- **Finance › Accounts › "Personal accounts"** (the household's admin only; in Personal it reads "Move back to Household"): tick accounts → **Review the move** (the server's dry run, nothing changes) → the report (per account: transactions, labels, notes, receipts, return links; history days; budget categories copied; merchants moved and copied; anything that can't move cleanly) → **Move N accounts** → the app reloads its finance row from the server (never merging its own older copy), re-reads the bank cache and the stored transactions, and re-checks whether this person has personal finance. A refusal from the server is shown in place.
- **Checks:** `npm run qa:finance-move` (22, the screen at 390px with the server answered by canned responses), `test/finance-move.test.js` (`mergeMovedOut`), full suite, boot check, `qa:views` 118/118.
- **Read, not built:** the boot-empty guard (`guardBootEmptyFinance`) and the trigger both act on whichever finance row is in play, `u-` rows included.

**Still to build**
1. **Merging a relinked personal account** (`remapAccount` still refuses one): assign the new bank id to the owner, move its rows and cache entry out of the household's paths, then merge in the personal scope. It can only arise after a real move followed by a SimpleFIN relink. ISSUES.md.
2. **Clean-up after 30 days** (design step 4).

### 8.6 Before a real move

Done 2026-11-12 (Luke's OK): the branch is merged, the guard migration is applied to prod (the previous function kept as `tp_protect_finance_merge_before_move_guard`), and a TestFlight build carries the app side. Still to do, in this order:

1. **With the next Netlify deploy** (Luke decides when; he is saving deploys for when the app-wide work is done): set `STATE_SCHEMA_VERSION` to 8 in the deploy commit, set `FINANCE_MOVE_ENABLED=1` in Netlify before it, and make a TestFlight build from the same commit for both phones. From then older builds can't save finance.
2. In Household › Finance › Accounts, tick the accounts and read **Review the move**. Confirm only if the report looks right.
3. Afterwards: the result line should say the accounts moved; run the read-only check as Marijane (RLS: none of the moved accounts' ids, transactions or balances readable), and look at Household and Personal Finance on both phones.

To undo: Personal › Finance › Accounts › "Move back to Household". The pre-move copies are in `finmovebackup_<groupId>` for 30 days.
