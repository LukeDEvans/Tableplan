// The receipts outbox (DOCUMENTS_DESIGN.md §7; Luke, 2026-11-03: "file next time I
// open"). Every receipt scanned in the app is also kept in Household Documents ›
// Receipts. Filing needs the Household vault key, which is behind Face ID, so a
// scan never prompts: its pages wait here, on this device, and are filed the next
// time Household Documents is opened.
//
// The outbox is its own small IndexedDB store ("live-documents-outbox"), encrypted
// like messaging's (the iPhone's Keychain key, or the browser's non-extractable
// key). Bounded: at most OUTBOX_MAX receipts and OUTBOX_MAX_BYTES, oldest dropped
// first, and nothing older than OUTBOX_MAX_AGE_DAYS (someone who never sets up
// Documents doesn't collect receipts forever). Deleted at sign-out with the others.
//
// Entry: key "r:<at>:<rand>" → { at (ms), scope (the household it was scanned in),
//   camera (pages from the document camera: already upright), pages: [{ bytes, type }],
//   fileIds (chosen before the first upload, so a retry after a crash finds what was
//   already stored instead of filing it twice), attempts }.

export const OUTBOX_DB = "live-documents-outbox";
export const OUTBOX_LOCK = "documents-outbox";
export const OUTBOX_MAX = 100;
export const OUTBOX_MAX_BYTES = 80 * 1024 * 1024;
export const OUTBOX_ENTRY_MAX_BYTES = 60 * 1024 * 1024; // under the storage function's 70 MB per part
export const OUTBOX_MAX_AGE_DAYS = 60;
export const OUTBOX_MAX_ATTEMPTS = 5;
const MAX_PAGES = 10;

// The browser's guess for a photo, tidied: "image/jpg" is JPEG.
const pageType = (type) => String(type || "").toLowerCase().replace("image/jpg", "image/jpeg");

export function createReceiptOutbox(store, { now = () => Date.now() } = {}) {
  async function entries() {
    const out = [];
    for (const key of await store.keys("r:")) {
      const value = await store.get(key);
      if (value && Array.isArray(value.pages)) out.push({ key, ...value });
    }
    return out.sort((a, b) => a.at - b.at);
  }

  const sizeOf = (e) => e.pages.reduce((n, p) => n + (p.bytes?.length || 0), 0);

  // Drops what's too old, then the oldest until it fits.
  async function prune() {
    const cutoff = now() - OUTBOX_MAX_AGE_DAYS * 24 * 3600 * 1000;
    let list = await entries();
    for (const e of list.filter((x) => x.at < cutoff)) await store.remove(e.key);
    list = list.filter((x) => x.at >= cutoff);
    let bytes = list.reduce((n, e) => n + sizeOf(e), 0);
    while (list.length > OUTBOX_MAX || bytes > OUTBOX_MAX_BYTES) {
      const e = list.shift();
      bytes -= sizeOf(e);
      await store.remove(e.key);
    }
  }

  return {
    // pages: [{ bytes: Uint8Array, type: "image/jpeg" | … }]; scope: the household
    // it's for (filed only there); camera: pages from the document camera.
    // at: when the receipt was captured (a shared screenshot kept by the share
    // extension is filed later); defaults to now.
    async queue(pages, { scope, camera = false, receiptId = "", at: capturedAt = null } = {}) {
      if (!scope) return null;
      const kept = (pages || []).filter((p) => p?.bytes instanceof Uint8Array && p.bytes.length && /^(image\/|application\/pdf$)/.test(pageType(p.type))).slice(0, MAX_PAGES);
      if (!kept.length || kept.reduce((n, p) => n + p.bytes.length, 0) > OUTBOX_ENTRY_MAX_BYTES) return null;
      const at = Number.isFinite(capturedAt) && capturedAt > 0 && capturedAt <= now() ? Math.round(capturedAt) : now();
      const key = `r:${String(at).padStart(15, "0")}:${Math.random().toString(36).slice(2, 10)}`;
      await store.set(key, { at, scope, camera: Boolean(camera), receiptId: String(receiptId || ""), attempts: 0, pages: kept.map((p) => ({ bytes: p.bytes, type: pageType(p.type) })) });
      await prune();
      return key;
    },
    entries,
    get: async (key) => { const v = await store.get(key); return v && Array.isArray(v.pages) ? { key, ...v } : null; },
    put: (key, entry) => { const { key: _k, ...value } = entry; return store.set(key, value); },
    remove: (key) => store.remove(key),
    prune,
  };
}

