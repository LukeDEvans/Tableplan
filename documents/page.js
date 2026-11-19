// The Document page (DOCUMENTS_DESIGN.md §25; Luke, 2026-11-04). Household's and
// Personal's everyday documents, kept like the rest of Live (documents/everyday.js):
// they open at once on any signed-in device, with no Face ID and no linking. The
// Safe, the end-to-end encrypted part with Face ID on every open (documents/ui.js),
// is an entry in the sidebar; it's loaded only when opened, and leaving it locks it.
//
// mountDocumentPage(root, deps) → { show(scope, { kind, title }), hide(), destroy() }
// deps: as documents/ui.js's (the Safe gets them as they are, plus `everyday`, this
//   page's library, for moving folders out), and fileReceipts(scope) → files the
//   receipts waiting in this device's outbox into this household's Receipts.
//
// Later (Luke, 2026-11-04): a word processor, spreadsheets and slides live here too;
// each file row has a kind ("file" now; "doc", "sheet", "slides" to come).
//
// Rules: everything a person typed and every name is escaped; a document opens with
// its stored type from the fixed list (no HTML, SVG or XML) as an <img>, a PDF frame
// or plain text; nothing polls (reads on show, on "Check again" and after edits).

import { createEverydayLibrary, EVERYDAY_STARTING_FOLDERS, RECENTLY_DELETED_DAYS } from "./everyday.js";
import { createDocumentsStorage, edgePresigner } from "./storage.js";
import { createRestTransport } from "../messaging/server.js";
import {
  esc, EXT_MIME, MIME_TYPES, mimeForFile, displayName, pdfPageCount, sizeLabel, dateLabel, ICON, glyphFor, makeThumb,
  MAX_FILE_BYTES, SCAN_TEXT_MAX,
} from "./common.js";

export const USAGE_WARN_BYTES = 7 * 1024 ** 3; // the 7 GB note (of R2's 10 GB free)
const QUICKLOOK_PLAIN_MAX = 20_000_000; // AttachmentPreviewPlugin's cap without sensitive
const THUMB_PARALLEL = 3;
const SEARCH_DELAY_MS = 300;

const DOC_MIME = "application/vnd.live.doc";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const LOCK_ICON = '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

