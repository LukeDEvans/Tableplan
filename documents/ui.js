// The Documents pages (DOCUMENTS_DESIGN.md §9): Household Documents (shared) and
// Personal Documents (Luke only). One module draws both; which one is the scope
// passed to show(). Loaded lazily the first time a Documents page opens, so
// libsodium never touches the app's boot.
//
// mountDocuments(root, deps) → { show(scope, { kind, title }), hide(), destroy() }
// deps (from app.js): userId, baseUrl(), headers(), functionsUrl(), getToken(),
//   isNative, nativeMessagingKeys(), household() → { scope, members: [{ user_id,
//   display_name }] } | null, personalScope() → "u-<uid>" | null (only when this
//   person has Personal), toast(text), openMessages().
//
// Builds on the messaging account on this device (setup, linking and the
// verification scan all happen in Messages). Documents keeps its own keystore
// (IndexedDB "live-documents"), wiped with messaging's at sign-out.
//
// Rules carried from the reviews (the agent file has the full list):
//   - everything a person typed, and every name read from a document, is escaped;
//   - a document is opened with the type its metadata gives (a fixed list: no HTML,
//     SVG or XML), as an <img>, a PDF frame, or plain text; anything else is shared;
//   - nothing polls: the page reads on show, on "Check again", and after its own edits.

import { loadSodium, MIME_TYPES } from "./crypto/index.js";
import { createMessagingServer, createRestTransport } from "../messaging/server.js";
import { createKeystore, idbBackend, withLock } from "../messaging/keystore.js";
import { createMessagingAccount } from "../messaging/account.js";
import { createDocumentsServer } from "./server.js";
import { createDocumentsVaults } from "./vaults.js";
import { createDocumentsStorage, edgePresigner } from "./storage.js";
import { createDocumentsLibrary, RECENTLY_DELETED_DAYS } from "./library.js";
import { fileReceipts, OUTBOX_LOCK } from "./outbox.js";
import { createPasskeyLock, copyStore, WEB_LOCKED_DB } from "./web-lock.js";
import { deleteMessagingStore } from "../messaging/keystore.js";

export const DOCUMENTS_DB = "live-documents";
export const STARTING_FOLDERS = Object.freeze({
  household: Object.freeze(["IDs & Records", "Home", "Vehicles", "Insurance", "Medical"]),
  personal: Object.freeze(["Work", "Personal"]),
});
export const USAGE_WARN_BYTES = 7 * 1024 ** 3; // decision 5: warn at 7 GB of the 10 GB free
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const SCAN_TEXT_MAX = 100000; // characters of page text kept for search
const CACHE_FILE_MAX = 20 * 1024 * 1024; // recently opened files kept on the device (encrypted)
const CACHE_TOTAL_MAX = 200 * 1024 * 1024;
const THUMB_PX = 320;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const EXT_MIME = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", heif: "image/heif",
  webp: "image/webp", gif: "image/gif", txt: "text/plain", csv: "text/csv", doc: "application/msword",
  xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

// The file's type from the list Documents allows, or null. The browser's guess
// first (normalised), then the extension.
export function mimeForFile(name, type) {
  const t = String(type || "").toLowerCase().replace("image/jpg", "image/jpeg");
  if (MIME_TYPES.includes(t)) return t;
  const ext = String(name || "").toLowerCase().split(".").pop();
  return EXT_MIME[ext] || null;
}

// A name for the list: the file name without its extension.
export function displayName(fileName) {
  const base = String(fileName || "").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim();
  return (base || "Document").slice(0, 200);
}

// Pages in a PDF, roughly (page objects in the file); 1 when it can't tell.
export function pdfPageCount(bytes) {
  try {
    const text = new TextDecoder("latin1").decode(bytes.length > 30 * 1024 * 1024 ? bytes.subarray(0, 30 * 1024 * 1024) : bytes);
    const n = (text.match(/\/Type\s*\/Page(?![a-zA-Z])/g) || []).length;
    return Math.max(1, Math.min(n, 9999));
  } catch { return 1; }
}

