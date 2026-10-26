// Scan-and-go receipts (RECEIPTS.md "Scan and go"): where finished reads wait.
//
// The phone uploads the receipt photos to its own folder in the reading-content
// bucket, sends a small request to scan-receipt-background, and can close the app.
// The background function reads the receipt and writes the result here; any of the
// household's devices imports it into the one receipts list (state.receipts) the next
// time it looks (receipt-scans).
//
// One row per result: "receiptscan_<groupId>_<receiptId>" in tableplan_states. No
// ":" in the id, so no client can read or write it (RLS keys on the part before
// ":"); only these functions can, with the service role. One row each keeps the
// reads small: a device asks only for rows changed since it last looked, so the
// usual answer is an empty list. Rows older than 21 days are deleted on the next save.
const { SUPABASE_URL, serviceHeaders } = require("./_state-sections.js");

const MAX_RESULTS = 25;
const MAX_AGE_MS = 21 * 24 * 3600 * 1000;
const PHOTO_BUCKET = "reading-content";
const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function scanRowPrefix(groupId) {
  return `receiptscan_${groupId}_`;
}

function scanRowId(groupId, receiptId) {
  return `${scanRowPrefix(groupId)}${receiptId}`;
}

async function saveScanResult(serviceKey, groupId, entry, now = new Date()) {
  const at = now.toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...serviceHeaders(serviceKey), "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: scanRowId(groupId, entry.id), state: { ...entry, at }, updated_at: at }),
  });
  if (!res.ok) throw new Error(`Receipt result save failed (${res.status})`);
  // Housekeeping: this household's results older than 21 days.
  const cutoff = new Date(now.getTime() - MAX_AGE_MS).toISOString();
  await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=like.${encodeURIComponent(scanRowPrefix(groupId) + "*")}&updated_at=lt.${encodeURIComponent(cutoff)}`,
    { method: "DELETE", headers: { ...serviceHeaders(serviceKey), prefer: "return=minimal" } }
  ).catch(() => {});
}

// Results changed after `since` (ISO), oldest first, at most 25. Returns
// { scans, latest } where latest is the newest updated_at seen (or since).
async function loadScanResults(serviceKey, groupId, since = "", now = Date.now()) {
  const floor = new Date(now - MAX_AGE_MS).toISOString();
  const after = since && since > floor ? since : floor;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=like.${encodeURIComponent(scanRowPrefix(groupId) + "*")}`
      + `&updated_at=gt.${encodeURIComponent(after)}&select=state,updated_at&order=updated_at.asc&limit=${MAX_RESULTS}`,
    { headers: serviceHeaders(serviceKey), cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Receipt results load failed (${res.status})`);
  const rows = await res.json();
  const scans = rows.map((r) => r.state).filter((s) => s && s.id);
  const latest = rows.length ? rows[rows.length - 1].updated_at : (since || "");
  return { scans, latest };
}

// A photo reference from the client is only accepted inside the caller's own
// folder of the photo bucket ("<userId>/<sha256>"), so the server can never be
// asked to read someone else's files. Pure (tested).
function validPhotoRefs(photos, userId) {
  const uid = String(userId || "").replace(/[^a-z0-9-]/gi, "-");
  if (!uid || !Array.isArray(photos)) return [];
  return photos
    .filter((p) => p && p.bucket === PHOTO_BUCKET && typeof p.path === "string" && new RegExp(`^${uid}/[0-9a-f]{64}$`).test(p.path))
    .slice(0, MAX_PHOTOS)
    .map((p) => ({ bucket: PHOTO_BUCKET, path: p.path, mimeType: /^image\/(jpeg|png|webp)$/.test(p.mimeType) ? p.mimeType : "image/jpeg" }));
}

// Download one photo with the service key → a data URL for the vision call.
async function photoDataUrl(serviceKey, ref) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${ref.bucket}/${ref.path}`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) throw new Error(`Couldn't load a receipt photo (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length || buf.length > MAX_PHOTO_BYTES) throw new Error("A receipt photo was empty or too large.");
  return `data:${ref.mimeType};base64,${buf.toString("base64")}`;
}

// OCR rows from the phone: strings only, bounded (they ride the request body,
// which Netlify caps near 256 KB for background functions).
function cleanOcrPages(pages) {
  if (!Array.isArray(pages)) return null;
  let budget = 40000;
  const out = [];
  for (const page of pages.slice(0, MAX_PHOTOS)) {
    if (!Array.isArray(page)) continue;
    const rows = [];
    for (const row of page.slice(0, 400)) {
      const text = String(row || "").slice(0, 200);
      if (!text || budget - text.length < 0) break;
      budget -= text.length;
      rows.push(text);
    }
    out.push(rows);
  }
  return out.some((p) => p.length) ? out : null;
}

module.exports = {
  MAX_RESULTS, MAX_AGE_MS, PHOTO_BUCKET,
  scanRowId, saveScanResult, loadScanResults, validPhotoRefs, photoDataUrl, cleanOcrPages,
};
