// Everyday documents (DOCUMENTS_DESIGN.md §25; Luke, 2026-11-04): the part of the
// Document page outside the Safe. Kept like the rest of Live, protected by sign-in and
// row security (doc_pfolders / doc_pfiles), not encrypted on the device, so they open
// at once on any signed-in device with no Face ID and no device linking.
//
// createEverydayLibrary({ transport, storage, now?, newId? }) — transport is the
// messaging REST transport ({ select, insert, update, rpc }); storage is
// createDocumentsStorage({ …, tier: "everyday" }).
//
// Same calls as the Safe's library (documents/library.js) where they overlap, so the
// receipts outbox (documents/outbox.js fileReceipts) files into either.
//
// Egress: every read names its columns and is bounded to one scope; the list never
// carries body_text (search asks the database instead); nothing loops.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const RECENTLY_DELETED_DAYS = 30;
export const EVERYDAY_KINDS = Object.freeze(["file", "doc", "sheet", "slides"]);
// Starting folders (Luke, 2026-11-04): Household's everyday papers; Personal starts empty.
export const EVERYDAY_STARTING_FOLDERS = Object.freeze({
  household: Object.freeze(["Home", "Vehicles"]),
  personal: Object.freeze([]),
});

const FILE_COLS = "id,folder_id,kind,name,mime,doc_date,tags,page_count,parts,size,source,added_by,created_at,updated_at,deleted_at";
const enc = encodeURIComponent;

export class EverydayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function scopeId(v) {
  if (typeof v !== "string" || !SCOPE_RE.test(v)) throw new Error("everyday: bad scope");
  return v;
}
function uuid(v, what = "id") {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`everyday: bad ${what}`);
  return v.toLowerCase();
}
const cleanName = (v, max) => String(v ?? "").normalize("NFC").replace(/[\p{Cc}]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max);
const cleanTags = (tags) => [...new Set((tags || []).map((t) => cleanName(t, 40)).filter(Boolean))].slice(0, 20);
const isoDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

const toFile = (r) => ({
  id: r.id, folderId: r.folder_id || null, kind: r.kind || "file", name: r.name, mime: r.mime,
  documentDate: r.doc_date ? String(r.doc_date).slice(0, 10) : null, tags: Array.isArray(r.tags) ? r.tags : [], pages: r.page_count || 1,
  parts: r.parts || ["content"], size: Number(r.size) || 0, source: r.source || null,
  addedBy: r.added_by || null, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at || null,
});