export function sizeLabel(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function dateLabel(iso) {
  if (!iso) return "";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const ICON = {
  all: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg>',
  folder: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
  receipt: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/></svg>',
  trash: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  plus: '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  add: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  scan: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/></svg>',
};
const FILE_GLYPH = { "application/pdf": "PDF", "text/plain": "TXT", "text/csv": "CSV" };
const glyphFor = (mime) => FILE_GLYPH[mime] || (mime.startsWith("image/") ? "IMG" : mime.includes("sheet") || mime.includes("excel") ? "XLS" : mime.includes("presentation") || mime.includes("powerpoint") ? "PPT" : "DOC");

async function makeThumb(blob) {
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    const out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
    return out ? new Uint8Array(await out.arrayBuffer()) : null;
  } catch { return null; } // HEIC in a browser that can't draw it, or a broken image
}

export async function mountDocuments(root, deps) {
  root.innerHTML = `<div class="msg-pane"><p class="msg-muted">Loading Documents…</p></div>`;
  await loadSodium();
  const userId = deps.userId;
  const keyPlugin = deps.nativeMessagingKeys?.();
  const getRawWrapKey = keyPlugin
    ? async () => { const { key } = await keyPlugin.wrapKey(); return Uint8Array.from(atob(key), (c) => c.charCodeAt(0)); }
    : async () => null;
  const msgBackend = await idbBackend({ getRawWrapKey });
  const msgStore = createKeystore(msgBackend);
  // THE LOCK (decision 6, §8). On the iPhone, Documents' own store (vault keys, cached
  // names, thumbnails) is encrypted with a Keychain key that only Face ID or the
  // passcode releases (DocumentsLock). It's opened on each visit and forgotten when
  // the page is left or the app goes to the background, so every open asks again.
  // In a browser (or an app build without the plugin) there's no lock: the store uses
  // the same key as messaging's and stays open while the page is.
  // iPhone: Face ID (DocumentsLock). Browser: a passkey, once turned on in ⚙ (Luke,
  // 2026-11-03); its store is a separate database encrypted with the passkey's key.
  const nativeLock = deps.nativeDocumentsLock?.() || null;
  const passkey = nativeLock || deps.isNative ? null : createPasskeyLock({ userId, userName: deps.userName || "Live" });
  let lockPlugin = nativeLock || (passkey?.configured() ? passkey : null);
  const storeDb = () => (!nativeLock && lockPlugin === passkey && passkey ? WEB_LOCKED_DB : DOCUMENTS_DB);
  let passkeySupported = false;
  passkey?.supported().then((ok) => { passkeySupported = ok; if (ui.panel === "settings") draw(); }).catch(() => {});
  let session = null; // { backend } while unlocked
  let store = null, vaults = null, library = null;
  let unlocking = null;

  const transport = createRestTransport({ baseUrl: deps.baseUrl, headers: deps.headers });
  const server = createDocumentsServer(transport);
  const account = createMessagingAccount({ server: createMessagingServer(transport), store: msgStore, userId });
  const household = () => deps.household?.() || null;
  const storage = createDocumentsStorage({ presign: edgePresigner({ functionsUrl: deps.functionsUrl(), getToken: deps.getToken }) });

  // Recently opened files, kept ENCRYPTED in this device's (locked) store: a file of
  // at most CACHE_FILE_MAX, CACHE_TOTAL_MAX in all, the least recently opened dropped
  // first. Index: "blobidx" → [{ key, size, at }].
  function openedFilesCache(s) {
    const index = async () => (await s.get("blobidx")) || [];
    return {
      async get(key) {
        const bytes = await s.get(`blob:${key}`);
        if (!bytes) return null;
        const list = await index();
        const e = list.find((x) => x.key === key);
        if (e) { e.at = Date.now(); await s.set("blobidx", list); }
        return bytes;
      },
      async set(key, bytes) {
        if (!(bytes instanceof Uint8Array) || bytes.length > CACHE_FILE_MAX) return;
        let list = (await index()).filter((x) => x.key !== key);
        list.push({ key, size: bytes.length, at: Date.now() });
        list.sort((a, b) => a.at - b.at);
        let total = list.reduce((n, x) => n + x.size, 0);
        while (total > CACHE_TOTAL_MAX && list.length) { const old = list.shift(); total -= old.size; await s.remove(`blob:${old.key}`); }
        if (!list.some((x) => x.key === key)) return;
        await s.set(`blob:${key}`, bytes);
        await s.set("blobidx", list);
      },
    };
  }

  // Opens Documents' store (the Face ID prompt on the iPhone). Throws a LockError-like
  // { code } when the person cancels or the phone has no passcode.
  function unlock() {
    if (session) return Promise.resolve();
    unlocking ||= (async () => {
      const started = epoch;
      const getKey = lockPlugin
        ? async () => { const { key } = await lockPlugin.unlock({ reason: "Open your documents" }); return Uint8Array.from(atob(key), (c) => c.charCodeAt(0)); }
        : getRawWrapKey;
      const backend = await idbBackend({ dbName: storeDb(), getRawWrapKey: getKey });
      // Locked again while Face ID was up (the page left, the app backgrounded): what
      // was just opened is closed, not kept for the next visit.
      if (epoch !== started) { backend.close(); throw Object.assign(new Error("Locked"), { code: "CANCELLED" }); }
      const s = createKeystore(backend);
      // Another account used Documents here before, or the store was written under a
      // key this phone no longer has (the lock key replaced, the passcode turned off):
      // start empty. This device then gets a new box key and is granted the vaults
      // again by another device, or restores them with the recovery code. Only a
      // failed DECRYPTION means a lost key; any other error leaves the store alone.
      let owner = null;
      try { owner = await s.get("owner"); } catch (e) {
        if (e?.name !== "OperationError") { backend.close(); throw e; }
      }
      if (owner !== userId) { await s.clear(); await s.set("owner", userId); }
      if (epoch !== started) { backend.close(); throw Object.assign(new Error("Locked"), { code: "CANCELLED" }); }
      store = s;
      vaults = createDocumentsVaults({
        server, store, account, userId,
        scopeMembers: async (scope) => { const h = household(); return h && h.scope === scope ? h.members.map((m) => m.user_id) : []; },
      });
      library = createDocumentsLibrary({ server, storage, vaults, store, userId, blobCache: openedFilesCache(s) });
      session = { backend };
    })().finally(() => { unlocking = null; });
    return unlocking;
  }

  // Actions that change things (uploads, edits, removals, restores) are tracked so a
  // lock never cuts one off half-way: the page locks at once (nothing shown, nothing
  // drawn), and the store closes when the last running action finishes.
  let epoch = 0; // bumped by every lock; an unlock it overtook closes what it opened
  let inflight = 0;
  let drained = null; // resolves when inflight reaches 0 after a deferred lock
  let releaseDrained = null;
  async function track(work) {
    inflight++;
    try { return await work(); } finally {
      inflight--;
      if (inflight === 0 && releaseDrained) { closeSession(); releaseDrained(); releaseDrained = null; drained = null; }
    }
  }
  function closeSession() {
    try { session?.backend.close(); } catch { /* already closed */ }
    session = null; store = null; vaults = null; library = null;
  }

  // Forget everything opened (iPhone only): keys, decrypted thumbnails, the open
  // document, and the page's markup (it would otherwise sit in the hidden page).
  // Anything still drawing for the old session stops (gen).
  function lock() {
    if (!lockPlugin) return;
    epoch++;
    gen++;
    closeViewer();
    for (const url of thumbs.values()) if (url) URL.revokeObjectURL(url);
    thumbs.clear();
    thumbQueue = [];
    texts.clear();
    ui.files = []; ui.folders = []; ui.banners = []; ui.busy = ""; ui.devices = []; ui.staleDevices = [];
    // A recovery code on screen is already in force: keep it (in memory only) so it's
    // shown again after unlocking, rather than lost unseen.
    if (ui.panel !== "recovery") { ui.code = null; ui.panel = null; }
    if (visible) { ui.view = "locked"; ui.lockError = ""; draw(); } else root.innerHTML = "";
    if (!session) return;
    if (inflight > 0) {
      drained ||= new Promise((r) => { releaseDrained = r; });
      return;
    }
    closeSession();
  }

  const ui = {
    scope: null, kind: "household", title: "Documents", view: "loading", error: "", busy: "",
    folder: "all", query: "", folders: [], files: [], banners: [], viewer: null, panel: null,
    code: null, canCreate: false, isPhone: false, usage: 0, devices: [], unverified: [], staleDevices: [],
  };
  let visible = false;
  let gen = 0; // a show() for another scope makes older loads stop drawing
  const thumbs = new Map(); // fileId → object URL (this session)
  let viewerUrl = null;

  const allScopes = () => [deps.personalScope?.(), household()?.scope].filter(Boolean);
  const nameOf = (uid) => (uid === userId ? "You" : household()?.members.find((m) => m.user_id === uid)?.display_name || "Someone");
  const otherNames = () => (household()?.members || []).filter((m) => m.user_id !== userId).map((m) => m.display_name || "them");

  // ---- loading -------------------------------------------------------------------------

  let loadGen = 0;
  async function load() {
    const my = ++gen;
    loadGen = my;
    if (!session || drained) {
      ui.view = "locked"; draw();
      try { if (drained) await drained; await unlock(); } catch (e) {
        if (my !== gen) return;
        ui.lockError = e?.code === "NO_PASSCODE" ? "Set a passcode on this iPhone to use Documents." : e?.code === "CANCELLED" ? "" : (e?.message || "Couldn't unlock.");
        return draw();
      }
      if (my !== gen) return;
      ui.lockError = "";
    }
    const scope = ui.scope;
    const st = await account.status();
    if (my !== gen) return;
    ui.isPhone = st.state === "ready" && st.kind === "phone";
    if (st.state !== "ready") { ui.view = "needs-messaging"; ui.messagingState = st.state; return draw(); }
    let opened;
    try { opened = await vaults.open(scope); } catch (e) { if (my === gen) { ui.view = "error"; ui.error = e.message; draw(); } return; }
    if (my !== gen) return;
    ui.banners = [];
    if (ui.kind === "household") await checkVerified();
    if (my !== gen) return;
    if (opened.state === "missing") { ui.view = "setup"; return draw(); }
    if (opened.state === "removed") { ui.view = "removed"; return draw(); }
    if (opened.rekeyed) deps.signOutOtherSessions?.(); // a new phone just cut off the lost one: its sign-in goes too
    ui.behind = opened.state === "behind";
    if (opened.state === "waiting" || ui.behind) {
      const hasRecovery = ui.isPhone && Boolean(await server.recoveryKey(userId).catch(() => null));
      if (my !== gen) return;
      ui.view = "waiting"; ui.hasRecovery = hasRecovery;
      return draw();
    }
    ui.view = "library";
    // Hand this vault to any trusted device still waiting for it (Marijane's
    // phone, a newly linked browser). One pass per open; nothing loops.
    await vaults.grantPending(scope).catch(() => {});
    if (my !== gen) return;
    library.purgeExpired(scope).catch(() => {});
    await refresh(my);
    if (my !== gen) return;
    if (ui.kind === "household") await fileWaitingReceipts(my, scope);
    if (my !== gen) return;
    await checkBanners(my);
    if (my !== gen) return;
    draw();
  }

  // Receipts scanned on this device since Household was last opened (the outbox,
  // documents/outbox.js) go into Receipts now. Tracked: a lock mid-way doesn't lose
  // one, and each leaves the outbox only once it's stored.
  let filing = null;
  async function fileWaitingReceipts(my, scope) {
    const receiptsFolder = ui.folders.find((f) => f.kind === "receipts");
    if (!deps.receiptOutbox || !receiptsFolder) return;
    let outbox;
    try { outbox = await deps.receiptOutbox(); } catch { return; }
    if (!outbox || !(await outbox.entries()).some((e) => e.scope === scope)) return;
    // One run at a time on this page; Web Locks keep a second tab out too.
    filing ||= track(() => fileReceipts({
      outbox, library, scope, folderId: receiptsFolder.id,
      receipts: () => deps.receipts?.() || [],
      makeThumb: (page) => makeThumb(new Blob([page.bytes], { type: page.type })),
      mimeOk: (mime) => MIME_TYPES.includes(mime),
      lock: (fn) => withLock(OUTBOX_LOCK, fn),
    })).finally(() => { filing = null; });
    try {
      const { filed, failed, dropped } = await filing;
      const notes = [];
      if (filed) notes.push(filed === 1 ? "1 receipt filed in Receipts." : `${filed} receipts filed in Receipts.`);
      if (failed) notes.push(`${failed} couldn't be filed yet; Documents will try again.`);
      if (dropped) notes.push(`${dropped} receipt ${dropped === 1 ? "page wasn't" : "pages weren't"} a kind Documents keeps.`);
      if (notes.length) deps.toast?.(notes.join(" "));
    } catch { /* what didn't file stays in the outbox for the next open */ }
    if (my === gen && scope === ui.scope) await refresh(my, scope);
  }

  async function refresh(my = gen, scope = ui.scope) {
    const [folders, files] = await Promise.all([library.folders(scope), library.files(scope, { includeDeleted: true })]);
    if (my !== gen || scope !== ui.scope) return;
    if (!folders.length) {
      const kind = ui.kind;
      const made = await library.ensureStartingFolders(scope, { receipts: kind === "household", names: STARTING_FOLDERS[kind] });
      if (my !== gen || scope !== ui.scope) return;
      ui.folders = made;
    } else ui.folders = folders;
    ui.files = files;
    if (ui.folder !== "all" && ui.folder !== "trash" && !ui.folders.some((f) => f.id === ui.folder)) ui.folder = "all";
  }

  async function checkVerified() {
    const others = (household()?.members || []).filter((m) => m.user_id !== userId);
    if (!others.length) { ui.unverified = []; return; }
    try {
      const { people } = await account.resolveDevices(others.map((m) => m.user_id));
      ui.unverified = others.filter((m) => { const p = people[m.user_id]; return !p || !p.verified || p.changed; }).map((m) => m.display_name || "them");
    } catch { ui.unverified = []; }
  }

  async function checkBanners(my = gen) {
    const scope = ui.scope;
    const b = [];
    if (ui.kind === "household" && ui.unverified.length) {
      const who = esc(ui.unverified.join(" and "));
      b.push({ warn: false, html: `This device hasn't verified ${who} yet. Verify in Messages so this device shares these documents with ${who}. <button type="button" class="link-btn" data-act="open-messages">Open Messages</button>` });
    }
    if (ui.isPhone) {
      const reason = await vaults.needsNewCodeReason();
      if (reason === "after-recovery") b.push({ warn: true, html: `This phone replaced a lost one. If you still have your old recovery code, use it first to bring back Personal Documents; then make a new code. <button type="button" class="link-btn" data-act="new-code">Make a new code</button>` });
      else if (reason) b.push({ warn: true, html: `A device was removed. Make a new recovery code; the old one no longer works. <button type="button" class="link-btn" data-act="new-code">Make a new code</button>` });
      else if (ui.kind === "personal" && !(await server.recoveryKey(userId).catch(() => ({})))) b.push({ warn: true, html: `Make your recovery code: it's the only way back into Personal Documents if this phone is lost. <button type="button" class="link-btn" data-act="new-code">Make it now</button>` });
      const stale = await staleDevices(scope);
      if (my !== gen) return;
      ui.staleDevices = stale;
      if (ui.staleDevices.length) b.push({ warn: true, html: `${esc(ui.staleDevices.map((d) => d.label).join(", "))} was removed in Messages but can still open these documents. <button type="button" class="link-btn" data-act="rekey">Lock it out</button>` });
    }
    try {
      const usage = await library.usage(scope);
      if (my !== gen) return;
      ui.usage = usage;
      if (ui.usage >= USAGE_WARN_BYTES) b.push({ warn: true, html: `Documents is using ${sizeLabel(ui.usage)} of the 10 GB that's free.` });
    } catch { /* best-effort */ }
    if (my === gen) ui.banners = b;
  }

  // My devices the server lists as removed (in Messages) that still hold a grant
  // at this vault's current version: they need a re-key to lose access.
  async function staleDevices(scope) {
    try {
      const k = await vaults.keysFor(scope);
      const [all, live, grants] = await Promise.all([server.myDeviceIds(userId), account.myDevices(), server.grantsAt(k.vaultId, k.version)]);
      const liveIds = new Set(live.map((d) => d.deviceId));
      const holders = new Set(grants.map((g) => g.device_id));
      return all.filter((id) => !liveIds.has(id) && holders.has(id)).map((id) => ({ deviceId: id, label: "A removed device" }));
    } catch { return []; }
  }

  // ---- drawing ---------------------------------------------------------------------------

  function draw() {
    if (!visible) return;
    const views = { loading, locked, "needs-messaging": needsMessaging, setup, waiting, removed, error, library: libraryView, recovery };
    root.innerHTML = (views[ui.view === "locked" ? "locked" : ui.panel === "recovery" ? "recovery" : ui.view] || loading)();
    if (ui.view === "library" && ui.panel !== "recovery") loadThumbs();
    const pre = root.querySelector(".docs-view-text");
    if (pre && ui.viewer?.text != null) pre.textContent = ui.viewer.text; // text, never markup
    root.querySelector("[data-autofocus]")?.focus();
  }

  const pane = (inner) => `<div class="msg-pane docs-pane">${inner}</div>`;
  const busyNote = () => (ui.busy ? `<p class="msg-muted" role="status">${esc(ui.busy)}</p>` : "");

  function loading() { return pane(`<p class="msg-muted">Opening ${esc(ui.title)}…</p>`); }

  // Nothing about the documents shows while locked: no names, no counts.
  function locked() {
    return pane(`<div class="msg-intro docs-locked">
      <h2 class="msg-title">${esc(ui.title)}</h2>
      <p>Locked.</p>
      ${ui.lockError ? `<p class="msg-error" role="alert">${esc(ui.lockError)}</p>` : ""}
      <button type="button" class="primary-btn" data-act="unlock">Unlock</button>
      ${lockPlugin === passkey && passkey ? `<p class="msg-muted">Removed the passkey from this computer? <button type="button" class="link-btn" data-act="passkey-reset">Start over on this browser</button> (your documents stay safe; this browser gets the keys again from your phone).</p>` : ""}
    </div>`);
  }

  function needsMessaging() {
    return pane(`<div class="msg-intro">
      <h2 class="msg-title">${esc(ui.title)}</h2>
      <p>Documents are locked with the same keys as secure messages, so they're set up there first.</p>
      <p class="msg-muted">${deps.isNative ? "Open Messages and set it up on this iPhone, then come back." : "Open Messages and link this browser from your phone, then come back."}</p>
      <button type="button" class="primary-btn" data-act="open-messages">Open Messages</button>
    </div>`);
  }

  function setup() {
    const who = ui.kind === "household" ? `you and ${esc(otherNames().join(" and ") || "your household")}` : "only you";
    const body = ui.isPhone
      ? `<p>Your documents are encrypted on your devices before they're stored. Only ${who} can open them; the storage service and the app's server see scrambled bytes.</p>
         ${ui.kind === "personal" ? `<p class="msg-muted">Next you'll get a recovery code to print and keep somewhere safe.</p>` : ""}
         <button type="button" class="primary-btn" data-act="create">Set up ${esc(ui.title)}</button>`
      : `<p>Set up ${esc(ui.title)} on your phone first. This browser gets the key from it.</p>
         <button type="button" class="secondary-btn" data-act="reload">Check again</button>`;
    return pane(`<div class="msg-intro"><h2 class="msg-title">${esc(ui.title)}</h2>${body}${busyNote()}${errorNote()}</div>`);
  }

  function waiting() {
    const hint = ui.kind === "household" && ui.unverified.length
      ? `<p class="msg-muted">If ${esc(ui.unverified.join(" and "))} set this up, you need to verify each other in Messages first (scan the code between your phones).</p>
         <button type="button" class="secondary-btn" data-act="open-messages">Open Messages</button>`
      : "";
    const restore = ui.isPhone && ui.hasRecovery
      ? `<details class="msg-details"><summary>New phone? Use your recovery code</summary>
          <form class="msg-form" data-form="restore">
            <label class="msg-field">Recovery code<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-…" required></label>
            <button type="submit" class="primary-btn">Restore</button>
          </form></details>`
      : "";
    if (ui.behind) {
      return pane(`<div class="msg-intro">
        <h2 class="msg-title">${esc(ui.title)}</h2>
        <p>Your key changed after ${esc(otherNames().join(" and ") || "the other phone")} last opened ${esc(ui.title)}, so the newest documents can't come from there.</p>
        <p class="msg-muted">Restore with your recovery code: it brings everything back and locks out your lost phone.</p>
        ${restore.replace("<details class=\"msg-details\">", "<details class=\"msg-details\" open>")}${busyNote()}${errorNote()}
      </div>`);
    }
    return pane(`<div class="msg-intro">
      <h2 class="msg-title">${esc(ui.title)}</h2>
      <p>This device is waiting for the key.</p>
      <p class="msg-muted">Open ${esc(ui.title)} on a device that already has it (your phone${ui.kind === "household" ? ", or theirs" : ""}) and it's shared with this one.</p>
      <button type="button" class="secondary-btn" data-act="reload">Check again</button>
      ${hint}${restore}${busyNote()}${errorNote()}
    </div>`);
  }

  function removed() {
    return pane(`<div class="msg-intro"><h2 class="msg-title">${esc(ui.title)}</h2>
      <p>This device was removed from ${esc(ui.title)} and can't open it any more.</p>
      <p class="msg-muted">To use it here again, link it in Messages again.</p></div>`);
  }

  function error() {
    return pane(`<div class="msg-intro"><h2 class="msg-title">${esc(ui.title)}</h2>
      <p class="msg-error">${esc(ui.error || "Something went wrong.")}</p>
      <button type="button" class="secondary-btn" data-act="reload">Try again</button></div>`);
  }

  const errorNote = () => (ui.error ? `<p class="msg-error" role="alert">${esc(ui.error)}</p>` : "");

  function recovery() {
    return pane(`<div class="msg-intro docs-recovery">
      <h2 class="msg-title">Your recovery code</h2>
      <p>Print this or write it down, and keep it somewhere safe and private. If you lose your phone, this code is the only way back into your documents.</p>
      <p class="docs-code" data-recovery-code>${esc(ui.code)}</p>
      <p class="msg-muted">It isn't saved anywhere you can see again. Making a new code later replaces this one.</p>
      <div class="msg-row"><button type="button" class="secondary-btn" data-act="print-code">Print</button></div>
      <form class="msg-form" data-form="confirm-code">
        <p>To check you have it, type groups ${ui.codeCheck[0] + 1} and ${ui.codeCheck[1] + 1} from your copy.</p>
        <label class="msg-field">Group ${ui.codeCheck[0] + 1}<input name="a" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
        <label class="msg-field">Group ${ui.codeCheck[1] + 1}<input name="b" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" required></label>
        ${errorNote()}
        <button type="submit" class="primary-btn">I've put it somewhere safe</button>
      </form></div>`);
  }

  function visibleFiles() {
    const q = ui.query.trim().toLowerCase();
    return ui.files.filter((f) => {
      if (ui.folder === "trash") { if (!f.deletedAt) return false; } else if (f.deletedAt) return false;
      if (ui.folder !== "all" && ui.folder !== "trash" && f.folderId !== ui.folder) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || f.tags.some((t) => t.toLowerCase().includes(q))
        || (texts.get(f.id) || "").includes(q);
    });
  }

  // SEARCH INSIDE DOCUMENTS: the text read from a scan's pages (the encrypted "text"
  // part). Fetched only when someone searches, at most TEXT_PARALLEL at a time, each
  // file once: kept lower-cased in memory and, encrypted, in this device's store, so
  // the next search costs nothing. Dropped from memory on lock.
  const texts = new Map(); // fileId → lower-cased text
  const TEXT_PARALLEL = 3;
  let textsLoading = null;
  function loadTexts() {
    if (textsLoading || !session) return;
    const scope = ui.scope;
    const my = gen;
    const todo = ui.files.filter((f) => (f.parts || []).includes("text") && !texts.has(f.id));
    if (!todo.length) return;
    textsLoading = (async () => {
      let found = false;
      const worker = async () => {
        for (let f = todo.shift(); f; f = todo.shift()) {
          if (my !== gen || scope !== ui.scope) return;
          try {
            let t = await store.get(`text:${f.id}`);
            if (typeof t !== "string") { t = (await library.searchText(scope, f.id)).toLowerCase(); await store.set(`text:${f.id}`, t); }
            texts.set(f.id, t);
            found = true;
          } catch { texts.set(f.id, ""); } // unreadable: not searched again this session
        }
      };
      await Promise.all(Array.from({ length: TEXT_PARALLEL }, worker));
      if (found && my === gen && scope === ui.scope && ui.query.trim()) redrawSearch();
    })().finally(() => { textsLoading = null; });
  }
  function redrawSearch() {
    const box = root.querySelector("[data-search]");
    const pos = box?.selectionStart ?? null;
    const focused = box && document.activeElement === box;
    draw();
    const again = root.querySelector("[data-search]");
    if (again && focused) { again.focus(); try { if (pos !== null) again.setSelectionRange(pos, pos); } catch { /* search boxes in some browsers */ } }
  }

  function sidebar() {
    const tab = (key, icon, label, extra = "") => `<button class="article-sidebar-tab${ui.folder === key ? " is-active" : ""}" type="button" data-folder="${esc(key)}"${ui.folder === key ? ' aria-current="true"' : ""}${extra}>${icon}<span>${esc(label)}</span></button>`;
    return `<nav class="article-sidebar docs-sidebar" id="docsSidebar" aria-label="${esc(ui.title)} folders">
      ${tab("all", ICON.all, "All documents")}
      ${ui.folders.map((f) => tab(f.id, f.kind === "receipts" ? ICON.receipt : ICON.folder, f.name)).join("")}
      <button class="article-sidebar-tab" type="button" data-act="new-folder">${ICON.plus}<span>New folder</span></button>
      <div class="watch-sidebar-spacer"></div>
      <div class="article-sidebar-divider"></div>
      ${tab("trash", ICON.trash, "Recently deleted")}
    </nav>`;
  }

  function fileRow(f) {
    const meta = [dateLabel(f.documentDate || f.createdAt), f.pages > 1 ? `${f.pages} pages` : "", sizeLabel(f.size)].filter(Boolean).join(" · ");
    const folder = ui.folder === "all" ? ui.folders.find((x) => x.id === f.folderId)?.name : "";
    const who = ui.kind === "household" && f.addedBy && f.addedBy !== userId ? ` · added by ${esc(nameOf(f.addedBy))}` : "";
    return `<li><button type="button" class="docs-file" data-open="${esc(f.id)}">
      <span class="docs-thumb" data-thumb="${esc(f.id)}" aria-hidden="true">${esc(glyphFor(f.mime))}</span>
      <span class="docs-file-text"><span class="docs-file-name">${esc(f.name)}</span>
      <span class="docs-file-meta">${esc(meta)}${folder ? ` · ${esc(folder)}` : ""}${who}</span></span></button></li>`;
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
          <button class="icon-btn" type="button" data-act="add" title="${scanner ? "Add a file" : "Add a document"}" aria-label="${scanner ? "Add a file" : "Add a document"}">${ICON.add}</button>
          <button class="icon-btn" type="button" data-act="settings" title="Documents settings" aria-label="Documents settings">${ICON.gear}</button>
          <input type="file" data-file-input multiple hidden accept="${esc(MIME_TYPES.join(","))},.heic,.heif" />
        </div>
        ${ui.banners.map((b) => `<p class="msg-banner${b.warn ? " msg-banner-warn" : ""}">${b.html}</p>`).join("")}
        <div class="docs-list-head"><h2 class="docs-heading">${esc(heading)}</h2>${folderTools}</div>
        ${busyNote()}${errorNote()}
        ${list.length ? `<ul class="docs-list">${list.map(fileRow).join("")}</ul>` : `<p class="msg-muted docs-empty">${esc(empty)}</p>`}
      </div>
      ${ui.viewer ? viewerView() : ""}
      ${ui.panel === "settings" ? settingsView() : ""}
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
    else if (v.ready) body = quickLook
      ? `<p class="msg-muted">Tap Open to view it.</p>`
      : `<p class="msg-muted">This kind of file can't be shown here. Use Share to open it in another app.</p>`;
    const inTrash = Boolean(f.deletedAt);
    const folderOptions = ui.folders.map((x) => `<option value="${esc(x.id)}"${x.id === f.folderId ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    return `<div class="docs-viewer" role="dialog" aria-modal="true" aria-label="${esc(f.name)}">
      <div class="docs-viewer-head">
        <button type="button" class="msg-icon-btn" data-act="close-viewer" aria-label="Close">‹</button>
        <h3 class="msg-title">${esc(f.name)}</h3>
        ${v.ready && quickLook ? `<button type="button" class="secondary-btn" data-act="quicklook">Open</button>` : ""}
        ${v.ready && !inTrash ? `<button type="button" class="secondary-btn" data-act="share">Share</button>` : ""}
      </div>
      <div class="docs-viewer-body">${body}</div>
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

  function settingsView() {
    const devices = ui.devices.map((d) => `<li class="msg-toggle-row"><span>${esc(d.label)}${d.thisDevice ? " (this device)" : ""}</span>
      ${ui.isPhone && !d.thisDevice ? `<button type="button" class="link-btn" data-remove-device="${esc(d.deviceId)}">Remove</button>` : ""}</li>`).join("");
    return `<div class="docs-viewer docs-settings" role="dialog" aria-modal="true" aria-label="Documents settings">
      <div class="docs-viewer-head"><button type="button" class="msg-icon-btn" data-act="close-panel" aria-label="Close">‹</button><h3 class="msg-title">Documents settings</h3></div>
      <div class="msg-pane">
        <h4 class="msg-sub">Storage</h4>
        <p class="msg-muted">${esc(ui.title)} uses ${esc(sizeLabel(ui.usage) || "nothing yet")}. The first 10 GB is free; you'll see a note here at 7 GB.</p>
        ${passkey && (passkeySupported || lockPlugin === passkey) ? `<h4 class="msg-sub">Lock</h4>
          ${lockPlugin === passkey
            ? `<p class="msg-muted">Documents in this browser are locked with a passkey: Touch ID or Windows Hello opens them each time.</p><button type="button" class="secondary-btn" data-act="passkey-off">Turn off the passkey lock</button>`
            : `<p class="msg-muted">Lock Documents in this browser with a passkey (Touch ID or Windows Hello). It encrypts what's kept here, and asks every time you open Documents.</p><button type="button" class="primary-btn" data-act="passkey-on">Lock with a passkey</button>`}` : ""}
        <h4 class="msg-sub">Recovery code</h4>
        ${ui.isPhone ? `<p class="msg-muted">Making a new code replaces the old one, which stops working.</p><button type="button" class="secondary-btn" data-act="new-code">Make a new recovery code</button>` : `<p class="msg-muted">Recovery codes are made on your phone.</p>`}
        <h4 class="msg-sub">Your devices</h4>
        <p class="msg-muted">Removing a device here also changes the keys, so it can't open anything added later or anything still in storage.</p>
        <ul class="msg-members">${devices || `<li class="msg-muted">Loading…</li>`}</ul>
        ${busyNote()}${errorNote()}
      </div></div>`;
  }

  // Thumbnails: from this device's cache, else at most THUMB_PARALLEL fetched at a
  // time (each one row the list already read + one small blob), for the vault on screen.
  const THUMB_PARALLEL = 3;
  let thumbQueue = [];
  let thumbRunning = 0;
  function loadThumbs() {
    const scope = ui.scope;
    thumbQueue = [];
    for (const el of root.querySelectorAll("[data-thumb]")) {
      const id = el.dataset.thumb;
      const f = ui.files.find((x) => x.id === id);
      if (!f || !(f.parts || []).includes("thumb")) continue;
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
        let bytes = await store.get(`thumb:${id}`);
        if (!bytes) {
          try { bytes = await library.thumbnail(scope, id); } catch { thumbs.delete(id); return; }
          if (bytes) await store.set(`thumb:${id}`, bytes);
        }
        if (!bytes) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
        thumbs.set(id, url);
        const live = scope === ui.scope && root.querySelector(`[data-thumb="${CSS.escape(id)}"]`);
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

  // ---- actions ----------------------------------------------------------------------------

  // An action on the vault on screen when it started. If the page moves to another
  // vault (or is hidden) meanwhile, the action still finishes on ITS vault but no
  // longer draws.
  async function run(label, fn) {
    const scope = ui.scope;
    const my = gen;
    ui.busy = label; ui.error = ""; draw();
    let err = "";
    try { await track(() => fn(scope, my)); } catch (e) { err = e?.message || "That didn't work."; }
    if (my !== gen || scope !== ui.scope) return;
    ui.busy = ""; ui.error = err; draw();
  }

  // Shows a new code; it can only be dismissed after re-typing two of its groups.
  function showCode(code) {
    const a = Math.floor(Math.random() * 8);
    let b = Math.floor(Math.random() * 7);
    if (b >= a) b++;
    ui.code = code; ui.codeCheck = [Math.min(a, b), Math.max(a, b)]; ui.panel = "recovery";
  }

  function confirmCode(form) {
    const groups = String(ui.code || "").split("-");
    const norm = (x) => String(x || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (norm(form.a.value) !== groups[ui.codeCheck[0]] || norm(form.b.value) !== groups[ui.codeCheck[1]]) {
      ui.error = "Those don't match the code. Check your copy and try again.";
      draw();
      return;
    }
    ui.code = null; ui.codeCheck = null; ui.panel = null; ui.error = "";
    draw();
  }

  async function createVault() {
    const scope = ui.scope;
    const kind = ui.kind;
    await run("Setting up…", async () => {
      await vaults.createVault(scope);
      await library.ensureStartingFolders(scope, { receipts: kind === "household", names: STARTING_FOLDERS[kind] });
      // A code made before this vault existed doesn't open it: Personal always gets a
      // code now, and Household gets a new one if a code already exists.
      if (kind === "personal" || (await server.recoveryKey(userId))) showCode((await vaults.newRecoveryCode(allScopes())).code);
      await vaults.grantPending(scope).catch(() => {});
      if (scope === ui.scope) await load();
    });
  }

  async function newCode() {
    await run("Making a new code…", async () => {
      try {
        showCode((await vaults.newRecoveryCode(allScopes())).code);
      } catch (e) {
        if (e?.code !== "WAITING") throw e;
        // After a lost phone AND a lost code: a vault this phone can't open would be
        // left out, and the old code stops working, so it could never come back.
        const missing = [];
        for (const scope of allScopes()) if ((await vaults.status(scope)).state !== "ready" && (await server.vault(scope))) missing.push(scope === deps.personalScope?.() ? "Personal Documents" : "Household Documents");
        if (!window.confirm(`${missing.join(" and ")} can't be opened on this phone. If you still have your old recovery code, restore with it first. Make a new code without ${missing.length > 1 ? "them" : "it"}? Your old code will stop working, and ${missing.join(" and ")} can't be recovered after that.`)) return;
        showCode((await vaults.newRecoveryCode(allScopes(), { allowWaiting: true })).code);
      }
    });
  }

  async function restoreWith(codeText) {
    await run("Restoring… this takes a few seconds.", async () => {
      const out = await vaults.restore(codeText, allScopes());
      if (out.results.some((r) => r.state === "restored")) await deps.signOutOtherSessions?.(); // every old device was removed
      const short = out.results.filter((r) => r.state === "short");
      if (out.code) showCode(out.code);
      if (short.length) deps.toast?.("Restored, but some newer documents need your other devices: open Documents on one of them.");
      if (!out.results.some((r) => r.state === "restored" || r.state === "short")) throw new Error("That code doesn't cover these documents.");
      await load();
    });
  }

  // ---- scanning (iPhone: Apple's document camera, §9) ----------------------------------
  // Up to 30 pages, joined into one PDF on the phone, with the page text read on the
  // phone (kept encrypted with the file, for search). It goes into the open folder and
  // opens, so it can be renamed and filed at once. Tracked like an upload: a lock while
  // the camera is up doesn't lose the scan.
  const scanner = deps.nativeDocumentScanner?.() || null;
  const fromB64Std = (b64) => { // an indexed loop: Uint8Array.from with a mapper is ~45× slower on a big scan
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const scanDocument = () => track(async () => {
    const scope = ui.scope;
    const my = gen;
    const here = () => my === gen && scope === ui.scope;
    const folderId = ui.folders.some((f) => f.id === ui.folder) ? ui.folder : null;
    let r;
    try {
      r = await scanner.scan({ pdf: true, maxPages: 30, maxDimension: 2000, quality: 0.8, ocr: true });
    } catch (e) {
      if (here()) { ui.error = e?.message || "The camera couldn't open."; draw(); }
      return;
    }
    if (!r || r.cancelled || !r.pdf) return;
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const name = `Scan ${today.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
    if (here()) { ui.busy = "Encrypting and uploading the scan…"; ui.error = ""; draw(); }
    let id;
    try {
      const content = fromB64Std(r.pdf);
      if (content.length > MAX_FILE_BYTES) throw new Error("That scan is larger than 60 MB. Try fewer pages.");
      const thumb = r.thumb ? fromB64Std(r.thumb) : null;
      const text = (Array.isArray(r.pageText) ? r.pageText : []).join("\n\n").slice(0, SCAN_TEXT_MAX);
      id = await library.addFile(scope, { content, thumb, text, folderId, meta: { name, originalName: `${name}.pdf`, mime: "application/pdf", pages: Math.max(1, Number(r.pageCount) || 1), documentDate: iso } });
      if (thumb) await store.set(`thumb:${id}`, thumb);
    } catch (e) {
      if (here()) { ui.busy = ""; ui.error = e?.message || "The scan couldn't be saved."; draw(); }
      else deps.toast?.("The scan couldn't be saved. Open Documents to try again.");
      return;
    }
    deps.toast?.("Scan added.");
    if (!here()) return;
    ui.busy = "";
    try { await refresh(my, scope); } catch { /* the list catches up next open */ }
    if (here()) { draw(); openFile(id); }
  });

  // Tracked: leaving the page or the app going to the background mid-upload doesn't
  // cut the batch off; it finishes, then the store closes.
  const addFiles = (fileList) => track(() => addFilesNow(fileList));
  async function addFilesNow(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    // The vault and folder this batch was started in, for every file of it: switching
    // view mid-upload must never put a Personal file in Household.
    const scope = ui.scope;
    const my = gen;
    const here = () => my === gen && scope === ui.scope;
    const folderId = ui.folders.some((f) => f.id === ui.folder) ? ui.folder : null;
    let added = 0;
    const problems = [];
    for (const [i, file] of files.entries()) {
      if (here()) { ui.busy = files.length > 1 ? `Encrypting and uploading ${i + 1} of ${files.length}…` : "Encrypting and uploading…"; ui.error = ""; draw(); }
      const mime = mimeForFile(file.name, file.type);
      if (!mime) { problems.push(`${file.name}: that kind of file can't be kept here`); continue; }
      if (file.size > MAX_FILE_BYTES) { problems.push(`${file.name}: larger than 60 MB`); continue; }
      try {
        const content = new Uint8Array(await file.arrayBuffer());
        const thumb = mime.startsWith("image/") ? await makeThumb(file) : null;
        const pages = mime === "application/pdf" ? pdfPageCount(content) : 1;
        const id = await library.addFile(scope, { content, thumb, folderId, meta: { name: displayName(file.name), originalName: file.name.slice(0, 200), mime, pages } });
        if (thumb) await store.set(`thumb:${id}`, thumb);
        added++;
      } catch (e) { problems.push(`${file.name}: ${e.message}`); }
    }
    if (added) deps.toast?.(added === 1 ? "Added." : `Added ${added} documents.`);
    if (!here()) {
      if (problems.length) deps.toast?.(`${problems.length} ${problems.length === 1 ? "file wasn't" : "files weren't"} added. Open Documents to try again.`);
      return;
    }
    ui.busy = "";
    if (added) { try { await refresh(my, scope); } catch (e) { problems.push(e.message); } }
    if (!here()) return;
    ui.error = problems.join(". ");
    draw();
  }

  async function openFile(id) {
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
      if (mime.startsWith("image/") || mime === "application/pdf") {
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

  // iPhone: Apple's viewer (Quick Look) for the decrypted file: every page of a PDF,
  // Word/Excel/PowerPoint, zoom. Its temp copy has complete file protection and is
  // deleted when the viewer closes or the app goes to the background.
  const quickLook = deps.nativeAttachmentPreview?.() || null;
  async function openQuickLook() {
    const v = ui.viewer;
    const f = ui.files.find((x) => x.id === v?.id);
    if (!f || !v.bytes || !quickLook) return;
    let bin = "";
    for (let i = 0; i < v.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, v.bytes.subarray(i, i + 0x8000));
    const ext = Object.entries(EXT_MIME).find(([, m]) => m === f.mime)?.[0] || "";
    const filename = /\.[a-z0-9]{1,5}$/i.test(f.name) || !ext ? f.name : `${f.name}.${ext}`;
    try { await quickLook.openData({ data: btoa(bin), filename, mimeType: f.mime, sensitive: true }); }
    catch (e) { ui.error = e?.message || "It couldn't be opened."; draw(); }
  }

  // Turning the passkey lock on or off moves Documents' store in this browser to a
  // database encrypted with the other key, then deletes the old one. Needs the store
  // open (it is, in ⚙).
  async function moveStore(fromDb, toDb, getRawWrapKey) {
    if (fromDb === toDb) throw new Error("documents: moving the store onto itself");
    const backend = await idbBackend({ dbName: toDb, getRawWrapKey });
    const next = createKeystore(backend);
    await next.clear();
    await copyStore(store, next);
    try { session.backend.close(); } catch { /* already closed */ }
    session = { backend };
    store = next;
    vaults = createDocumentsVaults({
      server, store, account, userId,
      scopeMembers: async (scope) => { const h = household(); return h && h.scope === scope ? h.members.map((m) => m.user_id) : []; },
    });
    library = createDocumentsLibrary({ server, storage, vaults, store, userId, blobCache: openedFilesCache(store) });
    await deleteMessagingStore(fromDb);
  }
  async function passkeyOn() {
    await run("Making the passkey…", async () => {
      const { key } = await passkey.setup();
      const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
      await moveStore(DOCUMENTS_DB, WEB_LOCKED_DB, async () => raw);
      lockPlugin = passkey;
      deps.toast?.("Documents in this browser are now locked with a passkey.");
    });
  }
  // The passkey is gone (deleted from the computer): this browser's locked store can
  // never be opened again, so it's deleted and Documents starts over here. Nothing
  // is lost: the files are in storage and the keys come back by grant.
  async function passkeyReset() {
    if (!window.confirm("Start over on this browser? Its locked copy of Documents is deleted; your documents stay safe and this browser gets the keys again after you open Documents on your phone.")) return;
    gen++;
    try { session?.backend.close(); } catch { /* not open */ }
    session = null; store = null; vaults = null; library = null;
    await deleteMessagingStore(WEB_LOCKED_DB);
    passkey.forget();
    lockPlugin = null;
    ui.lockError = "";
    await load();
  }
  async function passkeyOff() {
    if (!window.confirm("Turn off the passkey lock? Documents in this browser will open without Touch ID.")) return;
    await run("Turning off the lock…", async () => {
      await moveStore(WEB_LOCKED_DB, DOCUMENTS_DB, getRawWrapKey);
      lockPlugin = null;
      passkey.forget();
      deps.toast?.("The passkey lock is off.");
    });
  }

  async function share() {
    const v = ui.viewer;
    const f = ui.files.find((x) => x.id === v?.id);
    if (!f || !v.bytes) return;
    const ext = Object.entries(EXT_MIME).find(([, m]) => m === f.mime)?.[0] || "bin";
    const fileName = /\.[a-z0-9]{1,5}$/i.test(f.name) ? f.name : `${f.name}.${ext}`;
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

  async function settings() {
    ui.panel = "settings";
    ui.devices = [];
    draw();
    if (passkey) { try { passkeySupported = await passkey.supported(); } catch { passkeySupported = false; } }
    try { ui.devices = await account.myDevices(); } catch (e) { ui.error = e.message; }
    draw();
  }

  async function removeDevice(deviceId) {
    const d = ui.devices.find((x) => x.deviceId === deviceId) || ui.staleDevices.find((x) => x.deviceId === deviceId);
    if (!window.confirm(`Remove ${d?.label || "this device"}? It won't be able to open Documents or Messages, and you'll get a new recovery code. Your other devices are also signed out of Live and sign in again once.`)) return;
    await run("Removing and changing the keys…", async () => {
      await vaults.removeDevice(deviceId, allScopes());
      await deps.signOutOtherSessions?.(); // the removed device's Live sign-in ends too
      ui.devices = await account.myDevices().catch(() => ui.devices);
      showCode((await vaults.newRecoveryCode(allScopes())).code);
    });
  }

  async function rekeyStale() {
    if (!window.confirm("Change the keys so the removed device can't open these documents? You'll get a new recovery code.")) return;
    await run("Changing the keys…", async () => {
      for (const d of ui.staleDevices) await vaults.removeDevice(d.deviceId, allScopes());
      await deps.signOutOtherSessions?.();
      showCode((await vaults.newRecoveryCode(allScopes())).code);
    });
  }

  // The iPhone app's web view ignores window.print() and pop-ups, so there the code
  // goes to the share sheet as a short text file (its Print button prints it).
  async function printCode() {
    if (deps.isNative) {
      const text = `Documents recovery code\n\n${ui.code}\n\nKeep this somewhere safe and private. It opens your Documents if your phone is lost.\nMade ${new Date().toLocaleDateString()}\n`;
      try {
        const { saveFile } = await import("../save-file.js");
        await saveFile(new Blob([text], { type: "text/plain" }), "Documents recovery code.txt", { title: "Documents recovery code" });
      } catch (e) { ui.error = e.message; draw(); }
      return;
    }
    const w = window.open("", "_blank", "width=600,height=500");
    if (!w) { deps.toast?.("Write the code down instead: printing was blocked."); return; }
    w.document.title = "Documents recovery code";
    const body = w.document.body;
    body.style.fontFamily = "system-ui, sans-serif";
    body.style.padding = "40px";
    const h = w.document.createElement("h1"); h.textContent = "Documents recovery code"; body.appendChild(h);
    const p = w.document.createElement("p"); p.textContent = "Keep this somewhere safe and private. It opens your Documents if your phone is lost."; body.appendChild(p);
    const c = w.document.createElement("p"); c.textContent = ui.code; c.style.font = "600 22px ui-monospace, Menlo, monospace"; c.style.letterSpacing = "0.08em"; body.appendChild(c);
    const d = w.document.createElement("p"); d.textContent = `Made ${new Date().toLocaleDateString()}`; body.appendChild(d);
    w.focus();
    w.print();
  }

  // ---- events -----------------------------------------------------------------------------

  root.addEventListener("click", async (e) => {
    const t = e.target;
    const folderBtn = t.closest("[data-folder]");
    if (folderBtn) {
      ui.folder = folderBtn.dataset.folder;
      root.querySelector("#docsSidebar")?.classList.remove("is-expanded");
      draw();
      return;
    }
    const openBtn = t.closest("[data-open]");
    if (openBtn) { openFile(openBtn.dataset.open); return; }
    const rm = t.closest("[data-remove-device]");
    if (rm) { removeDevice(rm.dataset.removeDevice); return; }
    const act = t.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "open-messages") deps.openMessages?.();
    else if (act === "unlock") { ui.lockError = ""; load(); }
    else if (act === "reload") { ui.error = ""; ui.view = "loading"; draw(); load(); }
    else if (act === "create") createVault();
    else if (act === "new-code") newCode();
    else if (act === "print-code") printCode();
    else if (act === "toggle-sidebar") {
      const sb = root.querySelector("#docsSidebar");
      if (window.innerWidth <= 680) sb?.classList.toggle("is-expanded"); else sb?.classList.toggle("is-collapsed");
    } else if (act === "add") root.querySelector("[data-file-input]")?.click();
    else if (act === "scan") scanDocument();
    else if (act === "settings") settings();
    else if (act === "close-panel") { ui.panel = null; ui.error = ""; draw(); }
    else if (act === "close-viewer") { closeViewer(); ui.error = ""; draw(); }
    else if (act === "share") share();
    else if (act === "quicklook") openQuickLook();
    else if (act === "passkey-on") passkeyOn();
    else if (act === "passkey-reset") passkeyReset();
    else if (act === "passkey-off") passkeyOff();
    else if (act === "rekey") rekeyStale();
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
      await run("Adding the folder…", async (scope, my) => { const id = await library.addFolder(scope, name.slice(0, 200), { sort }); if (my === gen) ui.folder = id; await refresh(my, scope); });
    } else if (act === "rename-folder") {
      const f = ui.folders.find((x) => x.id === ui.folder);
      const name = window.prompt("Folder name", f?.name || "")?.trim();
      if (!f || !name || name === f.name) return;
      await run("Renaming…", async (scope, my) => { await library.renameFolder(scope, f.id, name.slice(0, 200)); await refresh(my, scope); });
    } else if (act === "delete-folder") {
      const f = ui.folders.find((x) => x.id === ui.folder);
      if (!f || !window.confirm(`Remove “${f.name}”? Its documents go to Recently deleted for ${RECENTLY_DELETED_DAYS} days.`)) return;
      await run("Removing the folder…", async (scope, my) => { await library.deleteFolder(scope, f.id); if (my === gen) ui.folder = "all"; await refresh(my, scope); });
    }
  });

  root.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === "restore") restoreWith(form.code.value);
    else if (form.dataset.form === "edit") saveEdit(form);
    else if (form.dataset.form === "confirm-code") confirmCode(form);
  });

  root.addEventListener("input", (e) => {
    if (!e.target.matches("[data-search]")) return;
    ui.query = e.target.value;
    const pos = e.target.selectionStart;
    draw();
    const box = root.querySelector("[data-search]");
    if (box) { box.focus(); try { box.setSelectionRange(pos, pos); } catch { /* search boxes in some browsers */ } }
    if (ui.query.trim().length >= 2) loadTexts();
  });

  root.addEventListener("change", (e) => {
    if (e.target.matches("[data-file-input]")) { addFiles(e.target.files); e.target.value = ""; }
  });

  // Drag and drop on the laptop (decision 9).
  root.addEventListener("dragover", (e) => {
    if (ui.view !== "library" || !e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    root.querySelector("[data-drop]")?.classList.add("is-drop-target");
  });
  root.addEventListener("dragleave", (e) => {
    if (e.target.closest?.("[data-drop]") && !root.contains(e.relatedTarget)) root.querySelector("[data-drop]")?.classList.remove("is-drop-target");
  });
  root.addEventListener("drop", (e) => {
    if (ui.view !== "library" || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    root.querySelector("[data-drop]")?.classList.remove("is-drop-target");
    addFiles(e.dataTransfer.files);
  });

  // The app going to the background (switching apps, locking the phone) re-locks too.
  function onVisibility() {
    if (document.visibilityState !== "hidden" || !lockPlugin) return;
    lock(); // draws the locked screen (or empties the hidden page)
  }
  document.addEventListener("visibilitychange", onVisibility);

  return {
    async show(scope, { kind = "household", title = "Documents" } = {}) {
      visible = true;
      if (scope !== ui.scope) {
        closeViewer();
        Object.assign(ui, { scope, kind, title, view: "loading", folder: "all", query: "", folders: [], files: [], banners: [], panel: ui.panel === "recovery" ? "recovery" : null, error: "", busy: "" });
      } else Object.assign(ui, { kind, title });
      if (!scope) { ui.view = "error"; ui.error = kind === "household" ? "You're not in a household yet." : "Personal Documents isn't available."; draw(); return; }
      draw();
      try { await load(); } catch (e) {
        if (gen !== loadGen) return; // a lock or another show took over: never draw over it
        ui.view = "error"; ui.error = e?.message || "Something went wrong."; draw();
      }
    },
    hide() {
      visible = false;
      closeViewer();
      gen++;
      lock(); // leaving the page re-locks it (no grace period)
    },
    destroy() {
      visible = false;
      gen++;
      closeViewer();
      document.removeEventListener("visibilitychange", onVisibility);
      for (const url of thumbs.values()) if (url) URL.revokeObjectURL(url);
      thumbs.clear();
      root.innerHTML = "";
      try { msgBackend.close(); session?.backend.close(); } catch { /* already closed */ }
      session = null;
    },
    get _debug() { return { vaults, library, ui, locked: !session }; },
  };
}
