# Receipt Scan / OCR Architecture Audit

> **AUDIT ONLY — no implementation.** New untracked file; no tracked files modified, no
> commits, no schema/dependency/infra changes. Stops after PLAN
> (INTENT → SPEC → PLAN → …). Baseline: `24f2c57`, tree clean, 1339 tests green.

---

## 1. Executive Summary

**Tableplan already has a mature receipt-scanning feature.** It is not "no OCR" — it is
**LLM-vision extraction**: camera/upload → client preprocessing → server proxy → Claude
Haiku vision → structured JSON → normalize → **editable review** → save, with a
**correction-learning loop** and **price-history** integration. The premise of "add OCR"
is therefore mostly *already done in a better-than-classical-OCR way* (an LLM reads
crumpled thermal receipts far better than Tesseract/TextDetector would).

So the recommendation is **not** to bolt on a local OCR engine. It is to **make three
targeted architectural improvements** to the existing pipeline:

1. **Preserve the source image + the raw extraction output** as first-class, local-first
   data. *Today the image bytes are discarded* — only the filenames are kept
   (`fileRef = files.map(f => f.name)`), so a receipt can never be re-reviewed or
   re-parsed without rescanning. This is the single highest-value gap and it is exactly
   the task's core principle ("preserve the original image; keep raw output independent").
2. **Extract a shared `document-scan` seam** behind the three duplicated scanners
   (`receipt-scan.js`, `recipe-scan.js`, `booking-scan.js`) that yields an **intermediate
   ScanResult** (raw model output + provenance + confidence + image refs) *before* domain
   parsing — the "Document → Text → Specialized Parser" abstraction, which the codebase is
   ~80% of the way to already.
3. **Add cheap client-side validation/reconciliation** (line-item sum vs subtotal/tax/
   total; missing-price/suspicious-value flags) to steer the reviewer — *no reconciliation
   exists today*.

**Local-first reality:** there is **no reliable on-device OCR for an iOS PWA** (VisionKit/
Live Text is native-only; browser `TextDetector` is Chrome/Android-only and being
retired; Tesseract-WASM is heavy and weak on receipts). Everything *except the vision call*
is already local (capture, preprocessing, review, parsing, mappings, price history,
persistence). The honest local-first posture is: **keep the cloud LLM as the accurate
primary extractor, behind a provider seam** that (a) can add a local/offline best-effort
extractor where the platform supports it, and (b) would let a future native shell plug in
device OCR without touching any domain code. Cloud stays *optional-per-scan and
already-gated*, not a hard dependency for the rest of the workflow.

---

## 2. Current Receipt Architecture (verified flow)

```
[Receipts UI: Settings → Receipts & Price History]
  openReceiptScanDialog()                                  app.js:~23xx
        │
        ▼
  <input type="file" accept="image/*" capture="environment" multiple>   index.html:2694
  <input capture="environment"> (rear camera)                            index.html:2696
        │  replaceReceiptScanFiles / appendReceiptCameraFile
        ▼
  Preview + edit: rotate / edge-trim / remove / reorder
  renderScanImagePreviews · applyScanImageAction                         app.js
        │
        ▼
  prepareScanImage(file, edit, {maxDimension:1600, quality:0.82})        app.js:31974
   edge-trim 4% · resize→1600px · rotate 90/180/270 · canvas → JPEG q.82
        │  fileToDataUrl → base64 data URLs (≤3 images enforced)
        ▼
  POST /.netlify/functions/scan-receipt  (or /api/scan-receipt local)    app.js:23424
   Bearer <supabase access token>                                        scan-receipt.js
        │  auth-gated proxy (verifies Supabase session)
        ▼
  scanReceiptFromImages(images)                                          receipt-scan.js
   → api.anthropic.com/v1/messages, model claude-haiku-4-5, temp 0
   → prompt: "Extract this grocery receipt … return only JSON <shape>"
        │  image → structured JSON in ONE call (no separable raw-text step)
        ▼
  normalizeReceipt(json)                                                 receipt-domain.js:23
        │  applyReceiptMappings(receipt, receiptItemMappings())  ← learned raw→name
        ▼
  pendingReceiptDraft → renderReceiptReview()                            app.js:23476
   editable per line: rawText, name, category, qty, unit, price, discount, confidence%
        │  Save
        ▼
  normalizeReceipts([...state.receipts, receipt])                        app.js:23572
  correctedMappingsFromReceipt(receipt, mappings)  ← capture corrections app.js:23573
  priceHistoryFromReceipt(receipt) → price history / estimation          receipt-domain.js:110
        │
        ▼
  state.receipts / state.receiptItemMappings / state.priceHistory
  (grocery JSONB state section, synced)                                  STATE_SECTIONS.grocery
```

