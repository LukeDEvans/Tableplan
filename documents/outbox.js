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
// Entry: key "r:<at>:<rand>" → { at (ms), pages: [{ bytes, type }] }.

export const OUTBOX_DB = "live-documents-outbox";
export const OUTBOX_MAX = 100;
export const OUTBOX_MAX_BYTES = 80 * 1024 * 1024;
export const OUTBOX_MAX_AGE_DAYS = 60;
const MAX_PAGES = 10;

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
    // pages: [{ bytes: Uint8Array, type: "image/jpeg" | … }]
    async queue(pages) {
      const kept = (pages || []).filter((p) => p?.bytes instanceof Uint8Array && p.bytes.length && /^image\//.test(p.type || "")).slice(0, MAX_PAGES);
      if (!kept.length) return null;
      const at = now();
      const key = `r:${String(at).padStart(15, "0")}:${Math.random().toString(36).slice(2, 10)}`;
      await store.set(key, { at, pages: kept.map((p) => ({ bytes: p.bytes, type: p.type })) });
      await prune();
      return key;
    },
    entries,
    remove: (key) => store.remove(key),
    prune,
  };
}

// The name for a filed receipt: "<store> · <date>" from the receipt the app read
// from the same scan (a scan receipt created within a few minutes of it), else
// "Receipt · <date>". receipts: [{ storeName, purchaseDate, createdAt, source }].
export function receiptLabel(at, receipts = []) {
  const near = (receipts || [])
    .filter((r) => (r?.source || "scan") === "scan" && r?.storeName && r?.createdAt)
    .map((r) => ({ r, gap: Date.parse(r.createdAt) - at }))
    .filter((x) => Number.isFinite(x.gap) && x.gap >= -2 * 60 * 1000 && x.gap <= 30 * 60 * 1000)
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0]?.r;
  const date = near?.purchaseDate || isoDay(at);
  return { name: `${near ? near.storeName : "Receipt"} · ${date}`.slice(0, 200), documentDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : isoDay(at) };
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

// What one outbox entry becomes in Documents: a PDF when every page is a JPEG
// (several pages in one document), otherwise one document per page as it is.
export function receiptDocuments(entry) {
  const pages = entry.pages || [];
  if (pages.length > 1 && pages.every((p) => p.type === "image/jpeg" && jpegSize(p.bytes))) {
    return [{ content: jpegsToPdf(pages.map((p) => p.bytes)), mime: "application/pdf", pages: pages.length, first: pages[0] }];
  }
  return pages.map((p) => ({ content: p.bytes, mime: p.type, pages: 1, first: p }));
}

// Files every waiting receipt into the Receipts folder of the Household vault.
// Each entry is removed only after its documents are stored, so a failure leaves
// it for the next open. Returns the number of receipts filed.
export async function fileReceipts({ outbox, library, scope, folderId, receipts = () => [], makeThumb = async () => null, mimeOk = () => true }) {
  let filed = 0;
  for (const entry of await outbox.entries()) {
    const { name, documentDate } = receiptLabel(entry.at, receipts());
    const docs = receiptDocuments(entry).filter((d) => mimeOk(d.mime));
    for (const [i, d] of docs.entries()) {
      const thumb = await makeThumb(d.first);
      await library.addFile(scope, {
        content: d.content, thumb, folderId,
        meta: { name: docs.length > 1 ? `${name} (${i + 1})` : name, mime: d.mime, pages: d.pages, documentDate, tags: ["receipt"] },
      });
    }
    await outbox.remove(entry.key);
    filed++;
  }
  return filed;
}