export function createEverydayLibrary({ transport, storage, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  // ---- folders ---------------------------------------------------------------------------

  async function folders(scope) {
    const rows = await transport.select("doc_pfolders", `scope=eq.${enc(scopeId(scope))}&deleted_at=is.null&select=id,name,kind,sort&order=sort`);
    return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, sort: r.sort }))
      .sort((a, b) => (a.kind === "receipts" ? -1 : b.kind === "receipts" ? 1 : a.sort - b.sort || a.name.localeCompare(b.name)));
  }

  async function addFolder(scope, name, { kind = "user", sort = 0, id = newId() } = {}) {
    const n = cleanName(name, 120);
    if (!n) throw new EverydayError("NAME", "A folder needs a name.");
    await transport.insert("doc_pfolders", [{ id: uuid(id), scope: scopeId(scope), name: n, kind, sort }]);
    return id;
  }

  // Idempotent: names already there are skipped; at most one Receipts folder (the
  // database also refuses a second). Two devices racing both end with one of each name
  // per device at worst, never a second Receipts.
  async function ensureStartingFolders(scope, { receipts = false, names = [] } = {}) {
    const have = await folders(scope);
    let i = have.length;
    if (receipts && !have.some((f) => f.kind === "receipts")) {
      try { await addFolder(scope, "Receipts", { kind: "receipts", sort: 0 }); } catch { /* another device made it */ }
    }
    for (const name of names) {
      if (!have.some((f) => f.name.toLowerCase() === name.toLowerCase())) await addFolder(scope, name, { sort: ++i });
    }
    return folders(scope);
  }

  // The folder with this name, made if missing (moving out of the Safe).
  async function folderNamed(scope, name, { kind = "user" } = {}) {
    const have = await folders(scope);
    const found = kind === "receipts" ? have.find((f) => f.kind === "receipts") : have.find((f) => f.kind !== "receipts" && f.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    if (kind === "receipts") return (await ensureStartingFolders(scope, { receipts: true })).find((f) => f.kind === "receipts").id;
    return addFolder(scope, name, { sort: have.length + 1 });
  }

  const renameFolder = (scope, id, name) => {
    const n = cleanName(name, 120);
    if (!n) throw new EverydayError("NAME", "A folder needs a name.");
    return transport.update("doc_pfolders", `id=eq.${uuid(id)}&scope=eq.${enc(scopeId(scope))}`, { name: n });
  };

  async function deleteFolder(scope, id) {
    const f = (await folders(scope)).find((x) => x.id === id);
    if (!f) throw new EverydayError("MISSING", "That folder isn't here.");
    if (f.kind === "receipts") throw new EverydayError("RECEIPTS", "The Receipts folder can't be removed.");
    for (const file of (await files(scope)).filter((x) => x.folderId === id)) await trash(scope, file.id);
    await transport.update("doc_pfolders", `id=eq.${uuid(id)}&scope=eq.${enc(scopeId(scope))}`, { deleted_at: new Date(now()).toISOString() });
  }

  // ---- files -------------------------------------------------------------------------------

  async function files(scope, { includeDeleted = false } = {}) {
    const rows = await transport.select("doc_pfiles", `scope=eq.${enc(scopeId(scope))}${includeDeleted ? "" : "&deleted_at=is.null"}&select=${FILE_COLS}&order=created_at.desc&limit=2000`);
    return rows.map(toFile);
  }

  const row = async (scope, id) => (await transport.select("doc_pfiles", `scope=eq.${enc(scopeId(scope))}&id=eq.${uuid(id)}&select=${FILE_COLS}`))[0] || null;
  const has = async (scope, id) => Boolean(await row(scope, id));

  // content (bytes) is required; thumb optional; text is what was read from the pages
  // (kept for search). Blobs first, then the row, so a listed file always has its bytes.
  async function addFile(scope, { id = newId(), content, thumb = null, text = null, folderId = null, kind = "file", source = null, meta = {} }) {
    if (!(content instanceof Uint8Array)) throw new Error("everyday: content must be bytes");
    if (!EVERYDAY_KINDS.includes(kind)) throw new Error("everyday: bad kind");
    const name = cleanName(meta.name, 200) || "Document";
    const size = await storage.put(scope, uuid(id), thumb ? { content, thumb } : { content });
    await transport.insert("doc_pfiles", [{
      id: uuid(id), scope: scopeId(scope), folder_id: folderId ? uuid(folderId, "folder") : null, kind, name,
      mime: String(meta.mime || "application/octet-stream").slice(0, 120), doc_date: isoDate(meta.documentDate),
      tags: cleanTags(meta.tags), page_count: Math.max(1, Math.min(Number(meta.pages) || 1, 10000)),
      body_text: text ? String(text).slice(0, 100000) : null, parts: thumb ? ["content", "thumb"] : ["content"], size,
      source: source && typeof source === "object" ? source : null,
    }]);
    return id;
  }

  async function open(scope, id) {
    const r = await row(scope, id);
    if (!r) throw new EverydayError("MISSING", "That document isn't here any more.");
    return { bytes: await storage.get(scope, r.id, "content"), name: r.name, mime: r.mime };
  }

  const thumbnail = (scope, id) => storage.get(scope, uuid(id), "thumb");

  const patch = (scope, id, p) => transport.update("doc_pfiles", `id=eq.${uuid(id)}&scope=eq.${enc(scopeId(scope))}`, p);
  const rename = (scope, id, name) => { const n = cleanName(name, 200); if (!n) throw new EverydayError("NAME", "A document needs a name."); return patch(scope, id, { name: n }); };
  const move = (scope, id, folderId) => patch(scope, id, { folder_id: folderId ? uuid(folderId, "folder") : null });
  const setTags = (scope, id, tags) => patch(scope, id, { tags: cleanTags(tags) });
  const setDocumentDate = (scope, id, date) => patch(scope, id, { doc_date: isoDate(date) });
  const trash = (scope, id) => patch(scope, id, { deleted_at: new Date(now()).toISOString() });
  const restore = (scope, id) => patch(scope, id, { deleted_at: null });

  // Names, tags and the text read from the pages, searched by the database; at most 100.
  async function search(scope, query) {
    const q = String(query || "").replace(/[%_*(),.:"\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (q.length < 2) return [];
    const like = enc(`*${q}*`);
    const rows = await transport.select("doc_pfiles", `scope=eq.${enc(scopeId(scope))}&deleted_at=is.null&or=(name.ilike.${like},body_text.ilike.${like})&select=id&limit=100`);
    return rows.map((r) => r.id);
  }

  // After 30 days in Recently deleted: blobs first, then the row (the database and
  // the storage function both check the 30 days).
  async function purge(scope, id, r = null) {
    r = r && r.id === id ? r : await row(scope, id);
    if (!r || !r.deleted_at || Date.parse(r.deleted_at) > now() - RECENTLY_DELETED_DAYS * 24 * 3600 * 1000) return false;
    await storage.remove(scope, r.id, r.parts || ["content", "thumb"]);
    return Boolean(await transport.rpc("doc_ppurge_file", { p_id: uuid(id) }));
  }

  async function purgeExpired(scope) {
    const cutoff = new Date(now() - RECENTLY_DELETED_DAYS * 24 * 3600 * 1000).toISOString();
    const old = await transport.select("doc_pfiles", `scope=eq.${enc(scopeId(scope))}&deleted_at=lt.${enc(cutoff)}&select=id,parts,deleted_at&limit=50`);
    let n = 0;
    for (const r of old) { try { if (await purge(scope, r.id, r)) n++; } catch { /* next time */ } }
    return n;
  }

  // A receipt's household file once its copy is in the owner's Personal (personal
  // receipts folder, Luke 2026-11-12): the database checks the receipt is the caller's
  // own Personal one and the copy exists, removes the row, then the blobs go.
  async function dropMovedReceipt(scope, id, parts = ["content", "thumb"]) {
    const ok = Boolean(await transport.rpc("doc_pdrop_moved_receipt", { p_id: uuid(id) }));
    if (ok) { try { await storage.remove(scope, uuid(id), parts); } catch { /* row gone; blobs orphaned at worst */ } }
    return ok;
  }

  const usage = async (scope) => Number(await transport.rpc("doc_usage_all", { p_scope: scopeId(scope) })) || 0;

  return {
    folders, addFolder, ensureStartingFolders, folderNamed, renameFolder, deleteFolder,
    files, has, addFile, open, thumbnail, rename, move, setTags, setDocumentDate, trash, restore,
    search, purge, purgeExpired, usage, dropMovedReceipt,
  };
}