**Capture** is identical to the rest of the app: the standard PWA `<input capture>`
pattern (native camera on mobile, file picker on desktop), also used by recipe scan,
shop-scan, cook-session photo, and finance split-scan. No `getUserMedia`/live stream.

**Extraction** is a Claude-Haiku vision call on the server (key held in Netlify env),
temperature 0, JSON-shaped. It is **not** classical OCR and **not** a two-step
image→text→parse; the LLM does recognition *and* interpretation together.

**Data model** (`receipt-domain.js`):
- Receipt: `id, storeName, storeId, purchaseDate, subtotal, tax, fees, discounts, total,
  imageUrl, fileRef, createdAt, lineItems[]`.
- Line: `id, receiptId, rawText, normalizedName, category, quantity, unit, totalPrice,
  unitPrice, discountAmount, confidenceScore, userCorrected`.

**Learning loop:** `applyReceiptMappings` seeds the draft from prior corrections;
`correctedMappingsFromReceipt` writes `userCorrected` lines back into `receiptItemMappings`
(a persisted raw→{name,category} map). `priceHistoryFromReceipt` feeds `estimateFromHistory`
/ `estimateGroceryListFromHistory` (grocery price estimates). This is a genuine,
already-working feedback system.

---

## 3. Existing Reusable Infrastructure

| Need | Already exists | Where |
|---|---|---|
| Camera + multi-image upload | `<input capture="environment" multiple>` pattern | index.html (receipt/recipe/shop/cook/finance) |
| Image preprocessing | `prepareScanImage` (trim/resize/rotate/compress) + preview edit UI | app.js:31974, `applyScanImageAction` |
| Server AI-vision proxy | thin auth-gated Netlify function pattern | `scan-receipt.js` / `scan-recipe.js` / `scan-booking.js` |
| Vision extraction | Claude image→JSON call (duplicated 3×) | `receipt-scan.js` etc. |
| Domain normalize + learning + history | `receipt-domain.js` (pure, unit-tested) | receipt-domain.js |
| Editable review draft | `renderReceiptReview` + per-field editing | app.js:23476 |
| Confidence surfacing | `confidenceScore` per line, shown as % | app.js:23523 |
| Non-destructive corrections | `rawText` preserved + `userCorrected` flag | receipt-domain.js:53,62 |
| Binary/blob storage (local-first) | content-store (IndexedDB + Supabase-Storage backstop, hash-addressed) | `content-store/blob.js`, `cloud-blob.js` |
| Image storage (cloud) | `uploadRecipePhoto` → `recipe-photos` bucket | app.js:32022 |
| Long-running status contract | async-operation.js (`import/scan/tts/sync`) | platform-capabilities `operations` |
| Provenance stamps | provenance.js | platform-capabilities `provenance` |
| Unified URL import gateway | `_import-*` (acquire→detect→extract→contract) | CONTENT_IMPORT.md, platform-capabilities `import` |
| Usage tracking | `trackUsage("claude_receipt_scan")` + usage dashboard | app.js:21368 |

