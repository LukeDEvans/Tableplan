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

## Reading a receipt (2026-10-26)

**Decision (Luke, 2026-10-26):** the AI reads, code does the math. Scans of correct Costco
and Target receipts (2026-10-23) had been marked "doesn't add up" because the check used one
fixed formula: Costco takes coupons off *before* the subtotal and Target's RedCard 5% comes off
*after* it, with the bag fee inside the subtotal.

1. **Transcribe** (`receipt-scan.js` prompt). The model copies what is printed and does no
   arithmetic: every priced line above the subtotal, with coupons / instant savings as their own
   lines (`k:"d"`, negative, `for` = the product they apply to) and fees or bags among the items
   as their own lines (`k:"f"`); then subtotal, tax and total as printed, plus only the savings
   and fees printed *below* the subtotal. Compact line shape as before (short keys, defaults left
   out, budget category as a list number `b`), so long receipts stay fast. A coupon line becomes
   a negative line with category `Savings` and its product's budget category, so Finance's split
   nets it.
2. **Reconcile** (`receipt-reconcile.js`, pure, shared by the app and the functions). Tries each
   placement of receipt-level savings (repeating coupon lines / before / after the subtotal) and
   fees (inside / after the subtotal) and keeps the one under which the lines, subtotal and total
   agree (±2¢). When nothing agrees it says which part is off and by how much ("the items come to
   $95.92, $1.17 less than the subtotal"). `validateReceipt` uses it; duplicate-line hints only
   show when the receipt doesn't add up (two identical lines are usually two of the item).
3. **Store profiles** (`RECEIPT_STORE_PROFILES`): Costco, Target, ALDI, Whole Foods, Trader
   Joe's. Each has a one-line reading hint for the prompt and, where known, which side of the
   subtotal its savings and fees sit on (a tie-break only; the numbers decide first).
4. **Second look.** When the first read doesn't add up, the background reader asks once more
   with the stronger model (`ANTHROPIC_RECEIPT_RECHECK_MODEL`, default `claude-sonnet-4-6`),
   giving it the first reading and what's off. The second read is kept only if it adds up
   better. The synchronous `scan-receipt` (older app builds) has no second look (30 s limit).
5. **The iPhone's own text recognition** (DocumentScanner plugin: `scan({ ocr: true })` for the
   camera, `recognizeText` for library photos; app builds from 2026-10-26). Rows are rebuilt from
   Vision's boxes (`ocrRowsFromObservations`) and sent with the photos. The server puts the text
   in the prompt, adopts the printed subtotal/tax/total when the AI's don't add up and those do,
   and lowers the confidence of any line whose price appears nowhere in the printed text (shown
   as low-confidence in review). Older builds and browsers simply send none.

A read that adds up is **ready**: `extraction.status = "ok"`, and it feeds price history at
once. Otherwise `"check"`: the receipt shows **Needs a look** in Receipts, its edit view says
what's off and updates as numbers are changed, and saving it marks it `"reviewed"` (price
history is built then). `extraction.status` lives inside `extraction`, which older builds keep.

## Scan and go (2026-10-26)

**Decision (Luke, 2026-10-26):** scan, send, close the app.

- **Phone:** the header Camera / Photo (and the Receipts dialog's **Send receipt**) prepare the
  photos, upload them to the person's own folder of the `reading-content` bucket (the same
  backstop scan images always used, via `scan-content.js`; also kept on the phone), and POST a
  small request to `scan-receipt-background` (Netlify caps background-function bodies near
  256 KB, so no images ride it). The toast says "Receipt sent ✓ You can close the app" once the
  202 is back, usually a couple of seconds.
- **Queue** (`receipt-scan-queue.js`, localStorage `live-receipt-scans-v1`, account-scoped):
  `uploading` → `sent`; `waiting` when offline (sent again on `online` or next open); an upload
  cut off by closing the app is sent again on the next open; `failed` with the reason (or after
  10 min with no answer) shows **Try again / Remove** above the list.
- **Server:** `scan-receipt-background` checks the photos are in the caller's folder, downloads
  them with the service key, runs the read above, and writes one row per result,
  `receiptscan_<groupId>_<receiptId>` in `tableplan_states` (no `:`, so clients can't read it;
  rows over 21 days are deleted on the next save). `receipt-scans` returns the results written
  after the `since` a device sends, so the usual answer is empty.
- **Into the list:** any household device imports finished reads (new ids only; tombstones
  respected), links the store, applies item mappings, and toasts "ALDI · $97.09 is in — it needs
  a quick look". The sending phone's photo refs are attached when another device imported first.
- **When it asks:** only while a read is out (≈20 s, 40 s, 70 s, 2 min, 4 min after sending and
  on returning to the app, never closer than 12 s); otherwise at most every 10 min, on app start
  and on opening Shop.
- **Local dev** (`canUseLocalBackend`) still reads in the dialog with review, as before.
- Each scan reads the household's budget categories with `select=state->financeBudgetGroups`,
  not the whole finance section (egress).

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
