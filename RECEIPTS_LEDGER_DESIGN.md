# Unified Receipts Ledger — Design (INTENT → SPEC → PLAN)

> **Status: SPEC — Q1–Q3 decided (§12); Q4/Q5 clarifications pending.** Nothing is implemented. No DDL has been applied.
> The SQL in Appendix A is a **draft for review** and is **not** in `migrations/` yet. It
> goes there, and you apply it in the SQL editor, only after you approve this spec.
> Baseline: `1e56f62` on `claude/intelligent-clarke-w9wefi`.

Evidence labels used below: **[observed]** means I read it in the code (file:line given).
**[inferred]** means reasoned from code, not run. **[proposed]** means new design.

---

## 0. Findings from the audit that shape the design

These are observed facts. Several of them change how the brief can be implemented.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| F1 | **SimpleFIN transactions are not persisted anywhere in finance state.** They live in a server cache row (`finaccts_<group>`), and the client requests a **45-day** window. | `finance-ui.js:430` (`days: 45`), `simplefin.js` `accounts` action | A link's transaction *will* drop out of the feed after about 45 days. The link must carry a **snapshot** of the txn, or old links become meaningless. |
| F2 | **CSV import does not create transactions.** It aggregates rows straight into `financeMonthActuals`, and only for months that have no data yet. | `finance-ui.js:257-293`, `finance-csv.js:91` | **There is no CSV transaction to match a receipt to.** Matching on CSV import would need a new per-transaction CSV store. That is a finance-state change, so it is **question Q4**. |
| F3 | A split lives in `state.financeTxnLabels[txnId] = { split: [{label, amount}] }`, and **any** entry there makes `labelSource === "manual"`. The map is **capped at 600** entries (least-recent evicted). | `finance-ui.js:655-662`, `2046-2057` | If the receipt wrote its split through `recordFinanceTxnSplit`, a receipt split would be indistinguishable from a hand-made one. Later line edits could not update it, and it could be evicted. See §4.4 for the alternative. |
| F4 | Split portions are **always positive magnitudes** (`financeTxnPortions` keeps only `amount > 0`). | `finance-ui.js:865-874` | A return receipt split onto a credit would count as **spending**. Refund splits need signed portions: a small change to finance *logic*, not to state shape. |
| F5 | Pending→posted dedupe already exists. It keys on **same account + same amount** + a shared merchant token within 7 days, then migrates the label from the pending id to the posted id. | `finance-ui.js:579-612` | This covers the plain pending→posted case. It **misses gas / pre-auth**, because the amount changes. The receipt link needs its own re-link step (§3). |
| F6 | `financeMonthActuals` is a **persisted snapshot** that the client recomputes from `financeLabeledTxns()`. | `finance-ui.js:1726-1760` | If receipt-derived splits feed actuals, the snapshot must not be recomputed before the receipt cache loads. Otherwise past months would flip back and forth. |
| F7 | The `receipt-attachments` bucket is **per-uid** (`<uid>/…`). | `supabase-receipt-attachments.sql` | A receipt your partner scans would have an image you **cannot see**. Ledger images need a group-scoped path policy. |
| F8 | Shop receipt images live in the **content store** (`reading-content` bucket through `scan-content.js`), not in `receipt-attachments`. | `scan-content.js` | Two image stores exist today. The migration leaves the legacy ones where they are (§7). |
| F9 | Three extraction paths exist: `receipt-scan.js` (the `document-scan` seam, Shop), `simplefin.js` `scanReceipt`/`importReceipt` (inline Anthropic calls, finance), and `_gmail-shared.js` `extractReceipt` (mail sweep, capped at 40, stored in `finreceipts_`). | files cited | Consolidate all three behind `document-scan` with a single prompt (§6). |
| F10 | Users with no group write state rows as `u-<uid>:<section>`, and `live_get_my_group_ids()` does not cover them. | `app.js:352-362` | The RLS policies must also admit `group_id = 'u-' || auth.uid()`. |
| F11 | `/adversarial-review` is referenced in CLAUDE.md, but there is **no `.claude/skills/` directory** in this checkout. | `ls .claude` | For the review step I'll use a fresh general-purpose subagent with the DEVELOPMENT.md brief, plus the `reviewer` agent. Logged to PAPERCUTS when I get there. |

---

## 1. Intent

**Problem.** Receipts get captured only when a transaction already exists. Scanning early is
punished: the batch scan drops unmatched receipts. Line items are thrown away on the finance
side, and receipts live in three stores that never talk to each other.

**Outcome.** You scan the moment you're handed a receipt. It's parsed line by line and waits in
a ledger. When the bank transaction shows up, the app links the two, auto-linking only when
it's confident. Once linked, the receipt explains how the charge divides across budget
categories. Transactions stay the source of truth for money.

**Non-goals.**
- No change to SimpleFIN as a read-only link.
- No local OCR engine (the audit settled this).
- No change to finance *state shape*. Every finance-adjacent change is flagged in §9.
- No Realtime or polling.
- No retirement of the old state keys until you confirm the ledger is correct.

---

## 2. Storage — relational schema

The full DDL is in Appendix A. The shape and the reasoning:

### 2.1 `receipts`
| column | type | notes |
|---|---|---|
| `id` | text PK | **Generated on the client** (`rcpt_…`), so an offline capture has its final id before it ever reaches the server. Upserts are idempotent. Same precedent as the publications TEXT ids. |
| `group_id` | text | group id, or `u-<uid>` for users with no group (F10) |
| `kind` | text | `purchase` \| `return` |
| `source` | text | `camera` \| `upload` \| `email` \| `shop` \| `manual` \| `extension` (browser-extension page import, which exists today) \| `migrated` |
| `status` | text | `processing` \| `needs_review` \| `reviewed` \| `failed`. A not-yet-uploaded capture is "queued" in the local outbox only (§7), never a server status. |
| `merchant_raw`, `merchant_normalized`, `merchant_key` | text | `merchant_key` = `financeMerchantKey(merchant_raw)`. Same tokeniser as the bank side, so comparisons are like for like. |
| `store_id` | text null | Shop's `groceryStores` id when the merchant resolves to a known store |
| `purchased_at` | date | + `purchased_time` text null (tie-breaker when printed) |
| `currency` | text | default `USD` |
| `subtotal, tax, discounts, fees, tip, total` | numeric(12,2) | `total` is the printed amount paid, before any tip the customer writes in, unless the tip is printed |
| `payment` | jsonb | `{ last4, brand, tender: "card"\|"cash"\|"gift"\|"split"\|…, tenders: [{tender, amount, last4}], cashBack }` |
| `payment_last4` | text null | copied out of `payment` so it can be indexed |
| `tip_budget_key` | text null | override for tip allocation (§4.3) |
| `match_ignored` | bool | "never match this" (reimbursed, someone else's card, etc.) |
| `scanned_by` | uuid → `auth.users` | indexed |
| `reviewed_by`, `reviewed_at` | uuid, timestamptz | |
| `image_paths` | text[] | **An array, because long receipts are multi-image.** Emptied when the images are deleted after review. |
| `keep_image` | bool | "Keep photo" |
| `raw_text` | text | the model's raw output (≤ 64 KB) |
| `raw_extraction` | jsonb | parsed-but-unnormalized JSON, kept so a receipt can be re-parsed without its image |
| `extraction_model`, `extracted_at`, `extraction_attempts`, `last_error` | | used by bounded retry |
| `external_ref` | text null | email `messageId`, extension fingerprint, or migration source key. `unique (group_id, source, external_ref)`, so imports are idempotent. |
| `provenance` | jsonb | `provenance.js` stamp |
| `created_at`, `updated_at` | timestamptz | `updated_at` gets a trigger and also serves as the optimistic-concurrency token (§2.5) |

### 2.2 `receipt_lines`
`id` text PK, `receipt_id` → receipts ON DELETE CASCADE, `group_id` (denormalized for RLS
and reporting), `position` int, `line_kind` (`item`|`discount`|`fee`|`deposit`), `raw_text`,
`normalized_name`, `grocery_category` (Shop's category), `quantity`, `unit`, `unit_price`,
`line_total`, `line_discount`, `taxable` bool null, `budget_key` text null
(`cat:<gid>:<cid>`), `budget_key_source` (`ai`|`mapping`|`merchant_rule`|`user`),
`confidence`, `user_corrected`, `allocated_tax`, `allocated_total`, timestamps.

`allocated_*` are **derived** values. The data module recomputes them through the pure
allocator (§4) on every write to the receipt or its lines, and never edits them by hand. They
are stored only so that item-level SQL reporting ("coffee this year, tax included") needs no
client computation.

### 2.3 `receipt_txn_links`
| column | notes |
|---|---|
| `id` text PK, `group_id`, `receipt_id` → receipts CASCADE | |
| `txn_ref` | **the stable reference** (§3). Unique per `(receipt_id, txn_ref)`. |
| `txn_source` | `simplefin` \| `manual` |
| `txn_snapshot` | jsonb `{ id, accountId, amount, posted, description, pending }` taken at link time and refreshed whenever the txn is seen again |
| `prior_refs` | text[]. The refs this link pointed at before a re-link (audit trail). |
| `amount_applied` | numeric null. How much of **this receipt** this charge covers. Null means "the whole charge". Used for split tender, gift cards, and multi-shipment. |
| `method` | `auto` \| `suggested_confirmed` \| `manual` \| `migrated` |
| `score` | numeric |
| `status` | `active` \| `suggested` \| `rejected` |
| `linked_by`, `linked_at`, `created_at`, `updated_at` | |

- **Many-to-many works both ways.** One Amazon order links to several charges (several rows
  with the same `receipt_id`). One charge can link to several receipts (several rows with the
  same `txn_ref`).
- **Suggestions are stored rows** (`status='suggested'`). The review deck can then read them
  without re-running the matcher, and they sync across devices.
- `rejected` is remembered forever, so the matcher never re-suggests a pair you turned down.

### 2.4 RLS, indexes, conventions (ARCH §6)
- RLS on for all three tables. Every policy uses
  `group_id in (select g::text from public.live_get_my_group_ids() g) or group_id = 'u-' || (select auth.uid())::text`.
- An index on every FK (`receipt_id`, `scanned_by`, `reviewed_by`, `linked_by`), plus
  `(group_id, status)`, `(group_id, purchased_at desc)`, `(group_id, txn_ref)`,
  `(group_id, budget_key)` on lines, and a trigram-free
  `lower(normalized_name)` btree for line search. Volumes are small, so plain `ilike` is fine.
- `updated_at` triggers.
- **Storage:** add group-scoped policies on `receipt-attachments` for paths
  `<group_id>/receipts/<receipt_id>/<n>.jpg`. The existing per-uid policies stay (legacy
  finance images still use them).

### 2.5 Data module (ARCH §15)
- `receipts-store.js`: **pure** row⇄model mapping and validation, in the same style as
  `publications-store.js`. Unit tested.
- `receipts-data.js`: the **only** code that touches the three tables and the bucket.
  `createReceiptsData({ fetchJson, supabaseBaseUrl, supabaseHeaders, storage })` exposes
  `listReceipts(filter)`, `getReceipt(id)`, `upsertReceipt(model, {ifUpdatedAt})`,
  `replaceLines(receiptId, lines)`, `listLinks({since})`, `setLink(...)`,
  `uploadImages(...)`, `deleteImages(...)`, and `searchLines(q, range)`. A future local-first
  adapter only has to replace this file.
- **Concurrency:** writes are `PATCH …?id=eq.X&updated_at=eq.<seen>`. Zero rows updated means
  someone else edited first: refetch, then show "This receipt changed on another device".
- **Caching / egress:** an in-memory cache, plus a compact IndexedDB snapshot (account-scoped,
  purged on account switch, since `auth-account-reset.js` already handles IDB) of active
  links and per-category receipt totals for the last 13 months. That snapshot is what the
  finance overlay (§4.4) needs at boot and offline.
- **Refresh only on explicit events:** app boot (once), opening the Receipts page, a scan
  finishing, a save/link, and a finance account refresh. **No timers, no Realtime.**

---

## 3. Stable transaction reference & matcher

### 3.1 The stable reference (answers "does this force a finance-state change?": **no**)
- `txn_ref = "sf:<accountId>:<txnId>"` for bank transactions and `"manual:<id>"` for
  `financeManualTxns`. Both are already stable ids. **Nothing is added to finance state.**
- Every link stores a `txn_snapshot`, so a link stays readable and reportable after the txn
  ages out of the 45-day feed (F1).
- **Re-link step** (pure: `relinkLinks(links, feedTxns, feedWindow)`), which runs on each
  finance refresh:
  1. For each active link, if `txn_ref` is in the feed, refresh the snapshot (catches posted
     amount changes) and stop.
  2. If the ref is gone **and** `snapshot.pending === true`, look for its posted successor:
     same account, posted 0–7 days after the pending date, overlapping merchant tokens,
     `!pending`, not already linked to something else. The amount does **not** have to be
     equal (this is the gas / pre-auth case); it's scored against the **receipt total**
     instead.
     - Exactly one plausible successor: repoint the link, push the old ref onto `prior_refs`,
       and keep the method.
     - Several, or none after 10 days: set status to `suggested`, with a "Re-confirm the
       transaction for this receipt" card in the review deck.
  3. If the ref is gone and the snapshot was **posted**, the txn simply aged out of the
     window. Keep the link as it is. **Never** delete or unlink because a txn is absent.
- This mirrors the existing F5 label migration. It doesn't modify that code; it runs
  alongside it.

### 3.2 Matcher (`receipt-matcher.js`: pure, no DOM, no network)
`matchReceipts({ receipts, txns, links, merchantNames, now, config })` returns
`{ autoLinks, suggestions, relinks, stale }`. It runs:
- after a receipt is saved or reviewed (that receipt against the feed plus manual txns),
- after the finance feed loads or refreshes (all unmatched receipts from the last 60 days
  against the feed),
- after a manual transaction is added or edited,
- *(CSV: see Q4.)*

**Candidate filter.**
- The sign matches the kind: a purchase pairs with a debit, a return with a credit.
- The txn is not `mgmt`/transfer.
- The pair is not rejected, and the receipt is not `match_ignored`.
- Date window, relative to `purchased_at`:
  - −1 to +7 days for in-store purchases,
  - −1 to +30 days for `email`/`extension` sources (Amazon charges at ship time).

**Amount models.** Each model gives an `amountFit` between 0 and 1, plus an explanation that
the UI shows:

| model | rule | fit |
|---|---|---|
| exact | \|charge − total\| ≤ $0.02 | 1.0 |
| printed tip | receipt has `tip` > 0 and \|charge − (total+tip)\| ≤ $0.02 | 1.0 |
| inferred tip | charge > total, 0 < (charge−total)/total ≤ 35% | 0.7 at ≤ 25%, 0.55 up to 35% |
| cash back | `payment.cashBack` printed and \|charge − (total+cashBack)\| ≤ $0.02 | 1.0 |
| split tender | a printed card tender amount matches the charge (±2¢) | 1.0 (`amount_applied` = that tender) |
| partial (no hint) | charge < total | 0.3 (suggest only) |
| pending pre-auth | txn is `pending` and amount ≠ total | 0 (wait for posting; §3.1 re-link handles it) |
| multi-shipment | a subset (≤ 6 candidates, same merchant, within 30 days) sums to total ± $0.02 | 0.8 for the set (suggest; auto only if the subset is unique **and** merchant fit ≥ 0.8) |

**Other signals.**
- `merchantFit`: token containment of `financeMerchantKey` on both sides, the display name
  from `financeMerchantNames` (so your "Walmart" rename matches the receipt's "Walmart"),
  and a small built-in alias/prefix table (`WM SUPERCENTER`→walmart, `AMZN MKTP`/`AMAZON.COM`
  →amazon, `SQ *`/`TST*`/`PAYPAL *` prefixes stripped, store numbers `#1234` dropped).
- `dateFit`: 1.0 at 0–1 day, then linear down to 0.2 at the window edge.
- `last4`: if the receipt shows last-4 and the account name or number contains 4 digits:
  a match adds 0.1, a mismatch puts the pair into **suggest-only** (never auto).

**Score** = `0.55·amountFit + 0.30·merchantFit + 0.15·dateFit` (+ the last-4 bonus).

**Tiers** (defaults, question Q1):
- **High → auto-link** when `score ≥ 0.85` **and** it is the unique best in both directions
  (the next candidate for the same receipt, *and* the next receipt competing for the same
  txn, both score ≤ best − 0.15) **and** the amount model is exact, printed-tip, cash-back or
  split-tender. The link is visible on both records with **Undo**, and undoing marks the pair
  `rejected`.
- **Medium (0.55–0.85), or high but tied → suggestion.**
- **Low → nothing.** The receipt waits.

**Ties.** Assignment is greedy by score. Two same-amount purchases near each other are broken
by merchant, then date, then last-4. If they're still within the 0.15 margin, **both** pairs
become suggestions and nothing is auto-linked.

**Returns.** A `kind=return` receipt matches credit txns with the same models. The existing
`financeTxnLinks` return→purchase linking is untouched.

**Never matched.** When a receipt is still unmatched after N days (default 10, Q1), with
purchase date + N < today, and it isn't ignored, it offers **"Create manual transaction from
this receipt"**. That calls the existing `saveManualTxn` path, then links the two with
`method=manual`. The manual txn is a normal `financeManualTxns` entry, so no new shape.

---

## 4. Line items → budget

### 4.1 Category pre-fill order (per line)
1. **Learned mapping** (`receiptItemMappings[normalized raw]`). This beats the AI, because a
   correction must stick.
2. The **AI extraction** key, validated against the current `financeBudgetGroups`.
3. A **merchant rule**: if `financeTxnRules` has one dominant label for this merchant key,
   use it for any lines still blank.
4. Blank. The line shows as "needs category".

### 4.2 Unified learning loop
- `receiptItemMappings` (grocery section) becomes the **single** mapping source. The value
  changes from `{normalizedName, category}` to
  `{normalizedName, category, budgetKey}`. **This is an additive field in grocery state, not
  finance state.** `normalizeMappings` passes the extra field through.
- Correcting a line's name, grocery category or budget category, in Shop *or* Finance, writes
  the mapping through `correctedMappingsFromReceipt`, extended to carry `budgetKey`.

### 4.3 Allocation math (`receipt-allocate.js`: pure, all in **integer cents**)
Inputs: the lines, the receipt header, and the **target** (the linked charge amount for this
link, or the receipt total when unlinked).

1. `net_i = line_total_i − line_discount_i` for item/fee/deposit lines. Negative `discount`
   lines that name a line reduce that line; unattributed discount lines join the receipt-level
   discounts.
2. Receipt-level **discounts**, **fees** and **tax** are allocated in proportion to `net_i`.
   **Tax goes only to lines marked taxable** when the receipt marks any (the extraction reads
   the `T`/`N` flags). Otherwise it goes across all item lines.
3. **Tip** goes to the primary category, meaning the budget key with the largest summed
   `net`, unless `tip_budget_key` is set (Q2).
4. `C_i = net_i + tax_i + fee_i − disc_i` (+ tip on the primary line). ΣC = the receipt's
   effective total R.
5. **Scale to the charge:** `C_i' = C_i × A / R`, where A is the link's `amount_applied` or
   the charge amount. This covers split tender, gift cards, inferred tip (A > R, so the delta
   spreads proportionally) and small rounding differences.
   - For **inferred tip** specifically, the delta goes to the tip bucket (the primary
     category) instead of being spread, consistent with step 3.
6. **Rounding:** floor each value to cents, then put the leftover cents on the **largest
   line**, as you specified. So Σ = A exactly.
7. Per-category totals = Σ `C_i'` grouped by `budget_key`. Lines with no category collect
   into an "Uncategorized" bucket.

**Reconciliation check** (extends the existing `validateReceipt`): Σlines − discounts + tax +
fees (+ tip) vs total. Mismatches, missing prices, low-confidence lines and duplicate lines
are flagged in review. **It never blocks.**

### 4.4 Driving the transaction's split — the one design choice I'm steering away from the brief on
The brief says to reuse `recordFinanceTxnSplit`. I recommend a **read-time overlay** instead,
because writing the split has three problems (F3):
(a) the split becomes `labelSource "manual"`, so a later line-category change can't tell a
receipt split from one you made by hand;
(b) receipt splits would fill the 600-entry cap and could be evicted;
(c) receipt-derived data would sit in finance state, which contradicts "the link table is the
only connection".

**The overlay [proposed].** Inside `financeLabeledTxns()`, *after* the explicit-label check:
- **No explicit label** and ≥ 1 active link: `t.label = "split"`,
  `t.split = receiptPortions(t)`, `t.labelSource = "receipt"`, `t.receiptIds = […]`. If the
  receipt resolves to a single category, it becomes a plain `t.label = key`, with the same
  `labelSource`.
- **Explicit label** (`manual`) and the receipt's portions differ: the label stays, and
  `t.receiptSplitSuggestion` is set. The UI shows **"Receipt suggests a different split —
  apply?"**
  - **Apply** removes the explicit `financeTxnLabels[txnId]` entry, so the receipt overlay
    now drives it and keeps updating live. The existing `recordFinanceTxnLabel(txnId, "")`
    path already deletes an entry.
  - **"Apply once"** writes the receipt portions through `recordFinanceTxnSplit`, freezing
    them as your manual split.
- Line category edits recompute `receiptPortions` → `invalidateFinanceLabeled()` →
  `updateFinanceMonthActuals()`. Budget actuals follow.
- **No double counting:** the txn remains the only money record. The overlay only divides
  its amount, and Σ portions = |amount| by construction (§4.3 step 6).
- **Uncategorized remainder** (for example cash back that isn't an item): the txn stays in
  the "to label" deck with the categorized part pre-filled.

**Finance *logic* changes this needs** (no state-shape changes; all flagged in §9):
1. `financeLabeledTxns`: the overlay branch.
2. `financeTxnPortions`: honour **signed** portions when `labelSource === "receipt"` and the
   txn is a credit, so a return receipt nets against its categories (F4).
3. `updateFinanceMonthActuals`: **gated** until the receipt-link snapshot has loaded
   (IndexedDB cache counts as loaded). This stops past months flipping while the ledger is
   still loading (F6).
4. `daily-briefing.js` `financeRichness` counts only state, so it's unaffected. The
   server-side briefing will **not** see receipt splits (it doesn't read splits for actuals
   today) [inferred from `daily-briefing.js:325-340`].

The fallback, if you'd rather keep finance logic untouched: write through
`recordFinanceTxnSplit`, plus a marker `{split, source:"receipt", receiptIds}` in the
`financeTxnLabels` value. **That is a finance-state shape change**, which is why it isn't my
default. This is **Q3**.

### 4.5 Item-level reporting
`receipts-report.js` (pure, over `receipt_lines` rows) provides:
- item spend per month ("diapers per month"),
- year-to-date by name ("coffee this year"),
- unit-price trend by item and store.

The Receipts page gets a "Items" search tab that calls `searchLines` (server-side
`ilike` + date range, bounded to 500 rows).

---

## 5. Images
- Upload happens at capture (or when the outbox drains), to
  `receipt-attachments/<group_id>/receipts/<receipt_id>/<n>.jpg`, after `prepareScanImage`
  (1600px, q0.82).
- **Mark reviewed** deletes the objects and empties `image_paths`, unless **Keep photo** is
  ticked. `raw_text` and `raw_extraction` are always kept.
- **Re-scan** is only offered while images are held. It runs extraction again, then diffs the
  new lines against the current ones, matching by position and `raw_text`. Lines you
  corrected (`user_corrected`) are kept by default. The diff dialog shows "N lines changed,
  M new, K dropped — your 4 corrections kept" with per-line accept. Totals are diffed the
  same way.

---

## 6. Extraction — one server path
- New `receipt-extract.js` (CJS domain adapter over `document-scan.scanDocument`) with **one
  prompt** that covers:
  - merchant and store number,
  - date and time,
  - kind (purchase/return),
  - subtotal, tax, discounts, fees, tip and total,
  - payment (last-4, tender(s), cash back),
  - lines with raw text, name, qty, unit, unit price, line total, line discount, taxable flag,
    grocery category, **budget key** (from the household's categories, loaded server-side the
    way `simplefin.loadFinanceCategories` does) and confidence.

  It accepts images **or** text (email body / extension page text). `receipt-scan.js`
  becomes a thin wrapper, so the Shop prompt fields stay a subset.
- New Netlify function `receipts.js`, which verifies the session and group membership. Actions:
  - `extract { receiptId }`: reads the images from storage with the service role, calls the
    seam, writes the header and lines, sets `needs_review` (or `failed` after 3 attempts), and
    returns the result.
  - `importText { text, source }`: replaces `simplefin importReceipt` (extension).
  - `trackUsage("claude_receipt_scan")` stays on the client at scan time, as today.
- The **mail sweep** (`_gmail-shared.js`) calls the same adapter in text mode and upserts into
  `receipts` with `source='email'`, `external_ref=messageId`, `on conflict do nothing`, using
  the service role. `finreceipts_` stops being written once you confirm the cutover. It's
  still gated by the existing `mailAiSettings.receiptExtract` flag (Mail-AI rule).
- `simplefin` `scanReceipt`/`importReceipt`/`receipts` stay as deprecated shims until the
  cutover is confirmed, then get removed.
- **Items are the source.** Portions are always derived on the client (§4.3) and never stored.

---

## 7. Capture, offline, background
- **Entry points:** a camera button in the topbar (global, every area) and a Home tile. Both
  open the same capture sheet. The Finance "Scan receipt", batch scan and Shop scan buttons
  are re-pointed to it. Scanning from a txn's detail card pre-selects that txn, which creates
  a `manual` link on save.
- **Capture sheet:** multi-image (≤ 8, raised from 6; Q5 touches cost), the existing
  rotate/trim/reorder preview, then **Save** and **Scan another**. There's no waiting on
  extraction.
- **Outbox (IndexedDB, account-scoped):** `{ receiptId, images (blobs), capturedAt, scannedBy,
  presetTxnRef? }`. Save writes to the outbox first, so **nothing is lost offline**.
- **Drain.** Triggers: app start, the `online` event, and after each capture. It's a single
  worker with concurrency 1 and per-item exponential backoff capped at 3 tries per session.
  Each step is idempotent:
  1. upsert `receipts` (`status='processing'`, client id),
  2. upload images (upsert),
  3. call `receipts.extract`,
  4. drop the item from the outbox on success.
- **Interrupted scans.** A tab that closes mid-extract is fine, because the server writes the
  row itself. A row stuck in `processing` with `extracted_at` null and `updated_at` older
  than 3 minutes is retried **once** on next boot, then goes to `failed` with a "Retry" button
  (bounded, ARCH §8).
- **Needs-review inbox:**
  - status `needs_review` sorts first, with a badge count through `setPageNotifCount`;
  - reviewing means walking the lines, categories and totals;
  - reconciliation flags come first;
  - bulk-select lines → assign a category.
- **`scanned_by`** shows as initials (from `live_group_members.display_name`, which is
  already loaded) on the receipt card, the detail view, and the linked txn's detail card.

---

## 8. UI map (touch-first; no right-click-only actions)
| Surface | Where | Contents |
|---|---|---|
| **Receipts ledger** | new area `"receipts"`, reachable from the topbar button, Home, and Finance/Shop sub-links | filter chips: Needs review · Unmatched · Linked · All; merchant / scanned-by / date filters; line-item search; "Items" reporting tab |
| **Receipt detail** | sheet | header (merchant, date, scanned-by, kind), reconciliation banner, lines with category pickers + bulk select, totals, linked txn(s) with Unlink, "Link to a transaction…" search, suggestions, image (if held) + Keep photo, Re-scan, Mark reviewed, Ignore for matching, Create manual txn (after N days), Delete |
| **Txn detail** | existing finance detail card | linked receipt summary (merchant, scanned-by, per-category breakdown, expandable lines), Unlink, "Link a receipt…" (searches unmatched receipts ± 10 days by amount), "Receipt suggests a different split — apply?" |
| **Review deck** | existing finance notif deck, a secondary card type | "Is this your receipt?" medium-confidence suggestions with Confirm / Not this one, plus "Re-confirm after posting" relink cards |
| **Shop** | existing receipts dialog + price trends | reads the ledger (receipts with `store_id` or grocery-category lines); the scan button opens the global capture |

New module: **`receipts-ui.js`** (`createReceiptsModule(deps)`), following the house factory
pattern, instantiated **before** finance and groceries (those two consume its interface
through thunks). `app.js` keeps only `showReceiptsApp` plus the wiring. It gets a new row in
the CLAUDE.md domain table and a new `.claude/agents/receipts.md`.

---

## 9. What changes outside the new module (flagged, per "flag, don't fold in")

| Area | Change | Kind |
|---|---|---|
| Finance **logic** | `financeLabeledTxns` overlay; signed receipt portions in `financeTxnPortions`; actuals gate; re-link hook next to the F5 dedupe; txn detail card & review deck render receipt info | logic, **no finance-state shape change** (unless you choose Q3-fallback) |
| Finance **state** | **none added.** After cutover confirmation, stop writing `financeTxnReceipts` (key left in place) | — |
| Grocery **state** | `receiptItemMappings` values gain `budgetKey` (additive). After confirmation, stop writing `receipts` and receipt-sourced `priceHistory` (keys left in place) | additive |
| Shared infra | new `activeAppArea "receipts"` + topbar button (global nav); new IndexedDB outbox store (added to account-reset purge list) | flagged |
| DB | 3 tables + group-path storage policies (Appendix A) | you apply |
| Functions | new `receipts.js`; `simplefin.js` receipt actions → shims → removed; `_gmail-shared.js` writes the table | |

---

## 10. Migration of existing data
`receipt-migrate.js` (pure planner, unit tested) + a "Receipts → Import existing" button with
a **Dry run** step:

| Source | Becomes | Deterministic id | Links |
|---|---|---|---|
| Shop `state.receipts` | `source='shop'`, `status='reviewed'`, lines with grocery category + `budget_key` via mappings (else blank) | `rcpt_shop_<oldId>` | matcher in **suggest-only** mode |
| Email `finreceipts_` (≤ 40) | `source='email'`, `status='needs_review'`, lines from items (price + category key) | `rcpt_email_<messageId>` (== `external_ref`, so the future sweep can't duplicate) | suggest-only |
| `financeTxnReceipts` (image only, per txn) | `source='migrated'`, `status='needs_review'`, **no lines**, `total` = txn amount if the txn is in the feed (else 0 + flag), `image_paths=[legacy path]` | `rcpt_ftr_<txnId>` | **active link, `method='migrated'`** to that txn |

- **Budget impact of migration: none.** Those txns already have explicit manual splits, and
  explicit labels beat the overlay. Suggest-only mode means nothing auto-links.
- Legacy images stay where they are. `financeTxnReceipts` paths are per-uid, so they're
  viewable by the uploader only. Shop `imageRefs` stay in the content store and are recorded
  in `raw_extraction.legacy`. Nothing is copied or deleted.
- **Idempotent and re-runnable:** it's an insert-if-absent by id. The dry-run report lists
  per source: would insert / already present / would link / unmatched / failures (with
  reasons).
- **Non-destructive:** no old key is modified. A separate, later "Retire old receipt data"
  step (with its own confirmation) stops the dual reads.
- **Shop price history during the transition:** estimates read the ledger once it's loaded,
  and fall back to `state.priceHistory` before that and offline. Manual `groceryPriceObservations`
  are untouched.

---

## 11. Plan (reviewable steps, each one a commit, tested and boot-checked)

1. **Pure core:** `receipts-store.js`, `receipt-allocate.js`, `receipt-matcher.js`, extended
   `validateReceipt`, `receipt-migrate.js`, `receipts-report.js`, plus their tests.
2. **SQL:** `migrations/2026-09-xx-receipts-ledger.sql`. **Stop, and you apply it.**
3. **Data module** `receipts-data.js` + IndexedDB snapshot/outbox + account-reset purge.
4. **Extraction:** `receipt-extract.js`, `netlify/functions/receipts.js`, `receipt-scan.js`
   wrapper, the mail-sweep writer, and the extension `importText`. Plus seam tests with a
   mocked provider.
5. **Capture + Needs-review inbox + Receipts page** (`receipts-ui.js`, nav, topbar, Home tile).
6. **Matcher wiring + review-deck cards + txn-detail link UI + re-link.**
7. **Budget overlay** (the §4.4 finance logic changes, flagged in the commit message) + actuals
   gate + "apply split?".
8. **Shop cutover:** ledger reads, price history from lines, scan button re-pointed.
9. **Migration UI:** dry-run report, then import.
10. **Polish:** mobile 360px pass, docs (CLAUDE.md domain row, ARCHITECTURE §5/§7,
    FINANCE_EXTRACTION §4 closed out), `/adversarial-review` equivalent → fix → re-verify.

**Tests (adversarial cases included):**
- same-amount ties (auto → suggest),
- pending→posted with id change and with amount change (gas),
- a link surviving a txn ageing out of the feed,
- printed vs inferred tip,
- cash back, split tender, gift card,
- a multi-shipment subset-sum (unique and non-unique),
- a return against a credit, with signed portions,
- a rejected pair never re-suggested,
- allocation where Σ = charge to the cent across 1/3/97-line receipts,
- negative/discount lines, all-untaxed + taxed mix, a zero-total receipt,
- the migration planner run twice giving an identical plan,
- the migration's no-budget-change assertion,
- the overlay vs explicit label, and the actuals gate before and after the snapshot loads.

**Verification beyond unit tests:**
- `npm test`, `npm run build`,
- `npm run check:boot` (Playwright, local-dev mode),
- a scripted local-dev walk-through of capture → review → link with a mocked extract function,
- the 360px layout pass.

Live Supabase/Anthropic E2E needs your deploy, and I'll say so rather than claim it.

---

## 12. Decisions (Luke, 2026-09-26)

- **Q1 — approved.** Auto-link at score ≥ 0.85 with a 0.15 uniqueness margin, and only on
  exact / printed-tip / cash-back / split-tender amount fits. "Offer manual transaction" after
  10 days unmatched.
- **Q2 — tip goes to the main (largest) category**, with a per-receipt override.
- **Q3 — read-time overlay (§4.4) accepted.** Finance state shape is unchanged. The three
  finance *logic* changes are flagged in their commits.
- **Q4 — build a durable transaction store (direction agreed; its own SPEC pending).** Every
  daily SimpleFIN pull is kept permanently, and transactions already seen are not taken in
  again. CSV and manual entries go into the same store. See §12.1.
- **Q5 — up to 8 images per receipt. No legacy migration: past scans (a), (b) and (c) are
  deleted** — see §12.2. **This supersedes §10:** the migration planner and the dry-run import
  are dropped.

### 12.1 Q4 — what "matching against CSV" needs
CSV import today writes only month totals (F2). SimpleFIN transactions exist only in a 45-day
server cache (F1). **Neither is a durable record of individual transactions**, so neither can
be matched once it's more than 45 days old.

**Long-term answer [proposed, needs approval]: a durable relational transactions table.**
- `finance_transactions`, which SimpleFIN sync, manual entry and CSV import all write into.
  Each row has an `origin` (`simplefin`/`manual`/`csv`) plus a dedupe key, so a CSV row and
  the SimpleFIN copy of the same charge collapse into one record.
- The receipts matcher consumes transactions through one `financeTxnFeed()` interface. That
  means CSV rows (and history older than 45 days) become matchable with no change to the
  matcher.
- It also fixes F1: links point at durable rows, and `txn_snapshot` becomes a fallback rather
  than the only record.
- **This is a finance data-authority change,** the same shape as the calendar authority flip.
  It touches the finance sync gate, month actuals (CSV months would be computed from rows
  instead of pasted aggregates), the 600-entry label cap, and `labelSource`. It needs its own
  SPEC.

**Proposal:** the receipts ledger is built against `financeTxnFeed()`, with
`txn_source` accepting `csv` from day one. The transactions table is then a **separate,
sequenced project**: its own SPEC, done right after (or before) this one. Receipts gain CSV
matching the moment that table lands.

### 12.2 Q5 — purge legacy receipt data (replaces §10 migration)
Luke accepts losing the receipt-derived price history. **Nothing is imported.** After the new
ledger is verified end to end, one confirmed, separate "Purge legacy receipts" step does all
of the following:
- **Finance photos:** clears `state.financeTxnReceipts` and removes those Storage objects
  from the per-uid `receipt-attachments` paths.
- **Email receipts:** deletes the `finreceipts_<group>` row (service role, from the
  `receipts.js` function).
- **Shop receipts:** clears `state.receipts`, plus the `priceHistory` entries with
  `source === "receipt"`, plus the content-store blobs `receipt:<id>:<n>`.
- **Kept:** manual `groceryPriceObservations` and `receiptItemMappings` (the mappings are the
  learning loop — Luke to veto if he wants those gone too).

Before any of this runs, a dry-run shows the counts. The purge is then written to be
idempotent, and nothing is deleted before Luke clicks confirm.

## Appendix A — DRAFT SQL (for review, not applied, not yet in `migrations/`)

```sql
-- Unified receipts ledger. Group-scoped RLS (live_get_my_group_ids) + the
-- 'u-<uid>' fallback for group-less users. TEXT ids == client ids (offline capture).
-- Apply in the Supabase SQL editor. Idempotent (if not exists / drop policy if exists).

create table if not exists public.receipts (
  id                  text primary key,
  group_id            text not null,
  kind                text not null default 'purchase' check (kind in ('purchase','return')),
  source              text not null check (source in ('camera','upload','email','shop','manual','extension','migrated')),
  status              text not null default 'processing' check (status in ('processing','needs_review','reviewed','failed')),
  merchant_raw        text,
  merchant_normalized text,
  merchant_key        text,
  store_id            text,
  purchased_at        date,
  purchased_time      text,
  currency            text not null default 'USD',
  subtotal            numeric(12,2),
  tax                 numeric(12,2),
  discounts           numeric(12,2),
  fees                numeric(12,2),
  tip                 numeric(12,2),
  total               numeric(12,2),
  payment             jsonb not null default '{}'::jsonb,
  payment_last4       text,
  tip_budget_key      text,
  match_ignored       boolean not null default false,
  scanned_by          uuid references auth.users(id) on delete set null,
  reviewed_by         uuid references auth.users(id) on delete set null,
  reviewed_at         timestamptz,
  image_paths         text[] not null default '{}',
  keep_image          boolean not null default false,
  raw_text            text check (raw_text is null or length(raw_text) <= 65536),
  raw_extraction      jsonb,
  extraction_model    text,
  extracted_at        timestamptz,
  extraction_attempts integer not null default 0,
  last_error          text,
  external_ref        text,
  provenance          jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists receipts_external_ref_uq on public.receipts (group_id, source, external_ref) where external_ref is not null;
create index if not exists receipts_group_status_idx    on public.receipts (group_id, status);
create index if not exists receipts_group_purchased_idx on public.receipts (group_id, purchased_at desc);
create index if not exists receipts_scanned_by_idx      on public.receipts (scanned_by);
create index if not exists receipts_reviewed_by_idx     on public.receipts (reviewed_by);

create table if not exists public.receipt_lines (
  id                text primary key,
  receipt_id        text not null references public.receipts(id) on delete cascade,
  group_id          text not null,
  position          integer not null default 0,
  line_kind         text not null default 'item' check (line_kind in ('item','discount','fee','deposit')),
  raw_text          text,
  normalized_name   text,
  grocery_category  text,
  quantity          numeric(12,3),
  unit              text,
  unit_price        numeric(12,4),
  line_total        numeric(12,2),
  line_discount     numeric(12,2) not null default 0,
  taxable           boolean,
  budget_key        text,
  budget_key_source text check (budget_key_source in ('ai','mapping','merchant_rule','user')),
  confidence        numeric(4,3),
  user_corrected    boolean not null default false,
  allocated_tax     numeric(12,2),
  allocated_total   numeric(12,2),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists receipt_lines_receipt_idx    on public.receipt_lines (receipt_id, position);
create index if not exists receipt_lines_group_budget   on public.receipt_lines (group_id, budget_key);
create index if not exists receipt_lines_group_name_idx on public.receipt_lines (group_id, lower(normalized_name));

create table if not exists public.receipt_txn_links (
  id             text primary key,
  group_id       text not null,
  receipt_id     text not null references public.receipts(id) on delete cascade,
  txn_ref        text not null,
  txn_source     text not null check (txn_source in ('simplefin','manual')),
  txn_snapshot   jsonb not null default '{}'::jsonb,
  prior_refs     text[] not null default '{}',
  amount_applied numeric(12,2),
  method         text not null check (method in ('auto','suggested_confirmed','manual','migrated')),
  score          numeric(5,4),
  status         text not null default 'active' check (status in ('active','suggested','rejected')),
  linked_by      uuid references auth.users(id) on delete set null,
  linked_at      timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (receipt_id, txn_ref)
);
create index if not exists receipt_txn_links_receipt_idx on public.receipt_txn_links (receipt_id);
create index if not exists receipt_txn_links_txn_idx     on public.receipt_txn_links (group_id, txn_ref);
create index if not exists receipt_txn_links_status_idx  on public.receipt_txn_links (group_id, status);
create index if not exists receipt_txn_links_linked_by   on public.receipt_txn_links (linked_by);

-- updated_at maintenance (search_path pinned per ARCH §6)
create or replace function public.receipts_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists receipts_touch on public.receipts;
create trigger receipts_touch before update on public.receipts for each row execute function public.receipts_touch_updated_at();
drop trigger if exists receipt_lines_touch on public.receipt_lines;
create trigger receipt_lines_touch before update on public.receipt_lines for each row execute function public.receipts_touch_updated_at();
drop trigger if exists receipt_txn_links_touch on public.receipt_txn_links;
create trigger receipt_txn_links_touch before update on public.receipt_txn_links for each row execute function public.receipts_touch_updated_at();

-- RLS: group members, or the group-less 'u-<uid>' owner.
alter table public.receipts          enable row level security;
alter table public.receipt_lines     enable row level security;
alter table public.receipt_txn_links enable row level security;

do $$
declare t text;
begin
  foreach t in array array['receipts','receipt_lines','receipt_txn_links'] loop
    execute format('drop policy if exists "%1$s group access" on public.%1$I', t);
    execute format($p$
      create policy "%1$s group access" on public.%1$I for all to authenticated
      using (group_id in (select g::text from public.live_get_my_group_ids() g)
             or group_id = 'u-' || (select auth.uid())::text)
      with check (group_id in (select g::text from public.live_get_my_group_ids() g)
             or group_id = 'u-' || (select auth.uid())::text)
    $p$, t);
  end loop;
end $$;

-- Storage: group-scoped paths <group_id>/receipts/<receipt_id>/<n>.jpg in the
-- existing private bucket. Legacy <uid>/… policies are left untouched.
drop policy if exists "Group members read ledger receipt images"   on storage.objects;
drop policy if exists "Group members write ledger receipt images"  on storage.objects;
drop policy if exists "Group members delete ledger receipt images" on storage.objects;
create policy "Group members read ledger receipt images" on storage.objects for select to authenticated
using (bucket_id = 'receipt-attachments' and (storage.foldername(name))[2] = 'receipts'
       and ((storage.foldername(name))[1] in (select g::text from public.live_get_my_group_ids() g)
            or (storage.foldername(name))[1] = 'u-' || (select auth.uid())::text));
create policy "Group members write ledger receipt images" on storage.objects for insert to authenticated
with check (bucket_id = 'receipt-attachments' and (storage.foldername(name))[2] = 'receipts'
       and ((storage.foldername(name))[1] in (select g::text from public.live_get_my_group_ids() g)
            or (storage.foldername(name))[1] = 'u-' || (select auth.uid())::text));
create policy "Group members delete ledger receipt images" on storage.objects for delete to authenticated
using (bucket_id = 'receipt-attachments' and (storage.foldername(name))[2] = 'receipts'
       and ((storage.foldername(name))[1] in (select g::text from public.live_get_my_group_ids() g)
            or (storage.foldername(name))[1] = 'u-' || (select auth.uid())::text));
```

Notes on the SQL:
- Child tables carry `group_id` directly (not via a join to `receipts`), so each RLS check
  stays a single indexed predicate.
- Nothing stops a client from writing a `receipt_lines.group_id` that differs from its
  parent receipt's. I can add a `before insert/update` trigger that copies `group_id` from
  the parent if you want that guarantee in the DB. Cheap; I lean yes. Say if you'd rather not.
- `live_get_my_group_ids()` is the same helper the `tableplan_states` and publications
  policies already use.
