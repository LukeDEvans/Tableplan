# Receipts — one list for Shop and Finance

**Decision (Luke, 2026-10-01):** Shop and Finance share one receipts list. Shop's
receipt model is the canonical one: scan → review every line → save. Each receipt
also carries what Finance needs.

## Where it lives

- **`state.receipts`**: the JSONB `grocery` section. It is Shop-owned (groceries-ui.js)
  and synced like any section: union by `id` with `receipts` tombstones. No new table and
  no migration.
- **Photos**: the scan-content store (IndexedDB plus the `reading-content` backstop), keyed by
  receipt id through `imageRefs`. This is unchanged.
- **`finreceipts_<group>`** (service-only row): now **only an inbox**. The mail sweep
  (`_gmail-shared.js`) and the browser extension (`simplefin` `importReceipt`) still write
  there. Finance imports new entries into `state.receipts` once per session
  (`importFinanceInboxReceipts`). The id comes from the inbox id, so a re-import is a
  no-op, and a receipt deleted in Shop stays deleted because its tombstone is checked.

## Record (receipt-domain.js `normalizeReceipt`)

Shop's fields: store, date, subtotal/tax/fees/discounts/total, line items, imageRefs,
extraction. Added for Finance:

| Field | Meaning |
|---|---|
| `lineItems[].budgetCategory` | Finance budget key `cat:<groupId>:<categoryId>`, or `""` |
| `source` | `scan` (default) · `email` · `extension` · `manual` |
| `externalId` | Gmail message id for `email` receipts (for the "Email" link) |
| `financeTxnId` | the transaction it was itemized against, once linked |

Only `scan`/`manual` receipts feed grocery price history, item mappings and the
grocery catalog (`feedsPriceHistory`). Amazon-style email orders do not.

## Scanning

One AI read per receipt. `scan-receipt` loads the household's budget categories
(`_finance-categories.js`). The prompt (`receipt-scan.js`) asks for a `budgetCategory` on
each line, and unknown keys are dropped. In the review and edit forms, each line has a
budget-category picker. The header scanner (Camera / Photo) opens this same review.
In the iPhone app, Camera uses the native document scanner.

## Finance's interface (injected; Finance never reads `state.receipts` directly)

- `receiptsForFinance()`: receipts as `{ id, merchant, date, total, source, externalId,
  financeTxnId, items, portions }`. `portions` are per-category sums plus one
  unlabeled remainder (`receiptFinancePortions`).
- `importFinanceInboxReceipts(list)`, `linkReceiptToFinanceTxn(receiptId, txnId)`,
  `openReceiptDetail(receiptId)` (opens the receipt in Shop).

Matching (`financeReceiptForTxn`): use the receipt linked to the transaction if there is
one. Otherwise use an unlinked receipt with the same total (±2¢) dated within 4 days.
The Finance → Insights → Receipts card lists receipts from the last 45 days.

The split editor's own "Scan receipt" (`simplefin` `scanReceipt`) is unchanged. It
fills a split directly and stores nothing.