// The name for a filed receipt: "<store> · <date>" from the receipt the app read
// from this scan, else "Receipt · <date>". The read is saved after the scan, so the
// match is the first scan receipt saved in the 15 minutes after it (a minute's
// slack for clocks) that no other receipt in this run took. receipts: [{ id,
// storeName, purchaseDate, createdAt, source }]; used: ids already taken.
// `receiptId`: the id the scan was given (known for a scan-and-go receipt); that
// receipt is used when it has arrived, and time is only the fallback.
export function receiptLabel(at, receipts = [], used = new Set(), receiptId = "") {
  const known = receiptId ? (receipts || []).find((r) => r?.id === receiptId && r.storeName) : null;
  const near = known || (receiptId ? null : (receipts || [])
    .filter((r) => (r?.source || "scan") === "scan" && r?.storeName && r?.createdAt && !used.has(r.id))
    .map((r) => ({ r, gap: Date.parse(r.createdAt) - at }))
    .filter((x) => Number.isFinite(x.gap) && x.gap >= -60 * 1000 && x.gap <= 15 * 60 * 1000)
    .sort((a, b) => a.gap - b.gap)[0]?.r);
  if (near?.id) used.add(near.id);
  const date = near?.purchaseDate || isoDay(at);
  return { receiptId: receiptId || near?.id || "", name: `${near ? near.storeName : "Receipt"} · ${date}`.slice(0, 200), documentDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : isoDay(at) };
}

function isoDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A JPEG's pixel size from its frame header (SOF), or null.
export function jpegSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      const comps = bytes[i + 9];
      return width && height ? { width, height, comps } : null;
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