**Two things are NOT reused / NOT present:**
- **No shared scan/vision module** — `receipt-scan.js`, `recipe-scan.js`, `booking-scan.js`
  duplicate `DEFAULT_SCAN_MODEL`, `validateImages`, `parseDataUrl`, `outputText`, and the
  whole Anthropic call.
- **No "scan / document-text-extraction / OCR" platform capability row** — scanning is three
  parallel domain features, not a declared capability with a canonical module.

---

## 4. OCR Options Considered

| Approach | iOS PWA | Android PWA | Desktop | Offline | Accuracy on real receipts | Cost | Bundle/CPU | Verdict |
|---|---|---|---|---|---|---|---|---|
| **LLM vision (current: Claude)** | ✅ (via server) | ✅ | ✅ | ❌ (needs network) | **High** (crumpled/thermal OK) | per-scan tokens | none client | **Keep as primary** |
| Browser `TextDetector` (Shape Detection) | ❌ not in Safari | ⚠️ Chrome-only, deprecating | ⚠️ Chrome-only | ✅ | Low–med (clean text only) | free | tiny | Optional best-effort only |
| Tesseract.js (WASM) | ✅ runs, but | ✅ | ✅ | ✅ | **Low** on receipts; slow on mobile | free | 2–4 MB+ lang data, heavy CPU | Not worth it |
| iOS VisionKit / Live Text | native only | — | — | ✅ | High | free | n/a to PWA | Only via native shell (future) |
| Android ML Kit text | — | native only | — | ✅ | High | free | n/a to PWA | Only via native shell (future) |
| Cloud OCR (Google Vision / Textract) | ✅ | ✅ | ✅ | ❌ | High text, but *still needs a parser* | per-call | none | Redundant vs LLM (LLM parses too) |

**Key truths:**
- The task's constraint is correct: **Apple's on-device OCR is not available to a web/PWA
  app.** Neither is ML Kit. A pure-web local OCR that is *reliable on receipts* does not
  exist today.
- Cloud OCR would replace the vision call with a *worse* deal: you'd still need the
  receipt parser the LLM currently gives you for free.
- Therefore the current cloud LLM is genuinely the right primary. The architectural work is
  about **the seam and the intermediate representation**, not the engine.

**Recommendation:** an **extraction-provider seam** with the Claude vision provider as the
default `structured` extractor, an optional `TextDetector` provider as a fast/offline
best-effort `text` extractor where supported, and a documented `native-ocr` slot a future
Capacitor/native shell can fill. Domains never call a provider directly — they call the
seam and receive a normalized ScanResult.

---

## 5. Recommended Architecture

```
      Camera / Upload (existing <input capture>, multi-image)
                     │
                     ▼
      prepareScanImage() preprocessing (existing)
                     │
        ┌────────────┴─── store bytes (NEW) ──► content-store blob(s)  (local-first)
        │                                         imageRefs[] on the record
        ▼
   document-scan.js  ── the shared EXTRACTION SEAM (NEW) ──────────────┐
     scanDocument(images, { kind, provider }) →                        │
        provider "claude-vision" (default): image → structured JSON    │
        provider "text-detector" (optional): image → raw text          │
     returns a ScanResult intermediate (NEW):                          │
        { engine, model, kind, rawOutput, extractedAt, status,         │
          confidence, imageRefs, structured? }                         │
                     │                                                  │
        ┌────────────┴───────────────┬───────────────────────┐         │
        ▼                            ▼                        ▼         │
  receipt-domain.js           recipe parser            article parser   │
  normalizeReceipt(...)       (recipe-scan today)      (import today)   │
        │                                                               │
        ▼                                                               │
  VALIDATION (NEW, pure): reconcile Σ lineItems vs subtotal/tax/total,  │
     flag missing prices, suspicious values, duplicate lines           │
        │                                                               │
        ▼                                                               │
  Review draft (existing renderReceiptReview) — now shows validation    │
     flags + keeps rawText/confidence/userCorrected (existing)         │
        │                                                               │
        ▼                                                               │
  Save → receipts + mappings + price history (existing) ───────────────┘
     + persist ScanResult (raw output) + imageRefs  (NEW, re-parse later)
```

