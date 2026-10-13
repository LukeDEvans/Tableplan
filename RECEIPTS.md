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

## Share sheet (iPhone)

**Decision (Luke, 2026-10-13):** order screenshots (Amazon order details, "Your Orders",
other stores' order history) shared from the iPhone share sheet go to Finance. Amazon's
emails don't carry enough detail, so a screenshot is the source.

**Decision (Luke, 2026-10-13, later):** Amazon's detailed **Order Summary** (Save → share
sheet, a PDF) goes to Finance the same way; it's the most detailed source.

- **Order-summary PDFs:** the extension also appears for PDFs. It reads the PDF on the
  phone with PDFKit (first 6 pages, ≤40,000 characters) and sends the **text** with
  `kind: "summary"`, so the model reads an exact invoice instead of an image. A PDF with
  no text layer (a scan) is sent as up to 4 page images instead, like screenshots. The
  server uses the summary variant of `orderScreenshotPrompt` (`{ source: "summary" }`):
  one entry per order, shipments kept together, the grand total.
- **Share Extension** (`ios/App/ShareExtension/`): "Live" in the share sheet for 1–4
  images or one PDF (activation predicate: any attachment conforming to `public.image`
  or `com.adobe.pdf`; only the first 4 images / first PDF are used). It downscales each screenshot (≤1568px, JPEG) and POSTs them straight to
  `share-receipt`, so nothing waits for the app to open. It shows "Added to Finance ·
  Amazon · $31.47 · Oct 10" and closes, or says what went wrong.
- **Auth: a share token, not the app's session.** The extension can't safely use the
  Supabase session (a refresh there would rotate the refresh token out from under the
  app). `share-receipt` `mint` turns a session into an HMAC-signed `{ userId, exp }`
  token (the `_oauth-state.js` signer, purpose `receipt-share-v1`, one year). The app
  stores it in the keychain group it shares with the extension
  (`6RTNUZR7K5.com.mrlukedevans.live.shared`, `ShareTokenStore.swift`) via the
  `ShareToken` plugin. `receipt-share-token.js` mints on sign-in / app start (again
  after 30 days) and clears on sign-out. The token can only add receipts to the inbox of
  the household the user is in right now. **Revoke every token:** bump
  `SHARE_TOKEN_PURPOSE`.
- **Server** (`netlify/functions/share-receipt.js`): one read of the screenshots
  (`orderScreenshotPrompt` in `_receipt-extract.js`, which also holds the helpers moved
  out of `simplefin.js`). One receipt per order on the page; an order without a visible
  total is skipped. Each goes to the `finreceipts_` inbox as source `share`, id
  `shr_<merchant|date|total>`, so re-sharing an order replaces it.
- **Into the list:** Finance imports the inbox at session start, and again when Finance
  is opened or the app returns to the foreground on Finance (at most every 2 min). A
  `share` receipt is shown as "Online order" and doesn't feed grocery price history.
  When the same order is shared again with more item prices (the list page first, the
  details page after), the newer read replaces the line items unless a line was edited
  by hand (`shareReceiptUpgrade`); the transaction link and date added are kept.
- **CI signing:** both iOS workflows archive **ad hoc** (`CODE_SIGN_IDENTITY=-`), not
  unsigned, because the App Store export copies entitlements from the archived
  signature. `scripts/ios-check-entitlements.sh` fails the run if the app or the
  extension lost the keychain group.
