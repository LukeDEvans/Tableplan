// Scan and go (RECEIPTS.md): read a receipt after the phone has moved on.
//
// The "-background" suffix gives a 15-minute limit and an immediate 202 to the
// caller, so the phone only waits for its upload. The photos are already in the
// caller's own folder of the reading-content bucket; the request body is small
// (Netlify caps background-function bodies near 256 KB, so no images ride it).
//
// Input JSON: { receiptId, photos: [{ bucket, path, mimeType }], ocrPages?, fileRef? }
//   receiptId — the id the receipt will have in the list (made on the phone, so
//               the phone's local copy of the photos lines up with it)
//   ocrPages  — the iPhone's own text recognition, rows per page (optional)
// Output: one entry in the household's receiptscans_ row (_receipt-scans.js),
// "done" with the receipt, or "failed" with a message. Nothing is returned.
const { getUserIdFromToken, getUserGroupId } = require("./_state-sections.js");
const { loadFinanceCategories } = require("./_finance-categories.js");
const { saveScanResult, validPhotoRefs, photoDataUrl, cleanOcrPages } = require("./_receipt-scans.js");
const { readReceipt } = require("../../receipt-scan");

const RECEIPT_ID_RE = /^[a-z0-9][a-z0-9_-]{5,79}$/i;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405 };
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.error("[scan-receipt-background] no service key"); return { statusCode: 200 }; }

  const accessToken = (event.headers?.authorization || event.headers?.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  const userId = accessToken ? await getUserIdFromToken(accessToken, serviceKey) : null;
  if (!userId) { console.warn("[scan-receipt-background] not signed in"); return { statusCode: 401 }; }

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return { statusCode: 400 }; }
  const receiptId = String(body.receiptId || "");
  if (!RECEIPT_ID_RE.test(receiptId)) { console.warn("[scan-receipt-background] bad receipt id"); return { statusCode: 400 }; }

  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) { console.warn("[scan-receipt-background] no household"); return { statusCode: 200 }; }

  const startedAt = Date.now();
  const base = { id: receiptId, by: userId };
  try {
    const photos = validPhotoRefs(body.photos, userId);
    if (!photos.length) throw new Error("The receipt photos didn't arrive. Try again.");
    const images = [];
    for (const ref of photos) images.push(await photoDataUrl(serviceKey, ref));
    const categories = await loadFinanceCategories(serviceKey, groupId);
    const result = await readReceipt(images, { categories, ocrPages: cleanOcrPages(body.ocrPages), recheck: true });
    const lines = result.receipt.lineItems || [];
    const receipt = {
      ...result.receipt,
      id: receiptId,
      source: "scan",
      fileRef: String(body.fileRef || "").slice(0, 200),
      // The photos stay where the phone put them; another device shows them from there.
      imageRefs: photos.map((p, index) => ({ index, hash: p.path.split("/").pop(), size: 0, mimeType: p.mimeType, cloud: { bucket: p.bucket, path: p.path } })),
      extraction: {
        engine: "claude-vision",
        model: result.model || "",
        kind: "receipt",
        rawOutput: (result.rawText || "").slice(0, 12000),
        extractedAt: new Date().toISOString(),
        status: result.status,
        confidence: lines.length ? lines.reduce((s, l) => s + (Number(l.confidenceScore) || 0), 0) / lines.length : 0,
      },
    };
    await saveScanResult(serviceKey, groupId, {
      ...base,
      at: new Date().toISOString(),
      status: "done",
      receipt,
      verdict: { ok: result.verdict.ok, checked: result.verdict.checked, message: result.verdict.message || "" },
      rechecked: !!result.rechecked,
      ocrUnmatchedLineIds: result.ocrUnmatchedLineIds || [],
    });
    console.log(`[scan-receipt-background] ${receiptId}: ${result.status}${result.rechecked ? " (second look)" : ""}, ${lines.length} lines, ${Date.now() - startedAt} ms`);
  } catch (error) {
    console.error(`[scan-receipt-background] ${receiptId} failed:`, error?.message || error);
    try {
      await saveScanResult(serviceKey, groupId, {
        ...base,
        at: new Date().toISOString(),
        status: "failed",
        error: String(error?.message || "The receipt couldn't be read.").slice(0, 300),
      });
    } catch (e) { console.error("[scan-receipt-background] couldn't record the failure:", e?.message || e); }
  }
  return { statusCode: 200 };
};