**Compatibility:** fully compatible. The seam wraps the existing Anthropic call (reuse, not
rewrite); domain parsers/normalizers/review/learning/persistence are unchanged except for
receiving richer inputs and (additively) storing the image + raw output.

---

## 6. Data Model Impact

Additive only. The four layers the task names map cleanly:

| Layer | Field | Status |
|---|---|---|
| **Source** | `imageRefs: string[]` (content-store blob ids) | **NEW** — replaces filename-only `fileRef`; keep `fileRef` for back-compat display |
| **Extraction** | `extraction: { engine, model, kind, rawOutput, extractedAt, status, confidence }` | **NEW** (small object on the receipt) |
| **Interpretation** | `storeName/date/subtotal/tax/fees/discounts/total/lineItems[]` | **exists** |
| Interpretation (line) | `rawText, normalizedName, category, quantity, unit, totalPrice, unitPrice, discountAmount, confidenceScore` | **exists** |
| **Verification** | `userCorrected` (per line), + optional `validation: { reconciles, flags[] }` | `userCorrected` **exists**; `validation` **NEW** (may stay transient, not persisted) |

- **Non-destructive corrections already hold**: `rawText` is preserved and `userCorrected`
  marks a human edit — the task's "banana price 2.49→2.79" example already retains provenance.
  The one improvement: keep the *original parsed value* too (e.g. `parsedValue` alongside the
  corrected field) if you want a full audit trail. Optional.
