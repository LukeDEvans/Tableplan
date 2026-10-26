// receipt-scan-queue.js — scan and go, the phone's side (RECEIPTS.md "Scan and go").
// PURE: the queue of receipts this device has sent to be read, and how finished
// reads from the server (receipt-scans) turn into receipts in the one list.
// groceries-ui.js does the I/O (photos, upload, fetch, localStorage, state).
//
// Queue (localStorage "live-receipt-scans-v1", account-scoped):
//   { since, items: [{ id, at, state, error, pages, refs, fileRef, ocrPages, sentAt, tries }] }
//   state: "uploading" — photos going up (interrupted if the app closed mid-way)
//          "waiting"   — couldn't send (offline): photos are on the phone, it retries
//          "sent"      — the background read has it; a result is coming
//          "failed"    — the read failed or never came back; Retry or Remove
//   since: the newest result time this device has seen, so it asks only for newer.

export const RECEIPT_QUEUE_KEY = "live-receipt-scans-v1";
// No answer this long after sending → the read is treated as lost (Retry offered).
export const SENT_TIMEOUT_MS = 10 * 60 * 1000;
// An upload this old was cut off (the app closed); send it again.
export const UPLOAD_STALE_MS = 60 * 1000;
const MAX_ITEMS = 20;

export function emptyQueue() {
  return { since: "", items: [] };
}

export function parseQueue(raw) {
  try {
    const q = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!q || typeof q !== "object") return emptyQueue();
    const items = (Array.isArray(q.items) ? q.items : []).filter((i) => i && typeof i.id === "string" && i.id);
    return { since: typeof q.since === "string" ? q.since : "", items: items.slice(-MAX_ITEMS) };
  } catch {
    return emptyQueue();
  }
}

export function addToQueue(queue, item) {
  const items = (queue.items || []).filter((i) => i.id !== item.id);
  return { ...queue, items: [...items, { tries: 0, error: "", ...item }].slice(-MAX_ITEMS) };
}

export function updateInQueue(queue, id, patch) {
  return { ...queue, items: (queue.items || []).map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

export function removeFromQueue(queue, id) {
  return { ...queue, items: (queue.items || []).filter((i) => i.id !== id) };
}

// Items to send again now: "waiting" ones, and uploads cut off by the app closing.
export function itemsToResend(queue, now = Date.now()) {
  return (queue.items || []).filter((i) => i.state === "waiting"
    || (i.state === "uploading" && now - Date.parse(i.at || 0) > UPLOAD_STALE_MS));
}

// Is a read out that this device is waiting on?
export function awaitingResults(queue) {
  return (queue.items || []).some((i) => i.state === "sent");
}

// Finished reads → what to do. `existingIds`: ids already in state.receipts;
// `deletedIds`: receipts tombstoned (deleted) on any device.
// Returns { queue, imports, failed, attach }:
//   imports — "done" entries to add to the list (new to this device)
//   failed  — queue ids whose read failed (state set to "failed" with the message)
//   attach  — { id, refs }: receipts already in the list (another device imported
//             them first) that this device holds the photo refs for
// Sent items with no answer after SENT_TIMEOUT_MS are marked failed too.
export function applyScanResults(queue, scans, { existingIds = new Set(), deletedIds = new Set(), now = Date.now(), latest = "" } = {}) {
  let next = { ...queue, items: [...(queue.items || [])] };
  const imports = [];
  const failed = [];
  const attach = [];
  const queued = new Map(next.items.map((i) => [i.id, i]));
  for (const scan of (Array.isArray(scans) ? scans : [])) {
    if (!scan || !scan.id) continue;
    const mine = queued.get(scan.id);
    if (scan.status === "done" && scan.receipt) {
      if (mine) next = removeFromQueue(next, scan.id);
      if (deletedIds.has(scan.id)) continue;
      if (existingIds.has(scan.id)) {
        if (mine?.refs?.length) attach.push({ id: scan.id, refs: mine.refs });
        continue;
      }
      imports.push({ scan, refs: mine?.refs || null });
    } else if (scan.status === "failed" && mine) {
      next = updateInQueue(next, scan.id, { state: "failed", error: scan.error || "The receipt couldn't be read." });
      failed.push(scan.id);
    }
  }
  for (const item of next.items) {
    if (item.state === "sent" && now - Date.parse(item.sentAt || item.at || 0) > SENT_TIMEOUT_MS) {
      next = updateInQueue(next, item.id, { state: "failed", error: "No answer came back from the reader." });
      failed.push(item.id);
    }
  }
  if (latest && (!next.since || latest > next.since)) next.since = latest;
  return { queue: next, imports, failed, attach };
}

// The receipt to add for a finished read. This device's photo refs (local hashes,
// cloud paths) win over the server's (cloud paths only), so the photos show
// without a download here.
export function receiptFromScanResult(scan, refs = null) {
  const receipt = { ...(scan?.receipt || {}), id: scan?.id, source: "scan" };
  if (Array.isArray(refs) && refs.length) receipt.imageRefs = refs;
  return receipt;
}

// One line for the toast when results arrive.
export function resultsToast(imported) {
  const list = Array.isArray(imported) ? imported : [];
  if (!list.length) return "";
  const money = (n) => (Number(n) > 0 ? ` · $${Number(n).toFixed(2)}` : "");
  const checks = list.filter((r) => r?.extraction?.status === "check").length;
  if (list.length === 1) {
    const r = list[0];
    return `${r.storeName || "Receipt"}${money(r.total)} is in${checks ? " — it needs a quick look" : " ✓ adds up"}`;
  }
  return `${list.length} receipts are in${checks ? ` — ${checks} need${checks === 1 ? "s" : ""} a quick look` : " ✓"}`;
}