// One PDF with a page per JPEG (each embedded as is, DCTDecode; page size = the
// image's pixels in points). Throws if a page isn't a readable JPEG.
export function jpegsToPdf(jpegs) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => { const b = typeof chunk === "string" ? enc.encode(chunk) : chunk; parts.push(b); length += b.length; };
  const object = (n, body, stream = null) => {
    offsets[n] = length;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
    push("endobj\n");
  };
  push("%PDF-1.4\n");
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // the binary marker line
  const sizes = jpegs.map((j) => { const s = jpegSize(j); if (!s) throw new Error("outbox: a page isn't a JPEG"); return s; });
  const n = jpegs.length;
  // 1 catalog, 2 pages, then per page: page, image, content.
  const pageIds = sizes.map((_, i) => 3 + i * 3);
  object(1, "<< /Type /Catalog /Pages 2 0 R >>");
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${n} >>`);
  sizes.forEach((s, i) => {
    const page = pageIds[i], image = page + 1, content = page + 2;
    object(page, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${s.width} ${s.height}] /Resources << /XObject << /Im0 ${image} 0 R >> >> /Contents ${content} 0 R >>`);
    const space = s.comps === 1 ? "/DeviceGray" : s.comps === 4 ? "/DeviceCMYK" : "/DeviceRGB";
    object(image, `<< /Type /XObject /Subtype /Image /Width ${s.width} /Height ${s.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegs[i].length} >>`, jpegs[i]);
    const draw = enc.encode(`q ${s.width} 0 0 ${s.height} 0 0 cm /Im0 Do Q`);
    object(content, `<< /Length ${draw.length} >>`, draw);
  });
  const count = 3 + n * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let k = 1; k < count; k++) push(`${String(offsets[k]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// What one outbox entry becomes in Documents: one PDF when the pages came from the
// document camera as JPEGs (already upright), otherwise one document per page as it
// is (a photo's rotation tag is honoured when it's shown, not inside a PDF).
export function receiptDocuments(entry) {
  const pages = entry.pages || [];
  if (entry.camera && pages.length > 1 && pages.every((p) => p.type === "image/jpeg" && jpegSize(p.bytes))) {
    return [{ content: jpegsToPdf(pages.map((p) => p.bytes)), mime: "application/pdf", pages: pages.length, first: pages[0] }];
  }
  return pages.map((p) => ({ content: p.bytes, mime: p.type, pages: 1, first: p }));
}

// Files the receipts waiting for this household into its Receipts folder.
//   - one run at a time (lock: Web Locks in the app, so two tabs can't both file);
//   - each entry re-read before filing, and its document ids chosen and saved before
//     the first upload: a run after a crash skips what's already stored;
//   - one entry failing doesn't stop the rest; after OUTBOX_MAX_ATTEMPTS it's dropped;
//   - pages Documents can't keep are dropped (reported), never counted as filed.
// Returns { filed, failed, dropped }.
export async function fileReceipts({
  outbox, library, scope, folderId, receipts = () => [], makeThumb = async () => null,
  mimeOk = () => true, lock = (fn) => fn(), newId = () => crypto.randomUUID(),
}) {
  return lock(async () => {
    const out = { filed: 0, failed: 0, dropped: 0 };
    const used = new Set();
    for (const listed of await outbox.entries()) {
      if (listed.scope !== scope) continue; // scanned in another household: never filed here
      const entry = await outbox.get(listed.key);
      if (!entry) continue; // another run filed it
      const docs = receiptDocuments(entry);
      const keep = docs.filter((d) => mimeOk(d.mime));
      if (keep.length < docs.length) out.dropped += docs.length - keep.length;
      if (!keep.length) { await outbox.remove(entry.key); continue; }
      try {
        let ids = Array.isArray(entry.fileIds) && entry.fileIds.length === keep.length ? entry.fileIds : null;
        if (!ids) { ids = keep.map(() => newId()); await outbox.put(entry.key, { ...entry, fileIds: ids }); }
        const { name, documentDate, receiptId } = receiptLabel(entry.at, receipts(), used, entry.receiptId || "");
        // The file points at its receipt, so Document can show what was read from it.
        const source = receiptId ? { receiptId } : null;
        for (const [i, d] of keep.entries()) {
          if (await library.has(scope, ids[i])) continue; // stored before a crash
          const thumb = await makeThumb(d.first);
          await library.addFile(scope, {
            id: ids[i], content: d.content, thumb, folderId, source,
            meta: { name: keep.length > 1 ? `${name} (${i + 1})` : name, mime: d.mime, pages: d.pages, documentDate, tags: ["receipt"] },
          });
        }
        await outbox.remove(entry.key);
        out.filed++;
      } catch {
        const attempts = (entry.attempts || 0) + 1;
        if (attempts >= OUTBOX_MAX_ATTEMPTS) await outbox.remove(entry.key);
        else await outbox.put(entry.key, { ...(await outbox.get(entry.key) || entry), attempts });
        out.failed++;
      }
    }
    return out;
  });
}

// Personal receipts folder (Luke, 2026-11-12): a receipt marked Personal has its file
// moved from the household's Receipts into the owner's Personal › Receipts. Copy first
// (the copy's source.movedFrom names the household file, so a second run doesn't copy
// twice), then the household file is removed (library.dropMovedReceipt; the database
// checks it's the caller's own Personal receipt). One file failing doesn't stop the rest.
// personalIds: ids of this person's Personal receipts. Returns { moved, failed }.
export async function movePersonalReceiptFiles({ library, from, to, personalIds, lock = (fn) => fn() }) {
  const ids = new Set([...(personalIds || [])].map(String));
  if (!ids.size || !from || !to || from === to) return { moved: 0, failed: 0 };
  return lock(async () => {
    const out = { moved: 0, failed: 0 };
    const waiting = (await library.files(from)).filter((f) => f.source?.receiptId && ids.has(String(f.source.receiptId)));
    if (!waiting.length) return out;
    const folders = await library.ensureStartingFolders(to, { receipts: true, names: [] });
    const folderId = folders.find((f) => f.kind === "receipts")?.id || null;
    const copied = new Set((await library.files(to, { includeDeleted: true })).map((f) => f.source?.movedFrom).filter(Boolean));
    for (const f of waiting) {
      try {
        if (!copied.has(f.id)) {
          const { bytes, name, mime } = await library.open(from, f.id);
          let thumb = null;
          if ((f.parts || []).includes("thumb")) { try { thumb = await library.thumbnail(from, f.id); } catch { thumb = null; } }
          await library.addFile(to, {
            content: bytes, thumb, folderId, source: { receiptId: String(f.source.receiptId), movedFrom: f.id },
            meta: { name, mime, pages: f.pages, documentDate: f.documentDate, tags: f.tags },
          });
        }
        if (await library.dropMovedReceipt(from, f.id, f.parts)) out.moved++;
        else out.failed++;
      } catch { out.failed++; }
    }
    return out;
  });
}

// Shared order screenshots / PDFs (the share extension keeps them in the App Group;
// Luke, 2026-11-12): which receipt an entry belongs to. entry: { at, receipts: [{ id?,
// merchant, date, total }] } as share-receipt answered. → { receiptId } to file now
// ("" = file without a receipt), or null to wait for the receipt to reach this phone
// (Finance imports it from the inbox) — at most a day, then it's filed anyway.
export const SHARED_RECEIPT_WAIT_MS = 24 * 3600 * 1000;
export function sharedReceiptTarget(entry, receipts = [], nowMs = Date.now()) {
  const first = Array.isArray(entry?.receipts) ? entry.receipts[0] : null;
  if (!first) return { receiptId: "" };
  const list = Array.isArray(receipts) ? receipts : [];
  let found = null;
  if (first.id) found = list.find((r) => r?.id === `receipt-share-${first.id}`) || null;
  if (!found) {
    const total = Number(first.total);
    found = list.find((r) => r?.source === "share" && Number.isFinite(total) && Math.abs(Number(r.total) - total) < 0.01
      && (!first.date || r.purchaseDate === first.date)) || null;
  }
  if (found) return { receiptId: found.id };
  return nowMs - (Number(entry.at) || 0) > SHARED_RECEIPT_WAIT_MS ? { receiptId: "" } : null;
}