- `state.receipts` lives in the **grocery** JSONB section. Storing raw model text there is
  fine (a receipt's raw JSON is small); **image bytes must NOT go in state** — they go in the
  content-store (local IndexedDB + cloud backstop), same as article bodies. Only the small
  `imageRefs` go on the record.
- **Scale note:** receipts are low-volume; JSONB is fine. If they ever grow like the
  Publications library did, the recent relational cutover (`publications`/`articles` tables)
  is the precedent — but that is **not** needed now.

---

## 7. UX Proposal (mobile-first)

Keep the existing dialog flow; enhance review. Recommended capture model: **capture-then-
extract** (not continuous live OCR).
- *Why not continuous:* the app uses `<input capture>` (a native camera handoff), not a live
  `getUserMedia` stream, so there is no frame loop to OCR; continuous scanning would require
  a full custom camera UI and still couldn't beat the single-shot LLM. Capture-then-extract
  matches the platform and the accurate engine.

```
Receipts ▸ Scan Receipt
  → Camera / Choose photos (multi-image; existing)
  → Preview: rotate · trim · remove · reorder (existing)
  → [Extract]  → async-operation status ("Reading receipt…") (existing contract)
  → Review draft:
       • header: store · date · subtotal · tax · fees · discounts · total
       • ⚠️ reconciliation banner if Σ lines ≠ subtotal (NEW)
       • line list: highlight low-confidence (NEW visual), missing price (NEW),
         duplicate-looking lines (NEW); every field editable (existing)
       • tap a flagged line → jump/scroll to it; never force full re-entry
  → [Save]  → receipts + mappings + price history (existing)
             + image + raw output retained (NEW)
```

Review interface priorities (all additive to `renderReceiptReview`):
- Sort/scroll uncertain fields to the top; color low-confidence and missing prices.
- Show the reconciliation delta ("lines total $24.77, receipt says $26.75 — $1.98 tax
  accounts for it ✓" or "…$2.10 unaccounted ⚠️").
- Multi-page/long receipts: already supported (≤3 images per receipt today; that cap is a
  candidate to raise — see Open Questions).
- The user **never reconstructs the whole receipt** because the LLM draft + editable review
  already exist; the additions only make *where to look* obvious.

---

## 8. Receipt-Specific Challenges — which layer owns each

| Challenge | Owner |
|---|---|
| angle / rotation (90°) / trim / resolution / compression | **preprocessing** (`prepareScanImage`, exists) |
| perspective/curved/crumpled/glare/faded/tiny-font recognition | **extraction** (LLM handles well; local OCR would not) |
| qty × unit price, weighed produce, price/lb, abbreviations, discounts/coupons, negative lines, deposits, multi-tax | **parser** (`receipt-domain.js` + prompt; mostly present, weighted-item unit already handled) |
| Σ line items vs subtotal/tax/total, missing price, suspicious value, duplicate lines | **validation/reconciliation** (NEW, pure) |
| the last-mile "is this right?" | **user review** (exists; gets flags) |

Guidance honored: don't push everything to the OCR/extraction layer. Preprocessing fixes
geometry, the LLM does recognition, the parser structures, validation catches arithmetic,
the human confirms.

---

## 9. Validation / Confidence Strategy (minimum useful)

There is **no reconciliation today** and `confidenceScore` is surfaced but not acted on.
Recommended *pure, cheap* additions (in `receipt-domain.js`, unit-tested):
1. **Arithmetic reconciliation:** `Σ totalPrice(lineItems) + tax + fees − discounts ≈ total`
   within a tolerance (e.g. ±$0.05 or ±0.5%). Surface the delta; never block saving.
2. **Required-field / missing-price flags:** line with `normalizedName` but `totalPrice==0`.
3. **Suspicious-value flags:** price/qty outliers, negative non-discount lines.
4. **Low-confidence surfacing:** already have `confidenceScore`; drive review ordering/color.
5. **Duplicate-line hint:** identical `rawText`+price adjacency.

Keep it advisory (steer the human), not gating. This is the highest reliability-per-line-of-
code improvement after image preservation.

---

## 10 & 11. Future Reuse + Integration With Existing Import

The **Document → Text → Specialized Parser** abstraction the task wants is *already latent*:
`receipt-scan`, `recipe-scan`, `booking-scan` are the same shape (image → Claude → domain
JSON) with duplicated plumbing, and the `_import-*` gateway is the URL sibling
(acquire→detect→extract→contract for recipes/articles). The plan:
- Extract **`document-scan.js`** as the shared *image* extraction seam (the three scanners
  become thin `{ kind, prompt }` configs over it). This immediately de-duplicates and gives
  recipe/booking the same ScanResult + image-preservation benefits.
- Position it beside the existing **`import` capability** (URL path) as a new **`scan` /
  document-text platform-capability** row — same "extract → contract → domain parser"
  philosophy, image source instead of URL source. This is *directly relevant to the iOS
  mobile-import gap*: iOS Safari has **no Web Share Target** (CONTENT_IMPORT.md §Mobile
  share), so URL import can't reach iOS — but **camera scan can**, making the scan seam the
  natural iOS ingestion path for recipes/articles too.
- Do **not** build a second generic pipeline. Reuse: preprocessing, async-operation status,
  provenance, content-store, review-draft pattern, and the domain normalizers already there.

---

## 12. Security & Privacy

- Receipts contain PII (names, card tails, loyalty ids, store/time, addresses). **Today the
  image leaves the device**: device → Netlify (auth-gated) → Anthropic. That is an existing,
  *undocumented-to-the-user* data flow worth making explicit.
- Existing conventions to lean on: server-side key custody (no client secret), Supabase-
  session gating on every function, account-scoped RLS, and the content-store's sign-out
  purge for local blobs (`purgeLocalArticleContent` precedent).
- Recommendations: (a) state the cloud-extraction data flow in-product (a one-line note in
  the scan dialog / settings); (b) preserved **images live in the content-store and are
  purged on sign-out** like other local blobs; (c) if a cloud path is ever made optional vs a
  local one, prefer local when available; (d) do not add a *second* cloud OCR vendor — one
  cloud egress point (Anthropic) is enough and already gated.

---

## 13. Performance

- Client cost is bounded and already tuned: `prepareScanImage` caps at **1600px / JPEG
  0.82**, ≤3 images — small uploads, light canvas work; fine on older iPhones/Android.
- The dominant latency is the **network + LLM call** (seconds), already behind an async-
  status UI. No client CPU/battery concern (no WASM OCR).
- Adding Tesseract-WASM *would* introduce the only real perf risk (multi-MB download, slow
  mobile inference) — another reason to skip it.
- Practical limits to keep: image dimension cap (1600 is good), image count per receipt
  (raise from 3 → ~5–8 for long receipts; see Open Questions), and a single in-flight scan.

---

## 14. Risks

1. **Scope creep into a local OCR engine** that underperforms the LLM and bloats the bundle —
   explicitly out of scope per this audit.
2. **Refactor risk** extracting `document-scan.js`: three live features share the plumbing;
   changing the CJS/Netlify call shape could regress recipe/booking. Mitigate with the
   existing `receipt-history.test.js`-style unit tests + a thin seam that wraps, not rewrites.
3. **Storage growth / cost** if raw images are kept forever — bounded by content-store
   retention + the existing sign-out purge; consider a "keep image N days / until confirmed"
   policy (Open Questions).
4. **Privacy expectation gap** — users may not realize receipt images go to a cloud model;
   surface it.
5. **Grocery JSONB bloat** if raw model text is large — keep only the compact raw JSON, never
   image bytes, in state.
6. **Doc drift** — README says "OpenAI image flow"; code is Anthropic/Claude. Minor, but note.

---

## 15 / 11. Phased Implementation Plan

Small, independently verifiable phases. Each is local-commits-only; nothing here requires a
deploy except live-vision E2E (which needs the server key, like the existing feature).

**Phase 1 — Source-image + raw-output preservation (highest value, self-contained).**
- Objective: stop discarding the image; persist image(s) to the content-store and the raw
  extraction output on the receipt, so re-review/re-parse needs no rescan.
- Changes: `app.js` `scanReceiptImages`/save (store blobs via content-store, set
  `imageRefs`); `receipt-domain.js` (`imageRefs[]`, `extraction{}` fields, normalized/back-
  compat with `fileRef`).
- New: possibly `content-store` helper for scan images (or reuse blob API directly).
- Data model: additive (`imageRefs`, `extraction`). Tests: domain normalize round-trip;
  image-ref persistence; sign-out purge. Risk: low (additive).

**Phase 2 — Validation / reconciliation (pure, high ROI).**
- Objective: flag arithmetic mismatches, missing prices, suspicious/duplicate lines in review.
- Changes: `receipt-domain.js` (pure `reconcileReceipt`/`validateReceipt`); `renderReceiptReview`
  shows flags. New: none. Tests: reconciliation math, tolerances, flag cases. Risk: low.

**Phase 3 — Extraction seam (`document-scan.js`) + ScanResult intermediate.**
- Objective: de-duplicate the three scanners behind one seam producing a normalized
  ScanResult; receipt/recipe/booking become thin configs.
- Changes: new `document-scan.js` (CJS, wraps the Anthropic call, provider-aware); refactor
  `receipt-scan.js`/`recipe-scan.js`/`booking-scan.js` to use it; Netlify functions unchanged
  externally. Data model: none. Tests: seam unit tests + existing scan tests still green.
  Risk: medium (shared live code) — mitigate with tests + wrap-not-rewrite.

**Phase 4 — Review/correction UX polish.**
- Objective: surface uncertainty well (order/colour low-confidence, jump-to-flag, show the
  stored source image thumbnail from Phase 1). Changes: `renderReceiptReview` + CSS. Risk: low.

**Phase 5 — Optional local best-effort provider + capability declaration.**
- Objective: add a `TextDetector` provider (offline/instant where supported) as a non-default
  path, and declare a `scan`/document-text row in `platform-capabilities.js`; document the
  `native-ocr` slot. Changes: `document-scan.js` provider, `platform-capabilities.js`. Risk:
  low (opt-in, degradation-safe).

**Phase 6 — Adversarial testing.**
- Objective: difficult-receipt + failure-path coverage (see §16). Risk: low.

**Phase 7 — Reuse foundation for recipe/article scanning.**
- Objective: point recipe (and a new article) scan at the same seam + ScanResult + image
  preservation; make camera-scan the iOS ingestion path that Web-Share-Target can't be.
  Changes: recipe scan wiring; small article-scan parser. Risk: medium; do last.

*(Phase 1 and Phase 2 deliver most of the task's stated principles and can ship before the
seam refactor. If time-boxed, do 1 → 2 → stop and reassess.)*

---

## 16. Testing Plan

- **Unit (pure, `receipt-domain.js` + new modules):** normalize round-trip incl. `imageRefs`/
  `extraction`; reconciliation math + tolerances; missing-price/suspicious/duplicate flags;
  confidence handling; correction-learning (`correctedMappingsFromReceipt` unchanged);
  price-history creation; ScanResult normalization.
- **Integration (mockable, no live key):** image(s) → seam (mocked provider) → domain →
  receipt model; user-correction → mappings → next draft seeded; save → receipts + price
  history; re-open a saved receipt → review from stored raw output *without* rescanning.
- **Mobile:** camera `<input capture>` handoff; multi-image; offline (extraction fails
  gracefully → "no network, try later", draft not lost); large/long receipts (image count +
  size caps); poor-quality image → low confidence + reconciliation flags.
- **Adversarial:** faded/thermal, curved/crumpled, glare, tiny font, qty×unit, weighed
  produce, coupons/negative lines, multi-tax, subtotal/total mismatch, duplicate lines, a
  non-receipt image, and a truncated/garbage LLM response — asserting the app **fails safe**
  (clear message, editable draft, no crash, no silent bad save), not "works on a clean
  receipt."

---

## 17. Files Likely to Change / Add

**Existing (change):** `app.js` (scan/save wiring, review render), `receipt-domain.js` (model
+ validation), `receipt-scan.js` / `recipe-scan.js` / `booking-scan.js` (use the seam),
`platform-capabilities.js` (declare `scan`), `index.html` (review UI bits), `styles.css`
(flags/thumbnail). **New:** `document-scan.js` (shared extraction seam), possibly a small
content-store scan-image helper, `test/receipt-scan-domain.test.js` / `test/document-scan.test.js`.
**Unchanged:** the Netlify function contracts (`scan-receipt.js` stays a thin proxy),
content-store internals, sync/state machinery.

---

## 18. Open Questions (need a product/architecture decision)

1. **Image retention:** keep the original receipt image **forever**, or **until confirmed / N
   days**? (Storage + privacy vs "re-parse later" value.) Recommendation: keep until the user
   deletes the receipt; purge local copy on sign-out (cloud backstop remains, RLS-scoped).
2. **Cloud-extraction disclosure:** OK to keep sending receipt images to Anthropic as the
   default (with an in-product note), given no viable local OCR? Or gate scanning behind an
   explicit opt-in like Mail-AI features?
3. **Image-count cap:** raise the per-receipt cap from **3** (long receipts need more)? To
   what — 5? 8? (Affects upload size + token cost.)
4. **Raw-output storage location:** store the raw model JSON on the receipt record (grocery
   JSONB) — acceptable size-wise — or in the content-store beside the image?
5. **Scope for this pass:** ship **Phase 1 + 2 only** (image + raw preservation + validation,
   the task's core principles) and defer the seam/reuse refactor (Phases 3/5/7)? Or commit to
   the full seam now?

---

*End of audit. No tracked files modified; this document is the only new file. Stops at PLAN.*