export async function mountDocumentPage(root, deps) {
  const userId = deps.userId;
  const storage = createDocumentsStorage({ presign: edgePresigner({ functionsUrl: deps.functionsUrl(), getToken: deps.getToken }), tier: "everyday" });
  const transport = createRestTransport({ baseUrl: deps.baseUrl, headers: deps.headers });
  const library = createEverydayLibrary({ transport, storage });
  // The word processor (WORD_PROCESSOR_DESIGN.md): loaded the first time a document is made or opened.
  const host = () => import("./editor/host.js");
  const myName = () => deps.myDisplayName?.() || household()?.members.find((m) => m.user_id === userId)?.display_name || "Me";
  const people = () => (household()?.members || []).map((m) => ({ id: m.user_id, name: m.display_name || "Someone" }));
  let openDoc = null; // the editor while a document is open
  const household = () => deps.household?.() || null;
  const nameOf = (uid) => (uid === userId ? "You" : household()?.members.find((m) => m.user_id === uid)?.display_name || "Someone");
  const scanner = deps.nativeDocumentScanner?.() || null;
  // Two boxes that stay: everyday documents, and the Safe (kept mounted between visits,
  // locked whenever it's left).
  root.innerHTML = `<div class="docs-everyday" data-everyday></div>
    <div class="docs-safe-wrap" data-safe-wrap hidden>
      <div class="docs-safe-bar"><button type="button" class="link-btn" data-act="leave-safe">‹ Documents</button><span class="docs-safe-name" data-safe-name></span></div>
      <div class="docs-safe-root" data-safe-root></div></div>`;
  const view = root.querySelector("[data-everyday]");
  const safeWrap = root.querySelector("[data-safe-wrap]");
  const safeBox = () => root.querySelector("[data-safe-root]");
  const quickLook = deps.nativeAttachmentPreview?.() || null;

  const ui = {
    scope: null, kind: "household", title: "Document", view: "loading", error: "", busy: "",
    folder: "all", query: "", hits: null, folders: [], files: [], banners: [], viewer: null, usage: 0,
  };
  let visible = false;
  let gen = 0;
  const thumbs = new Map(); // fileId → object URL, or null while loading
  let viewerUrl = null;

  // ---- the Safe: a separate module, mounted in its own box when opened ----------------
  let safe = null;
  let safeLoading = null;
  let inSafe = false;
  async function openSafe() {
    const scope = ui.scope;
    const kind = ui.kind;
    inSafe = true;
    closeViewer();
    gen++;
    view.hidden = true;
    view.innerHTML = "";
    safeWrap.hidden = false;
    root.querySelector("[data-safe-name]").innerHTML = `${LOCK_ICON}${esc(kind === "personal" ? "Personal Safe" : "Household Safe")}`;
    try {
      if (!safe) {
        safeLoading ||= import("./ui.js").then((m) => m.mountDocuments(safeBox(), { ...deps, everyday: library }));
        safe = await safeLoading;
      }
      if (!inSafe) return;
      await safe.show(scope, { kind, title: kind === "personal" ? "Personal Safe" : "Household Safe" });
    } catch (e) {
      safeLoading = null;
      const box = safeBox();
      if (box) box.innerHTML = `<div class="msg-pane"><p class="msg-error">The Safe couldn't open: ${esc(e?.message || String(e))}</p></div>`;
    }
  }
  function leaveSafe({ redraw = true } = {}) {
    if (!inSafe) return;
    inSafe = false;
    safe?.hide(); // locks it: the next visit asks for Face ID again
    safeWrap.hidden = true;
    view.hidden = false;
    if (redraw) { draw(); load(); }
  }

  // ---- loading ------------------------------------------------------------------------------

  async function load() {
    const my = ++gen;
    const scope = ui.scope;
    try {
      await refresh(my, scope);
    } catch (e) {
      if (my !== gen) return;
      ui.view = "error"; ui.error = e?.message || "Something went wrong."; return draw();
    }
    if (my !== gen) return;
    ui.view = "library";
    draw();
    library.purgeExpired(scope).catch(() => {});
    if (ui.kind === "household") await fileWaitingReceipts(my, scope);
    if (ui.kind === "personal") deps.movePersonalReceipts?.(); // reloads this page if anything moved
    if (my !== gen) return;
    await nameReceiptFiles(my, scope).catch(() => {});
    if (my !== gen) return;
    await checkBanners(my, scope);
    if (my === gen) draw();
  }

  async function refresh(my = gen, scope = ui.scope) {
    let [folders, files] = await Promise.all([library.folders(scope), library.files(scope, { includeDeleted: true })]);
    if (my !== gen || scope !== ui.scope) return;
    // Household's Receipts, and Personal's for receipts marked Personal (Luke, 2026-11-12).
    const wantReceipts = ui.kind === "household" || ui.kind === "personal";
    if (!folders.length || (wantReceipts && !folders.some((f) => f.kind === "receipts"))) {
      folders = await library.ensureStartingFolders(scope, { receipts: wantReceipts, names: folders.length ? [] : EVERYDAY_STARTING_FOLDERS[ui.kind] || [] });
      if (my !== gen || scope !== ui.scope) return;
    }
    ui.folders = folders;
    ui.files = files;
    if (ui.folder !== "all" && ui.folder !== "trash" && !ui.folders.some((f) => f.id === ui.folder)) ui.folder = "all";
  }

  // Receipts scanned in Shop wait in this device's outbox (documents/outbox.js) and are
  // filed here, into Receipts: right after the scan (app.js) and again on each open.
  let filing = null;
  async function fileWaitingReceipts(my, scope) {
    const folder = ui.folders.find((f) => f.kind === "receipts");
    if (!deps.fileReceipts || !folder) return;
    filing ||= deps.fileReceipts(scope).finally(() => { filing = null; });
    try {
      const out = await filing;
      if (out?.filed && my === gen && scope === ui.scope) await refresh(my, scope);
    } catch { /* what didn't file stays in the outbox */ }
  }

  async function checkBanners(my, scope) {
    const b = [];
    try {
      ui.usage = await library.usage(scope);
      if (ui.usage >= USAGE_WARN_BYTES) b.push({ warn: true, html: `Document is using ${esc(sizeLabel(ui.usage))} of the 10 GB that's free.` });
    } catch { /* best-effort */ }
    if (my === gen) ui.banners = b;
  }

  // ---- drawing ---------------------------------------------------------------------------------

  function draw() {
    if (!visible || inSafe) return;
    view.innerHTML = ui.view === "library" ? libraryView() : ui.view === "error" ? errorView() : `<div class="msg-pane docs-pane"><p class="msg-muted">Opening ${esc(ui.title)}…</p></div>`;
    if (ui.view === "library") loadThumbs();
    const pre = view.querySelector(".docs-view-text");
    if (pre && ui.viewer?.text != null) pre.textContent = ui.viewer.text; // text, never markup
  }

  const busyNote = () => (ui.busy ? `<p class="msg-muted" role="status">${esc(ui.busy)}</p>` : "");
  const errorNote = () => (ui.error ? `<p class="msg-error" role="alert">${esc(ui.error)}</p>` : "");

  function errorView() {
    return `<div class="msg-pane docs-pane"><div class="msg-intro"><h2 class="msg-title">${esc(ui.title)}</h2>
      <p class="msg-error">${esc(ui.error || "Something went wrong.")}</p>
      <button type="button" class="secondary-btn" data-act="reload">Try again</button></div></div>`;
  }

  function visibleFiles() {
    const q = ui.query.trim().toLowerCase();
    const hits = ui.hits && q.length >= 2 ? new Set(ui.hits) : null;
    return ui.files.filter((f) => {
      if (ui.folder === "trash") { if (!f.deletedAt) return false; } else if (f.deletedAt) return false;
      if (ui.folder !== "all" && ui.folder !== "trash" && f.folderId !== ui.folder) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.tags.some((t) => t.toLowerCase().includes(q)) || Boolean(hits?.has(f.id));
    });
  }

  function sidebar() {
    const tab = (key, icon, label) => `<button class="article-sidebar-tab${ui.folder === key ? " is-active" : ""}" type="button" data-folder="${esc(key)}"${ui.folder === key ? ' aria-current="true"' : ""}>${icon}<span>${esc(label)}</span></button>`;
    return `<nav class="article-sidebar docs-sidebar" id="docsSidebar" aria-label="${esc(ui.title)} folders">
      ${tab("all", ICON.all, "All documents")}
      ${ui.folders.map((f) => tab(f.id, f.kind === "receipts" ? ICON.receipt : ICON.folder, f.name)).join("")}
      <button class="article-sidebar-tab" type="button" data-act="new-folder">${ICON.plus}<span>New folder</span></button>
      <div class="article-sidebar-divider"></div>
      <button class="article-sidebar-tab docs-safe-tab" type="button" data-act="open-safe">${LOCK_ICON}<span>Safe</span></button>
      <div class="watch-sidebar-spacer"></div>
      <div class="article-sidebar-divider"></div>
      ${tab("trash", ICON.trash, "Recently deleted")}
    </nav>`;
  }

  // A receipt's file points at its receipt (source.receiptId, set when it's filed).
  // The app answers what was read from it and whether a charge matches it.
  const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
  function receiptOf(f) {
    const id = f?.source?.receiptId;
    if (!id || !deps.receiptInfo) return null;
    try { return deps.receiptInfo(id) || null; } catch { return null; }
  }
  const receiptChip = (r) => (r?.statusLabel && r.known ? `<span class="docs-chip is-${esc(r.status)}">${esc(r.statusLabel)}</span>` : "");

  // A receipt filed before its read came back is named "Receipt · <date>". Once the
  // store is known, give it its real name and date. A few per visit, best-effort.
  async function nameReceiptFiles(my, scope) {
    const stale = ui.files.filter((f) => !f.deletedAt && /^Receipt · /.test(f.name) && receiptOf(f)?.store).slice(0, 5);
    for (const f of stale) {
      const r = receiptOf(f);
      const name = `${r.store} · ${r.date || f.documentDate || ""}`.replace(/ · $/, "").slice(0, 200);
      try {
        await library.rename(scope, f.id, name);
        if (/^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.date !== f.documentDate) await library.setDocumentDate(scope, f.id, r.date);
      } catch { return; }
      if (my !== gen || scope !== ui.scope) return;
    }
    if (stale.length) await refresh(my, scope);
  }

  function fileRow(f) {
    const receipt = receiptOf(f);
    const meta = receipt
      ? [dateLabel(receipt.date || f.documentDate || f.createdAt), receipt.total ? money(receipt.total) : "", receipt.items.length ? `${receipt.items.length} item${receipt.items.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")
      : [dateLabel(f.documentDate || f.createdAt), f.pages > 1 ? `${f.pages} pages` : "", sizeLabel(f.size)].filter(Boolean).join(" · ");
    const folder = ui.folder === "all" ? ui.folders.find((x) => x.id === f.folderId)?.name : "";
    const who = ui.kind === "household" && f.addedBy && f.addedBy !== userId ? ` · added by ${esc(nameOf(f.addedBy))}` : "";
    return `<li><button type="button" class="docs-file" data-open="${esc(f.id)}">
      <span class="docs-thumb${f.kind === "doc" ? " is-doc" : ""}" data-thumb="${esc(f.id)}" aria-hidden="true">${f.kind === "doc" ? "Aa" : esc(glyphFor(f.mime))}</span>
      <span class="docs-file-text"><span class="docs-file-name">${esc(f.name)}</span>
      <span class="docs-file-meta">${esc(meta)}${folder ? ` · ${esc(folder)}` : ""}${who}</span></span>${receiptChip(receipt)}</button></li>`;
  }

  function libraryView() {
    const list = visibleFiles();
    const folder = ui.folders.find((f) => f.id === ui.folder);
    const heading = ui.folder === "all" ? "All documents" : ui.folder === "trash" ? "Recently deleted" : folder?.name || "";
    const empty = ui.query ? "Nothing matches that search." : ui.folder === "trash" ? `Deleted documents stay here for ${RECENTLY_DELETED_DAYS} days.` : deps.isNative ? "No documents here yet. Tap + to add one." : "No documents here yet. Drop files here, or use +.";
    const folderTools = folder ? `<div class="msg-row docs-folder-tools">
        <button type="button" class="link-btn" data-act="rename-folder">Rename folder</button>
        ${folder.kind === "receipts" ? "" : `<button type="button" class="link-btn" data-act="delete-folder">Remove folder</button>`}</div>` : "";
    return `<div class="article-layout watch-layout docs-layout">
      ${sidebar()}
      <div class="podcast-panel watch-page-panel docs-panel" data-drop>
        <div class="discover-head">
          <button class="icon-btn mail-sidebar-toggle" type="button" data-act="toggle-sidebar" title="Folders" aria-label="Show folders" aria-controls="docsSidebar">${ICON.menu}</button>
          <input type="search" class="discover-search-input" data-search placeholder="Search ${esc(ui.title)}…" aria-label="Search documents" autocomplete="off" value="${esc(ui.query)}" />
          ${scanner ? `<button class="icon-btn" type="button" data-act="scan" title="Scan a document" aria-label="Scan a document">${ICON.scan}</button>` : ""}
          <button class="icon-btn" type="button" data-act="add" title="New document or file" aria-label="New document or file" aria-haspopup="menu">${ICON.add}</button>
          <input type="file" data-file-input multiple hidden accept="${esc(MIME_TYPES.join(","))},.heic,.heif" />
        </div>
        ${ui.banners.map((b) => `<p class="msg-banner${b.warn ? " msg-banner-warn" : ""}">${b.html}</p>`).join("")}
        <div class="docs-list-head"><h2 class="docs-heading">${esc(heading)}</h2>${folderTools}</div>
        ${busyNote()}${errorNote()}
        ${list.length ? `<ul class="docs-list">${list.map(fileRow).join("")}</ul>` : `<p class="msg-muted docs-empty">${esc(empty)}</p>`}
      </div>
      ${ui.viewer ? viewerView() : ""}
    </div>`;
  }

  function viewerView() {
    const v = ui.viewer;
    const f = ui.files.find((x) => x.id === v.id);
    if (!f) return "";
    let body = `<p class="msg-muted">Opening…</p>`;
    if (v.error) body = `<p class="msg-error">${esc(v.error)}</p>`;
    else if (v.url && f.mime.startsWith("image/")) body = `<img class="docs-view-img" src="${esc(v.url)}" alt="${esc(f.name)}">`;
    else if (v.url && f.mime === "application/pdf") body = `<iframe class="docs-view-pdf" src="${esc(v.url)}" title="${esc(f.name)}"></iframe>`;
    else if (v.text != null) body = `<pre class="docs-view-text"></pre>`;
    else if (v.ready) body = quickLook ? `<p class="msg-muted">Tap Open to view it.</p>` : `<p class="msg-muted">This kind of file can't be shown here. Use Share to open it in another app.</p>`;
    const inTrash = Boolean(f.deletedAt);
    const receipt = receiptOf(f);
    const receiptPanel = receipt ? `
      <section class="docs-receipt" aria-label="What was read from this receipt">
        <div class="docs-receipt-head"><strong>${esc(receipt.store || "Receipt")}</strong><span>${esc(dateLabel(receipt.date))}</span><span class="docs-receipt-total">${esc(money(receipt.total))}</span>${receiptChip(receipt)}</div>
        ${receipt.items.length ? `<ul class="docs-receipt-lines">${receipt.items.map((i) => `<li><span class="docs-receipt-item">${esc(i.name)}</span><span class="docs-receipt-cat">${esc(i.category)}</span><span class="docs-receipt-price">${esc(money(i.price))}</span></li>`).join("")}</ul>` : ""}
        ${receipt.tip ? `<p class="msg-muted">Tip ${esc(money(receipt.tip))}</p>` : ""}
        ${receipt.txn ? `<p class="msg-muted">Charged ${esc(money(-receipt.txn.amount))}${receipt.txn.account ? ` to ${esc(receipt.txn.account)}` : ""} · ${esc(dateLabel(receipt.txn.posted))}</p>` : ""}
        ${deps.openReceipt ? `<button type="button" class="secondary-btn" data-act="open-receipt" data-receipt="${esc(receipt.id)}">Edit receipt</button>` : ""}
      </section>` : "";
    const folderOptions = ui.folders.map((x) => `<option value="${esc(x.id)}"${x.id === f.folderId ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    return `<div class="docs-viewer" role="dialog" aria-modal="true" aria-label="${esc(f.name)}">
      <div class="docs-viewer-head">
        <button type="button" class="msg-icon-btn" data-act="close-viewer" aria-label="Close">‹</button>
        <h3 class="msg-title">${esc(f.name)}</h3>
        ${v.ready && quickLook && v.bytes?.length <= QUICKLOOK_PLAIN_MAX ? `<button type="button" class="secondary-btn" data-act="quicklook">Open</button>` : ""}
        ${v.ready && !inTrash ? `<button type="button" class="secondary-btn" data-act="share">Share</button>` : ""}
        ${v.ready && !inTrash && f.mime === DOCX_MIME ? `<button type="button" class="primary-btn" data-act="docx-to-doc">Edit as a document</button>` : ""}
      </div>
      <div class="docs-viewer-body">${body}</div>
      ${receiptPanel}
      <div class="docs-viewer-foot">
        ${inTrash
          ? `<button type="button" class="primary-btn" data-act="restore-file">Put back</button>`
          : `<form class="msg-form docs-edit" data-form="edit">
              <label class="msg-field">Name<input name="name" value="${esc(f.name)}" maxlength="200" required></label>
              <label class="msg-field">Folder<select name="folder"><option value="">No folder</option>${folderOptions}</select></label>
              <label class="msg-field">Date on the document<input type="date" name="date" value="${esc(f.documentDate || "")}"></label>
              <label class="msg-field">Tags<input name="tags" value="${esc(f.tags.join(", "))}" placeholder="Separate with commas"></label>
              <div class="msg-row"><button type="submit" class="primary-btn">Save</button>
              <button type="button" class="danger-btn" data-act="trash-file">Delete</button></div>
            </form>`}
      </div></div>`;
  }

  // Thumbnails: at most THUMB_PARALLEL small fetches at a time, kept for this visit.
  let thumbQueue = [];
  let thumbRunning = 0;
  function loadThumbs() {
    const scope = ui.scope;
    thumbQueue = [];
    for (const el of view.querySelectorAll("[data-thumb]")) {
      const id = el.dataset.thumb;
      const f = ui.files.find((x) => x.id === id);
      if (!f || !f.parts.includes("thumb")) continue;
      if (thumbs.has(id)) { paintThumb(el, thumbs.get(id)); continue; }
      thumbQueue.push({ id, scope });
    }
    pumpThumbs();
  }
  function pumpThumbs() {
    while (thumbRunning < THUMB_PARALLEL && thumbQueue.length) {
      const { id, scope } = thumbQueue.shift();
      if (thumbs.has(id) || scope !== ui.scope || !visible) continue;
      thumbs.set(id, null);
      thumbRunning++;
      (async () => {
        let bytes;
        try { bytes = await library.thumbnail(scope, id); } catch { thumbs.delete(id); return; }
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        thumbs.set(id, url);
        const live = scope === ui.scope && view.querySelector(`[data-thumb="${CSS.escape(id)}"]`);
        if (live) paintThumb(live, url);
      })().finally(() => { thumbRunning--; pumpThumbs(); });
    }
  }
  function paintThumb(el, url) {
    if (!url || el.querySelector("img")) return;
    el.textContent = "";
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    el.appendChild(img);
  }

  // ---- actions ------------------------------------------------------------------------------------

  async function run(label, fn) {
    const scope = ui.scope;
    const my = gen;
    ui.busy = label; ui.error = ""; draw();
    let err = "";
    try { await fn(scope, my); } catch (e) { err = e?.message || "That didn't work."; }
    if (my !== gen || scope !== ui.scope) return;
    ui.busy = ""; ui.error = err; draw();
  }

  const currentFolder = () => (ui.folders.some((f) => f.id === ui.folder) ? ui.folder : null);

  async function addFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const scope = ui.scope; // the scope and folder the batch was started in, for all of it
    const my = gen;
    const here = () => my === gen && scope === ui.scope && !inSafe;
    const folderId = currentFolder();
    let added = 0;
    const problems = [];
    for (const [i, file] of files.entries()) {
      if (here()) { ui.busy = files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…"; ui.error = ""; draw(); }
      const mime = mimeForFile(file.name, file.type);
      if (!mime) { problems.push(`${file.name}: that kind of file can't be kept here`); continue; }
      if (file.size > MAX_FILE_BYTES) { problems.push(`${file.name}: larger than 60 MB`); continue; }
      try {
        const content = new Uint8Array(await file.arrayBuffer());
        const thumb = mime.startsWith("image/") ? await makeThumb(file) : null;
        const pages = mime === "application/pdf" ? pdfPageCount(content) : 1;
        await library.addFile(scope, { content, thumb, folderId, meta: { name: displayName(file.name), mime, pages } });
        added++;
      } catch (e) { problems.push(`${file.name}: ${e.message}`); }
    }
    if (added) deps.toast?.(added === 1 ? "Added." : `Added ${added} documents.`);
    if (!here()) return;
    ui.busy = "";
    if (added) { try { await refresh(my, scope); } catch (e) { problems.push(e.message); } }
    if (!here()) return;
    ui.error = problems.join(". ");
    draw();
  }

  const fromB64Std = (b64) => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  async function scanDocument() {
    const scope = ui.scope;
    const my = gen;
    const here = () => my === gen && scope === ui.scope && !inSafe;
    const folderId = currentFolder();
    let r;
    try { r = await scanner.scan({ pdf: true, maxPages: 30, maxDimension: 2000, quality: 0.8, ocr: true }); } catch (e) {
      if (here()) { ui.error = e?.message || "The camera couldn't open."; draw(); }
      return;
    }
    if (!r || r.cancelled || !r.pdf) return;
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const name = `Scan ${today.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
    if (here()) { ui.busy = "Saving the scan…"; ui.error = ""; draw(); }
    let id;
    try {
      const content = fromB64Std(r.pdf);
      if (content.length > MAX_FILE_BYTES) throw new Error("That scan is larger than 60 MB. Try fewer pages.");
      const thumb = r.thumb ? fromB64Std(r.thumb) : null;
      const text = (Array.isArray(r.pageText) ? r.pageText : []).join("\n\n").slice(0, SCAN_TEXT_MAX);
      id = await library.addFile(scope, { content, thumb, text, folderId, meta: { name, mime: "application/pdf", pages: Math.max(1, Number(r.pageCount) || 1), documentDate: iso } });
    } catch (e) {
      if (here()) { ui.busy = ""; ui.error = e?.message || "The scan couldn't be saved."; draw(); }
      else deps.toast?.("The scan couldn't be saved.");
      return;
    }
    deps.toast?.("Scan added.");
    if (!here()) return;
    ui.busy = "";
    try { await refresh(my, scope); } catch { /* next open */ }
    if (here()) { draw(); openFile(id); }
  }

  async function openFile(id) {
    const f = ui.files.find((x) => x.id === id);
    if (f?.kind === "doc" && !f.deletedAt) { openDocument(f); return; }
    closeViewer();
    ui.viewer = { id };
    draw();
    const my = gen;
    const scope = ui.scope;
    try {
      const { bytes, mime } = await library.open(scope, id);
      if (my !== gen || ui.viewer?.id !== id) return;
      ui.viewer.bytes = bytes;
      ui.viewer.ready = true;
      if (!MIME_TYPES.includes(mime)) { /* not shown in the page: share or Open only */ }
      else if (mime.startsWith("image/") || mime === "application/pdf") {
        viewerUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
        ui.viewer.url = viewerUrl;
      } else if (mime === "text/plain" || mime === "text/csv") {
        ui.viewer.text = new TextDecoder().decode(bytes.subarray(0, 2 * 1024 * 1024));
      }
    } catch (e) {
      if (ui.viewer?.id === id) ui.viewer.error = e.message || "This document couldn't be opened.";
    }
    draw();
  }

  function closeViewer() {
    if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
    ui.viewer = null;
  }

  const fileNameFor = (f) => {
    const ext = Object.entries(EXT_MIME).find(([, m]) => m === f.mime)?.[0] || "";
    return /\.[a-z0-9]{1,5}$/i.test(f.name) || !ext ? f.name : `${f.name}.${ext}`;
  };

  async function openQuickLook() {
    const v = ui.viewer;
    const f = ui.files.find((x) => x.id === v?.id);
    if (!f || !v.bytes || !quickLook || v.bytes.length > QUICKLOOK_PLAIN_MAX) return;
    let bin = "";
    for (let i = 0; i < v.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, v.bytes.subarray(i, i + 0x8000));
    try { await quickLook.openData({ data: btoa(bin), filename: fileNameFor(f), mimeType: f.mime }); }
    catch (e) { ui.error = e?.message || "It couldn't be opened."; draw(); }
  }

  async function share() {
    const v = ui.viewer;
    const f = ui.files.find((x) => x.id === v?.id);
    if (!f || !v.bytes) return;
    const fileName = fileNameFor(f) || `${f.name}.bin`;
    const blob = new Blob([v.bytes], { type: f.mime });
    try {
      const { saveFile } = await import("../save-file.js");
      const file = new File([blob], fileName, { type: f.mime });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: f.name }); } catch (e) { if (e?.name !== "AbortError") throw e; }
      } else await saveFile(blob, fileName);
    } catch (e) { ui.error = e.message; draw(); }
  }

  async function saveEdit(form) {
    const id = ui.viewer?.id;
    const f = ui.files.find((x) => x.id === id);
    if (!f) return;
    const name = form.name.value.trim();
    const folderId = form.folder.value || null;
    const date = form.date.value || null;
    const tags = form.tags.value.split(",").map((t) => t.trim()).filter(Boolean);
    await run("Saving…", async (scope, my) => {
      if (folderId !== f.folderId) await library.move(scope, id, folderId);
      if (name && name !== f.name) await library.rename(scope, id, name);
      if ((date || null) !== (f.documentDate || null)) await library.setDocumentDate(scope, id, date);
      if (tags.join("\n") !== f.tags.join("\n")) await library.setTags(scope, id, tags);
      await refresh(my, scope);
      deps.toast?.("Saved.");
    });
  }

  // Search: names and tags at once; the text read from scanned pages from the database,
  // once typing pauses (one query per pause, never per keystroke).
  let searchTimer = null;
  function searchServer() {
    clearTimeout(searchTimer);
    const q = ui.query.trim();
    if (q.length < 2) { ui.hits = null; return; }
    const scope = ui.scope;
    const my = gen;
    searchTimer = setTimeout(async () => {
      try {
        const hits = await library.search(scope, q);
        if (my !== gen || scope !== ui.scope || ui.query.trim() !== q) return;
        ui.hits = hits;
        redrawKeepingSearch();
      } catch { /* the name filter still works */ }
    }, SEARCH_DELAY_MS);
  }
  function redrawKeepingSearch() {
    const box = view.querySelector("[data-search]");
    const pos = box?.selectionStart ?? null;
    const focused = box && document.activeElement === box;
    draw();
    const again = view.querySelector("[data-search]");
    if (again && focused) { again.focus(); try { if (pos !== null) again.setSelectionRange(pos, pos); } catch { /* some browsers */ } }
  }

  // ---- events ---------------------------------------------------------------------------------------

  root.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.closest("[data-act=leave-safe]")) { leaveSafe(); return; }
    if (inSafe) return; // the Safe handles its own clicks
    const folderBtn = t.closest("[data-folder]");
    if (folderBtn) {
      ui.folder = folderBtn.dataset.folder;
      view.querySelector("#docsSidebar")?.classList.remove("is-expanded");
      draw();
      return;
    }
    const openBtn = t.closest("[data-open]");
    if (openBtn) { openFile(openBtn.dataset.open); return; }
    const act = t.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "open-safe") openSafe();
    else if (act === "reload") { ui.error = ""; ui.view = "loading"; draw(); load(); }
    else if (act === "toggle-sidebar") {
      const sb = view.querySelector("#docsSidebar");
      if (window.innerWidth <= 680) sb?.classList.toggle("is-expanded"); else sb?.classList.toggle("is-collapsed");
    } else if (act === "add") toggleAddMenu(t.closest("[data-act]"));
    else if (act === "add-upload") { closeAddMenu(); view.querySelector("[data-file-input]")?.click(); }
    else if (act === "new-doc") { closeAddMenu(); newDocument(); }
    else if (act === "add-word") { closeAddMenu(); pickWordFiles(); }
    else if (act === "add-google") { closeAddMenu(); googleImport(); }
    else if (act === "docx-to-doc") wordFileToDocument();
    else if (act === "scan") scanDocument();
    else if (act === "close-viewer") { closeViewer(); ui.error = ""; draw(); }
    else if (act === "share") share();
    else if (act === "quicklook") openQuickLook();
    else if (act === "open-receipt") deps.openReceipt?.(t.closest("[data-act]")?.dataset.receipt || "");
    else if (act === "trash-file") {
      const id = ui.viewer?.id;
      await run("Deleting…", async (scope, my) => { await library.trash(scope, id); if (my === gen) closeViewer(); await refresh(my, scope); deps.toast?.(`Moved to Recently deleted for ${RECENTLY_DELETED_DAYS} days.`); });
    } else if (act === "restore-file") {
      const id = ui.viewer?.id;
      await run("Putting back…", async (scope, my) => { await library.restore(scope, id); if (my === gen) closeViewer(); await refresh(my, scope); });
    } else if (act === "new-folder") {
      const name = window.prompt("Folder name")?.trim();
      if (!name) return;
      const sort = ui.folders.length + 1;
      await run("Adding the folder…", async (scope, my) => { const id = await library.addFolder(scope, name, { sort }); if (my === gen) ui.folder = id; await refresh(my, scope); });
    } else if (act === "rename-folder") {
      const f = ui.folders.find((x) => x.id === ui.folder);
      const name = window.prompt("Folder name", f?.name || "")?.trim();
      if (!f || !name || name === f.name) return;
      await run("Renaming…", async (scope, my) => { await library.renameFolder(scope, f.id, name); await refresh(my, scope); });
    } else if (act === "delete-folder") {
      const f = ui.folders.find((x) => x.id === ui.folder);
      if (!f || !window.confirm(`Remove “${f.name}”? Its documents go to Recently deleted for ${RECENTLY_DELETED_DAYS} days.`)) return;
      await run("Removing the folder…", async (scope, my) => { await library.deleteFolder(scope, f.id); if (my === gen) ui.folder = "all"; await refresh(my, scope); });
    }
  });

  root.addEventListener("submit", (e) => {
    if (inSafe) return;
    const form = e.target.closest("[data-form=edit]");
    if (!form) return;
    e.preventDefault();
    saveEdit(form);
  });

  root.addEventListener("input", (e) => {
    if (inSafe || !e.target.matches("[data-search]")) return;
    ui.query = e.target.value;
    redrawKeepingSearch();
    searchServer();
  });

  root.addEventListener("change", (e) => {
    if (inSafe) return;
    if (e.target.matches("[data-file-input]")) { addFiles(e.target.files); e.target.value = ""; }
  });

  root.addEventListener("dragover", (e) => {
    if (inSafe || ui.view !== "library" || !e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    view.querySelector("[data-drop]")?.classList.add("is-drop-target");
  });
  root.addEventListener("dragleave", (e) => {
    if (inSafe) return;
    if (e.target.closest?.("[data-drop]") && !root.contains(e.relatedTarget)) view.querySelector("[data-drop]")?.classList.remove("is-drop-target");
  });
  root.addEventListener("drop", (e) => {
    if (inSafe || ui.view !== "library" || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    view.querySelector("[data-drop]")?.classList.remove("is-drop-target");
    addFiles(e.dataTransfer.files);
  });

  // ---- the word processor ------------------------------------------------------------------

  let addMenu = null;
  function closeAddMenu() { addMenu?.remove(); addMenu = null; }
  function toggleAddMenu(anchor) {
    if (addMenu) { closeAddMenu(); return; }
    addMenu = document.createElement("div");
    addMenu.className = "docs-add-menu";
    addMenu.setAttribute("role", "menu");
    addMenu.innerHTML = `<button type="button" role="menuitem" data-act="new-doc">New document</button>
      <button type="button" role="menuitem" data-act="add-upload">Upload a file</button>
      <button type="button" role="menuitem" data-act="add-word">Open a Word file as a document</button>
      <button type="button" role="menuitem" data-act="add-google">Bring over Google Docs</button>`;
    const r = anchor.getBoundingClientRect();
    addMenu.style.top = `${r.bottom + 6}px`;
    addMenu.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    root.appendChild(addMenu);
    setTimeout(() => document.addEventListener("click", function off(ev) { if (!addMenu?.contains(ev.target) && !anchor.contains(ev.target)) { closeAddMenu(); document.removeEventListener("click", off, true); } }, true), 0);
  }

  const docStore = async (scope, fileId) => (await host()).storeFor({ storage, transport, scope, fileId });

  async function openDocument(f, { startEditing = false } = {}) {
    if (openDoc) return;
    const scope = ui.scope;
    openDoc = "opening";
    try {
      const h = await host();
      const store = await docStore(scope, f.id);
      openDoc = await h.openEditorFor({
        store, file: { id: f.id, name: f.name, scope }, me: { id: userId, name: myName() }, people: people(), startEditing,
        deps: {
          liveOpen: deps.liveDocChannel || null, chipSource: deps.docChipSource || null, openChip: deps.openDocChip || null,
          toast: deps.toast, isNative: deps.isNative, nativePdf: deps.nativePdfExport?.() ? (o) => deps.nativePdfExport().render(o).then((r) => r.pdf) : null,
          share: (blob, name, mime) => shareBlob(blob, name, mime),
          rename: (n) => { const x = ui.files.find((y) => y.id === f.id); if (x) x.name = n; },
        },
        onClose: () => { openDoc = null; if (visible && ui.scope === scope) refresh(gen, scope).then(() => draw()).catch(() => {}); },
      });
      if (!openDoc?.close) openDoc = null;
    } catch (e) {
      openDoc = null;
      ui.error = e?.message || "That document couldn't be opened.";
      draw();
    }
  }

  async function shareBlob(blob, name, mime) {
    const { saveFile } = await import("../save-file.js");
    const file = new File([blob], name, { type: mime });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); } catch (e) { if (e?.name !== "AbortError") throw e; }
    } else await saveFile(blob, name);
  }

  async function newDocument(converted = null, name = "Untitled document") {
    const scope = ui.scope;
    const folderId = currentFolder();
    let id;
    await run(converted ? "Making the document…" : "Making a new document…", async (sc, my) => {
      const h = await host();
      id = await h.createDocFile({ library, storage, transport, scope: sc, folderId, name, converted, me: { id: userId, name: myName() } });
      await refresh(my, sc);
    });
    const f = id && ui.scope === scope && ui.files.find((x) => x.id === id);
    if (f) openDocument(f, { startEditing: !converted });
    return id;
  }

  function pickWordFiles() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) { ui.error = "That file is larger than 60 MB."; draw(); return; }
      await importWordBytes(new Uint8Array(await file.arrayBuffer()), displayName(file.name));
    };
    input.click();
  }

  async function importWordBytes(bytes, name) {
    let conv;
    try { conv = await (await host()).convertDocx(bytes); } catch (e) { ui.error = e?.message || "That Word file couldn't be read."; draw(); return; }
    await newDocument(conv, name);
    if (conv.warnings?.length) deps.toast?.(`Opened. Not everything carried over: ${conv.warnings.slice(0, 3).join(", ")}.`);
  }

  async function wordFileToDocument() {
    const v = ui.viewer;
    const f = ui.files.find((x) => x.id === v?.id);
    if (!f || !v.bytes) return;
    closeViewer();
    await importWordBytes(v.bytes, f.name);
  }

  // Google Docs: browse Drive (documents and folders), pick, bring over. A picked
  // folder becomes a Document folder of the same name with its documents in it.
  async function googleImport() {
    const h = await host();
    const api = h.googleDocsApi({ getToken: deps.getToken });
    const box = document.createElement("div");
    box.className = "wp-dialog docs-gdocs";
    box.innerHTML = `<div class="wp-dialog-box docs-gdocs-box" role="dialog" aria-modal="true" aria-label="Bring over Google Docs">
      <h3>Bring over Google Docs</h3><div data-g-body><p class="msg-muted">Looking in your Google Drive…</p></div>
      <div class="wp-dialog-actions"><button type="button" class="secondary-btn" data-g="cancel">Close</button><button type="button" class="primary-btn" data-g="go" disabled>Bring over</button></div></div>`;
    root.appendChild(box);
    const body = box.querySelector("[data-g-body]");
    const go = box.querySelector("[data-g=go]");
    const picked = new Map(); // id → { name, kind }
    const path = [{ id: null, name: "My Drive" }];
    let busy = false;
    const close = () => box.remove();
    async function list() {
      body.innerHTML = `<p class="msg-muted">Looking in your Google Drive…</p>`;
      let items = [];
      try {
        let token = null;
        do { const r = await api.list(path[path.length - 1].id, token); items = items.concat(r.items); token = r.nextPageToken; } while (token && items.length < 1000);
      } catch (e) {
        if (e.code === "CONSENT") {
          body.innerHTML = `<p>To bring your documents over, Live needs to read your Google Drive and Docs (read-only). Nothing is changed or deleted in Google.</p>
            <button type="button" class="primary-btn" data-g="consent">Connect Google Docs</button>`;
        } else body.innerHTML = `<p class="msg-error">${esc(e.message)}</p>`;
        return;
      }
      body.innerHTML = `<div class="docs-gdocs-path">${path.map((p, i) => `<button type="button" class="link-btn" data-g-path="${i}">${esc(p.name)}</button>`).join(" › ")}</div>
        <ul class="docs-gdocs-list">${items.map((it) => `<li><label><input type="checkbox" data-g-pick="${esc(it.id)}" data-kind="${it.kind}" data-name="${esc(it.name)}"${picked.has(it.id) ? " checked" : ""}> ${it.kind === "folder" ? "📁" : "📄"} ${esc(it.name)}</label>${it.kind === "folder" ? ` <button type="button" class="link-btn" data-g-open="${esc(it.id)}" data-name="${esc(it.name)}">Open ›</button>` : ""}</li>`).join("") || `<li class="msg-muted">Nothing here.</li>`}</ul>
        <p class="msg-muted">Documents come into ${esc(ui.title)}${currentFolder() ? `, in “${esc(ui.folders.find((x) => x.id === currentFolder())?.name || "")}”` : ""}. Nothing is changed in Google.</p>`;
    }
    box.addEventListener("click", async (e) => {
      const g = e.target.closest("[data-g]")?.dataset.g;
      if (g === "cancel" && !busy) close();
      else if (g === "consent") {
        try {
          const r = await fetch(`/.netlify/functions/gcal-auth?docs=1${deps.isNative ? "&client=ios" : ""}`, { headers: { authorization: `Bearer ${await deps.getToken()}` } });
          const d = await r.json();
          if (d.url) { if (deps.openAuthUrl) { await deps.openAuthUrl(d.url); list(); } else window.location.href = d.url; }
          else throw new Error(d.error || "Couldn't start the Google connection.");
        } catch (err) { body.innerHTML = `<p class="msg-error">${esc(err.message)}</p>`; }
      } else if (g === "go" && picked.size && !busy) {
        busy = true;
        go.disabled = true;
        const jobs = [];
        const folderIdHere = currentFolder();
        for (const [id, it] of picked) {
          if (it.kind === "doc") jobs.push({ id, name: it.name, folderId: folderIdHere });
          else {
            let docs = [];
            try { let tok = null; do { const r = await api.list(id, tok); docs = docs.concat(r.items.filter((x) => x.kind === "doc")); tok = r.nextPageToken; } while (tok && docs.length < 500); } catch { /* reported below */ }
            let fid = null;
            try { fid = await library.folderNamed(ui.scope, it.name); } catch { fid = folderIdHere; }
            for (const d of docs) jobs.push({ id: d.id, name: d.name, folderId: fid });
          }
        }
        const failed = [];
        let n = 0;
        const scope = ui.scope;
        for (const j of jobs) {
          n++;
          body.innerHTML = `<p>Bringing over ${n} of ${jobs.length}: ${esc(j.name)}…</p>`;
          try {
            const conv = await api.convert(j.id);
            await h.createDocFile({ library, storage, transport, scope, folderId: j.folderId, name: j.name, converted: conv, me: { id: userId, name: myName() } });
          } catch (err) { failed.push(`${j.name} (${err.message})`); }
        }
        busy = false;
        body.innerHTML = `<p>Brought over ${jobs.length - failed.length} of ${jobs.length}.</p>${failed.length ? `<p class="msg-error">Didn't come over: ${esc(failed.join("; "))}</p>` : ""}`;
        box.querySelector("[data-g=cancel]").textContent = "Done";
        picked.clear();
        try { await refresh(gen, scope); draw(); } catch { /* next open */ }
      }
      const pathBtn = e.target.closest("[data-g-path]");
      if (pathBtn) { path.length = Number(pathBtn.dataset.gPath) + 1; list(); }
      const openBtn = e.target.closest("[data-g-open]");
      if (openBtn) { path.push({ id: openBtn.dataset.gOpen, name: openBtn.dataset.name }); list(); }
    });
    box.addEventListener("change", (e) => {
      const cb = e.target.closest("[data-g-pick]");
      if (!cb) return;
      if (cb.checked) picked.set(cb.dataset.gPick, { name: cb.dataset.name, kind: cb.dataset.kind }); else picked.delete(cb.dataset.gPick);
      go.disabled = !picked.size;
      go.textContent = picked.size ? `Bring over (${picked.size})` : "Bring over";
    });
    list();
  }

  return {
    async show(scope, { kind = "household", title = "Document" } = {}) {
      visible = true;
      if (scope !== ui.scope) {
        if (inSafe) leaveSafe({ redraw: false });
        closeViewer();
        for (const url of thumbs.values()) if (url) URL.revokeObjectURL(url);
        thumbs.clear();
        Object.assign(ui, { scope, kind, title, view: "loading", folder: "all", query: "", hits: null, folders: [], files: [], banners: [], error: "", busy: "" });
      } else Object.assign(ui, { kind, title });
      if (!scope) { ui.view = "error"; ui.error = kind === "household" ? "You're not in a household yet." : "Personal documents aren't available."; draw(); return; }
      if (inSafe) { await safe?.show(scope, { kind, title: kind === "personal" ? "Personal Safe" : "Household Safe" }); return; }
      draw();
      await load();
    },
    // Re-reads the open library (a receipt's file moved to Personal).
    reload() { if (visible && !inSafe && ui.scope && ui.view === "library") load(); },
    // Opens the Safe directly (#documents/safe).
    openSafe: () => openSafe(),
    hide() {
      visible = false;
      closeAddMenu();
      if (openDoc?.close) openDoc.close();
      closeViewer();
      gen++;
      if (inSafe) leaveSafe({ redraw: false });
    },
    destroy() {
      visible = false;
      gen++;
      closeViewer();
      safe?.destroy?.();
      safe = null; safeLoading = null; inSafe = false;
      for (const url of thumbs.values()) if (url) URL.revokeObjectURL(url);
      thumbs.clear();
      root.innerHTML = "";
    },
    // A Word file converted elsewhere (Mail's attachment preview, "Save to Document")
    // becomes a document in the scope and folder on screen, and opens. Call after show().
    async addConverted(converted, name) {
      if (inSafe) leaveSafe({ redraw: false });
      if (!ui.scope) throw new Error("Document isn't open.");
      return newDocument(converted, String(name || "Untitled document").slice(0, 200));
    },
    get _debug() { return { ui, library, inSafe, safe }; },
  };
}
