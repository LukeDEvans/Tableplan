// The Documents library (DOCUMENTS_DESIGN.md §9, §10): folders and files of one scope,
// on top of the vault keys (vaults.js), the blob store (storage.js) and the server
// (server.js). No UI here — the Documents pages call this.
//
// Rules from the reviews that live here:
//   - rows below the vault's SETTLED version are never shown (rowVersionAllowed);
//   - metadata carries `rev` and `folderId`: this device keeps the highest rev it has
//     seen per file and refuses an older copy (it shows its cached copy instead),
//     and a row whose folder_id disagrees with the metadata is shown where the
//     metadata says (the encrypted value is the authority);
//   - nothing is decrypted until it's asked for (lists use the small metadata only).
//
// Store (its own keystore): rev:<fileId> → highest rev seen; meta:<fileId> → last good metadata.

import { toB64, fromB64 } from "../messaging/crypto/bytes.js";
import {
  generateFileKey, wrapFileKey, unwrapFileKey, encryptFolderName, decryptFolderName,
  encryptBlob, decryptBlob, encryptMeta, decryptMeta, encryptText, decryptText, parseMeta, rowVersionAllowed,
} from "./crypto/index.js";

export class LibraryError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const RECENTLY_DELETED_DAYS = 30;

export function createDocumentsLibrary({ server, storage, vaults, store, userId, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const ctxFile = (k, fileId, keyVersion) => ({ vaultId: k.vaultId, scope: k.scope, fileId, keyVersion });
  const ctxFolder = (k, folderId, keyVersion) => ({ vaultId: k.vaultId, scope: k.scope, folderId, keyVersion });

  async function keys(scope) { return vaults.keysFor(scope); }

  // Rows from the last listing, so opening a file or a thumbnail doesn't read the
  // table again (egress: never a read per file per row).
  const listed = new Map(); // fileId → { scope, row }

  // ---- folders ------------------------------------------------------------------------

  async function folders(scope) {
    const k = await keys(scope);
    const out = [];
    for (const r of await server.folders(scope)) {
      if (r.deleted_at || !rowVersionAllowed(r.key_version, k.settled)) continue;
      const key = k.keys.get(r.key_version);
      if (!key) continue;
      try {
        out.push({ id: r.id, name: decryptFolderName(key, fromB64(r.enc_name), ctxFolder(k, r.id, r.key_version)), kind: r.kind, sort: r.sort });
      } catch { /* a row that doesn't open is not shown */ }
    }
    return out.sort((a, b) => (a.kind === "receipts" ? -1 : b.kind === "receipts" ? 1 : a.sort - b.sort || a.name.localeCompare(b.name)));
  }

  async function addFolder(scope, name, { kind = "user", sort = 0 } = {}) {
    const k = await keys(scope);
    const id = newId();
    await server.addFolder({ id, scope, enc_name: toB64(encryptFolderName(k.key, name, ctxFolder(k, id, k.version))), key_version: k.version, kind, sort });
    return id;
  }

  // Starting folders (decision 7). Idempotent: names already present are skipped, and a
  // scope has at most one Receipts folder.
  async function ensureStartingFolders(scope, { receipts = false, names = [] } = {}) {
    const have = await folders(scope);
    let i = have.length;
    if (receipts && !have.some((f) => f.kind === "receipts")) await addFolder(scope, "Receipts", { kind: "receipts", sort: 0 });
    for (const name of names) {
      if (!have.some((f) => f.name.toLowerCase() === name.toLowerCase())) await addFolder(scope, name, { sort: ++i });
    }
    return folders(scope);
  }

  async function renameFolder(scope, id, name) {
    const k = await keys(scope);
    await server.updateFolder(id, { enc_name: toB64(encryptFolderName(k.key, name, ctxFolder(k, id, k.version))), key_version: k.version });
  }

  // A deleted folder's files go to Recently deleted with it.
  async function deleteFolder(scope, id) {
    const f = (await folders(scope)).find((x) => x.id === id);
    if (!f) throw new LibraryError("MISSING", "That folder isn't here.");
    if (f.kind === "receipts") throw new LibraryError("RECEIPTS", "The Receipts folder can't be removed.");
    for (const file of (await files(scope)).filter((x) => x.folderId === id)) await trash(scope, file.id);
    await server.updateFolder(id, { deleted_at: new Date(now()).toISOString() });
  }

  // ---- files: listing -------------------------------------------------------------------

  async function readMeta(k, r) {
    const key = k.keys.get(r.key_version);
    if (!key) return null;
    const fileKey = unwrapFileKey(key, fromB64(r.wrapped_key), ctxFile(k, r.id, r.key_version));
    let meta = decryptMeta(fileKey, r.id, fromB64(r.enc_meta));
    const seen = (await store.get(`rev:${r.id}`)) || 0;
    if (meta.rev < seen) {
      const cached = await store.get(`meta:${r.id}`);
      meta = cached ? parseMeta(cached) : meta;
      meta = { ...meta, stale: true };
    } else if (meta.rev > seen) {
      await store.set(`rev:${r.id}`, meta.rev);
      await store.set(`meta:${r.id}`, meta);
    }
    return meta;
  }

  // Every file of the scope this device may show, newest first, including Recently
  // deleted ones (deletedAt set) for that view.
  async function files(scope, { includeDeleted = false } = {}) {
    const k = await keys(scope);
    const out = [];
    const rows = await server.files(scope);
    for (const [id, v] of listed) if (v.scope === scope) listed.delete(id);
    for (const r of rows) listed.set(r.id, { scope, row: r });
    for (const r of rows) {
      if (!rowVersionAllowed(r.key_version, k.settled)) continue;
      if (r.deleted_at && !includeDeleted) continue;
      let meta;
      try { meta = await readMeta(k, r); } catch { continue; }
      if (!meta) continue;
      out.push({
        id: r.id, folderId: meta.folderId, folderMismatch: (r.folder_id || null) !== meta.folderId,
        name: meta.name, mime: meta.mime, pages: meta.pages, size: meta.size, tags: meta.tags,
        documentDate: meta.documentDate, rev: meta.rev, stale: Boolean(meta.stale),
        parts: r.parts, addedBy: r.added_by, createdAt: r.created_at, deletedAt: r.deleted_at,
      });
    }
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  // ---- files: adding ----------------------------------------------------------------------

  // content: bytes of the file (a scanned PDF or the original upload); meta: { name,
  // mime, pages, documentDate, tags, originalName }; thumb: small JPEG bytes; text:
  // what was read from the pages, for search.
  async function addFile(scope, { content, meta, thumb = null, text = "", folderId = null }) {
    const k = await keys(scope);
    if (folderId && !(await folders(scope)).some((f) => f.id === folderId)) throw new LibraryError("MISSING", "That folder isn't here.");
    const id = newId();
    const fileKey = generateFileKey();
    const full = parseMeta({ v: 1, rev: 1, folderId, size: content.length, ...meta });
    const parts = { content: encryptBlob(fileKey, id, "content", content) };
    if (thumb) parts.thumb = encryptBlob(fileKey, id, "thumb", thumb);
    if (text) parts.text = encryptText(fileKey, id, text);
    const stored = await storage.put(scope, id, parts);
    const encMeta = encryptMeta(fileKey, id, full);
    await server.addFile({
      id, scope, folder_id: folderId, wrapped_key: toB64(wrapFileKey(k.key, fileKey, ctxFile(k, id, k.version))),
      key_version: k.version, enc_meta: toB64(encMeta), parts: Object.keys(parts), size: stored + encMeta.length,
    });
    await store.set(`rev:${id}`, 1);
    await store.set(`meta:${id}`, full);
    return id;
  }

  // ---- files: opening -------------------------------------------------------------------

  // fresh: read the row now (edits need its latest metadata); otherwise the listed row
  // is used, falling back to a fresh read if it no longer opens (re-wrapped meanwhile).
  async function rowFor(scope, fileId, { fresh = false } = {}) {
    const cached = listed.get(fileId);
    if (!fresh && cached && cached.scope === scope) {
      try { return unwrapRow(scope, cached.row, await keys(scope)); } catch { /* re-read below */ }
    }
    const r = await server.file(scope, fileId);
    if (!r) throw new LibraryError("MISSING", "That document isn't here.");
    listed.set(r.id, { scope, row: r });
    return unwrapRow(scope, r, await keys(scope));
  }

  function unwrapRow(scope, r, k) {
    if (!rowVersionAllowed(r.key_version, k.settled)) throw new LibraryError("MISSING", "That document isn't here.");
    const key = k.keys.get(r.key_version);
    if (!key) throw new LibraryError("LOCKED", "This device can't open that document yet.");
    return { r, k, fileKey: unwrapFileKey(key, fromB64(r.wrapped_key), ctxFile(k, r.id, r.key_version)) };
  }

  async function open(scope, fileId) {
    const { r, k, fileKey } = await rowFor(scope, fileId);
    const meta = await readMeta(k, r);
    const bytes = decryptBlob(fileKey, fileId, "content", await storage.get(scope, fileId, "content"));
    return { bytes, name: meta.name, mime: meta.mime };
  }

  async function thumbnail(scope, fileId) {
    const { r, fileKey } = await rowFor(scope, fileId);
    if (!r.parts.includes("thumb")) return null;
    return decryptBlob(fileKey, fileId, "thumb", await storage.get(scope, fileId, "thumb"), { maxPlaintext: 512 * 1024 });
  }

  async function searchText(scope, fileId) {
    const { r, fileKey } = await rowFor(scope, fileId);
    if (!r.parts.includes("text")) return "";
    return decryptText(fileKey, fileId, await storage.get(scope, fileId, "text"));
  }

  // ---- files: changing --------------------------------------------------------------------

  async function editMeta(scope, fileId, change) {
    const { r, k, fileKey } = await rowFor(scope, fileId, { fresh: true });
    const current = await readMeta(k, r);
    if (current.stale) throw new LibraryError("STALE", "This document changed elsewhere; refresh and try again.");
    const { stale, ...base } = current;
    const next = parseMeta({ ...base, ...change, v: 1, rev: base.rev + 1 });
    const patch = { enc_meta: toB64(encryptMeta(fileKey, fileId, next)) };
    if ("folderId" in change) patch.folder_id = next.folderId;
    await server.updateFile(fileId, patch);
    await store.set(`rev:${fileId}`, next.rev);
    await store.set(`meta:${fileId}`, next);
    return next;
  }

  const rename = (scope, fileId, name) => editMeta(scope, fileId, { name });
  const setTags = (scope, fileId, tags) => editMeta(scope, fileId, { tags });
  const setDocumentDate = (scope, fileId, documentDate) => editMeta(scope, fileId, { documentDate });

  async function move(scope, fileId, folderId) {
    if (folderId && !(await folders(scope)).some((f) => f.id === folderId)) throw new LibraryError("MISSING", "That folder isn't here.");
    return editMeta(scope, fileId, { folderId });
  }

  async function trash(scope, fileId) { await server.updateFile(fileId, { deleted_at: new Date(now()).toISOString() }); }
  async function restore(scope, fileId) { await server.updateFile(fileId, { deleted_at: null }); }

  // Gone for good, after 30 days in Recently deleted (the storage function and the
  // database both check): blobs first, so nothing is left unreferenced, then the row.
  async function purge(scope, fileId, row = null) {
    const r = row && row.id === fileId ? row : await server.file(scope, fileId);
    if (!r || !r.deleted_at || Date.parse(r.deleted_at) > now() - RECENTLY_DELETED_DAYS * 24 * 3600 * 1000) return false;
    await storage.remove(scope, fileId, r.parts);
    await server.purgeFile(fileId);
    await store.remove(`rev:${fileId}`);
    await store.remove(`meta:${fileId}`);
    return true;
  }

  // Recently deleted older than 30 days. Called when the page opens; bounded by the scope.
  async function purgeExpired(scope) {
    const cutoff = now() - RECENTLY_DELETED_DAYS * 24 * 3600 * 1000;
    const old = (await server.files(scope)).filter((r) => r.deleted_at && Date.parse(r.deleted_at) < cutoff);
    for (const r of old) await purge(scope, r.id, r);
    return old.length;
  }

  async function usage(scope) { return Number(await server.usage(scope)) || 0; }

  return {
    folders, addFolder, ensureStartingFolders, renameFolder, deleteFolder,
    files, addFile, open, thumbnail, searchText,
    rename, setTags, setDocumentDate, move, trash, restore, purge, purgeExpired, usage,
  };
}
