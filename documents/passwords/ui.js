// The Passwords pane of the Safe (PASSWORDS_DESIGN.md §5): an entry in the Document
// page's sidebar, in Household and Personal, behind the Safe's own unlock (Face ID on
// the iPhone, the passkey in a browser). documents/ui.js owns the page, the lock and
// the sidebar; this module draws the passwords list, a login, the editor, import and
// export, and handles their clicks. Everything is escaped; notes are text, never markup.
//
// createPasswordsPane(host) — host: {
//   root, esc, toast(text), draw(), run(label, fn(scope, isCurrent)),
//   logins() → the logins library, store() → the Safe's locked store,
//   scope() → current scope, kind() → "household" | "personal",
//   otherScope() → { scope, label } | null (where "Move to …" goes),
//   nameOf(userId), userId, isNative }
//
// Rules: decrypted logins live in memory only while the pane is open and are dropped on
// lock (clear()); a copied password is cleared from the clipboard after a minute; the
// leak check runs when the pane opens (at most weekly per password), never in the
// background; nothing polls.

import { generatePassword, strengthLabel, GENERATOR_DEFAULTS } from "./generator.js";
import { displayHost, normalizeSiteInput } from "./site.js";
import { totpNow, isValidTotp } from "./totp.js";
import { readExport, planImport, toCsv, CHECK_TAG } from "./transfer.js";
import { attention, pwnedCount, sha1Hex, REASON_LABEL, LEAK_RECHECK_MS } from "./checks.js";
import { LOGINS_DELETED_DAYS } from "./library.js";

const KEY_ICON = '<svg class="article-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/></svg>';
export const PASSWORDS_ICON = KEY_ICON;
const CLIPBOARD_CLEAR_MS = 60_000;
const FILTERS = [["all", "All"], ["fav", "Favourites"], ["totp", "2FA codes"], ["notes", "Secure notes"], ["attention", "Needs attention"], ["trash", "Recently deleted"]];

export function createPasswordsPane(host) {
  const { esc } = host;
  const st = {
    scope: null, loaded: false, loading: false, list: [], leaks: new Map(), filter: "all", query: "",
    openId: null, editing: null, reveal: false, showHistory: false, plan: null, gen: { ...GENERATOR_DEFAULTS },
  };
  let totpTimer = null;
  let clipToken = 0;
  let leakRun = 0;
  let loadRun = 0; // bumped by clear(): a load from before a lock never writes after it

  // ---- loading ----------------------------------------------------------------------------

  async function load(force = false) {
    const scope = host.scope();
    if (!force && st.loaded && st.scope === scope) return;
    if (st.scope !== scope) clear();
    const my = ++loadRun;
    st.scope = scope; st.loading = true; st.error = "";
    host.draw();
    try {
      const list = await host.logins().list(scope);
      if (my !== loadRun) return;
      st.list = list;
      st.loaded = true;
      host.logins().purgeExpired(scope).catch(() => {});
      await loadLeakCache();
      checkLeaks();
    } catch (e) {
      if (my !== loadRun) return;
      st.error = e?.message || "Couldn't open passwords.";
    }
    if (my !== loadRun) return;
    st.loading = false;
    if (host.scope() === scope) host.draw();
  }

  async function loadLeakCache() {
    const store = host.store();
    for (const l of st.list) {
      const c = await store.get(`leak:${l.id}`);
      if (c && typeof c.n === "number") st.leaks.set(l.id, c);
    }
  }

  // At most 3 lookups at a time; a password is looked up again a week later, or when it
  // changes (the cache keeps its hash, inside the Safe's encrypted store).
  async function checkLeaks() {
    const my = ++leakRun;
    const scope = st.scope;
    const store = host.store();
    const todo = [];
    for (const l of st.list) {
      if (l.deletedAt || l.kind === "note" || !l.password) continue;
      todo.push(l);
    }
    let changed = false;
    const worker = async () => {
      for (let l = todo.shift(); l; l = todo.shift()) {
        if (my !== leakRun || scope !== st.scope) return;
        try {
          const h = await sha1Hex(l.password);
          const c = st.leaks.get(l.id);
          if (c && c.h === h && Date.now() - c.at < LEAK_RECHECK_MS) continue;
          const n = await pwnedCount(l.password);
          const rec = { h, n, at: Date.now() };
          st.leaks.set(l.id, rec);
          await store.set(`leak:${l.id}`, rec);
          if (!c || (c.n > 0) !== (n > 0)) changed = true;
        } catch { /* offline: try next time */ }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (changed && my === leakRun && scope === st.scope && host.scope() === scope) host.draw();
  }

  // Dropped on lock and when the scope changes.
  function clear() {
    stopTotp();
    leakRun++;
    loadRun++;
    Object.assign(st, { loaded: false, loading: false, list: [], leaks: new Map(), openId: null, editing: null, reveal: false, showHistory: false, plan: null, error: "" });
  }

  // ---- drawing -----------------------------------------------------------------------------

  const leakCounts = () => new Map([...st.leaks].map(([id, c]) => [id, c.n]));
  const live = () => st.list.filter((l) => !l.deletedAt);
  const flags = () => attention(live(), leakCounts());

  function visible() {
    const q = st.query.trim().toLowerCase();
    const f = flags();
    return st.list
      .filter((l) => {
        if (st.filter === "trash") { if (!l.deletedAt) return false; } else if (l.deletedAt) return false;
        if (st.filter === "fav" && !l.favorite) return false;
        if (st.filter === "totp" && !l.totp) return false;
        if (st.filter === "notes" && l.kind !== "note") return false;
        if (st.filter === "attention" && !f.has(l.id)) return false;
        if (!q) return true;
        return [l.title, l.username, ...(l.sites || []).map(displayHost), ...(l.tags || [])].some((x) => String(x || "").toLowerCase().includes(q));
      })
      .sort((a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: "base" }));
  }

  const label = (l) => l.title || displayHost(l.sites?.[0]) || l.username || "Untitled";

  function row(l, f) {
    const sub = l.kind === "note" ? "Secure note" : [l.username, displayHost(l.sites?.[0])].filter(Boolean).join(" · ");
    const reasons = f.get(l.id) || [];
    const warn = ["leaked", "reused", "weak", "check"].filter((r) => reasons.includes(r));
    const initial = esc((label(l)[0] || "?").toUpperCase());
    return `<li><button type="button" class="docs-file pw-row" data-pw-open="${esc(l.id)}">
      <span class="docs-thumb pw-avatar" aria-hidden="true">${initial}</span>
      <span class="docs-file-text"><span class="docs-file-name">${l.favorite ? "★ " : ""}${esc(label(l))}</span>
      <span class="docs-file-meta">${esc(sub)}${warn.length ? ` · <span class="pw-warn">${esc(REASON_LABEL[warn[0]])}</span>` : ""}</span></span></button></li>`;
  }

  // The main panel (the page's sidebar is drawn by documents/ui.js).
  function render({ banners = "", menuButton = "" } = {}) {
    const f = flags();
    const list = visible();
    const n = f.size;
    const chips = FILTERS.map(([k, name]) => `<button type="button" class="pw-chip${st.filter === k ? " is-active" : ""}" data-pw-filter="${k}" aria-pressed="${st.filter === k}">${esc(name)}${k === "attention" && n ? ` (${n})` : ""}</button>`).join("");
    const empty = st.loading ? "Opening passwords…" : st.query ? "Nothing matches that search."
      : st.filter === "trash" ? `Deleted passwords stay here for ${LOGINS_DELETED_DAYS} days.`
      : st.filter === "attention" ? "Nothing needs attention." : "No passwords here yet. Tap + to add one, or import from iCloud or Chrome.";
    return `<div class="podcast-panel watch-page-panel docs-panel pw-panel">
        <div class="discover-head">
          ${menuButton}
          <input type="search" class="discover-search-input" data-pw-search placeholder="Search passwords…" aria-label="Search passwords" autocomplete="off" value="${esc(st.query)}" />
          <button class="icon-btn" type="button" data-pw="import" title="Import passwords" aria-label="Import passwords">${IMPORT_ICON}</button>
          <button class="icon-btn" type="button" data-pw="export" title="Export passwords" aria-label="Export passwords">${EXPORT_ICON}</button>
          <button class="icon-btn" type="button" data-pw="new" title="New password" aria-label="New password">${ADD_ICON}</button>
          <input type="file" data-pw-file accept=".csv,text/csv,.livpw" multiple hidden />
        </div>
        ${banners}
        <div class="pw-chips" role="toolbar" aria-label="Show">${chips}</div>
        ${st.error ? `<p class="msg-banner msg-banner-warn" role="alert">${esc(st.error)}</p>` : ""}
        ${list.length ? `<ul class="docs-list">${list.map((l) => row(l, f)).join("")}</ul>` : `<p class="msg-muted docs-empty">${esc(empty)}</p>`}
      </div>
      ${st.plan ? importView() : st.editing ? editorView() : st.openId ? detailView(f) : ""}`;
  }

  // A sheet over the list. The page's own busy line and errors (from host.run) are
  // repeated inside it, so a failed save isn't hidden behind the sheet.
  const sheet = (title, inner, closeAct = "close") => {
    const busy = host.busy?.() || "", err = host.error?.() || "";
    return `<div class="docs-viewer pw-sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="docs-viewer-head"><button type="button" class="icon-btn" data-pw="${closeAct}" aria-label="Close">✕</button><h2 class="docs-heading">${esc(title)}</h2></div>
      <div class="pw-sheet-body">${busy ? `<p class="msg-muted" role="status">${esc(busy)}</p>` : ""}${err ? `<p class="msg-error" role="alert">${esc(err)}</p>` : ""}${inner}</div></div>`;
  };

  function field(name, value, { secret = false, copy = true, extra = "" } = {}) {
    if (!value) return "";
    const shown = secret && !st.reveal ? "••••••••••" : value;
    return `<div class="pw-field"><span class="pw-field-name">${esc(name)}</span>
      <span class="pw-field-value${secret ? " pw-mono" : ""}">${esc(shown)}</span>
      <span class="pw-field-actions">${secret ? `<button type="button" class="link-btn" data-pw="reveal">${st.reveal ? "Hide" : "Show"}</button>` : ""}${copy ? `<button type="button" class="link-btn" data-pw-copy="${esc(name)}">Copy</button>` : ""}${extra}</span></div>`;
  }

  function detailView(f) {
    const l = st.list.find((x) => x.id === st.openId);
    if (!l) return "";
    const flagged = f.get(l.id) || [];
    const reasons = flagged.map((r) => `<li>${esc(REASON_LABEL[r])}${r === "check" && !l.deletedAt ? ` — compare with Earlier passwords, then <button type="button" class="link-btn" data-pw="checked">mark it checked</button>` : ""}</li>`).join("");
    const other = host.otherScope();
    const by = host.kind() === "household" && l.createdBy && l.createdBy !== host.userId ? `<p class="msg-muted">Added by ${esc(host.nameOf(l.createdBy))}</p>` : "";
    const sites = (l.sites || []).map((s) => `<li><a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(displayHost(s))}</a></li>`).join("");
    const strength = l.password ? `<p class="msg-muted pw-strength">Strength: ${esc(strengthLabel(l.password))}</p>` : "";
    const history = l.history?.length ? (st.showHistory
      ? `<div class="pw-history"><h3>Earlier passwords</h3><ul>${l.history.map((h, i) => `<li><span class="pw-mono">${esc(st.reveal ? h.password : "••••••••")}</span> <span class="msg-muted">until ${esc(new Date(h.changed).toLocaleDateString())}</span> <button type="button" class="link-btn" data-pw-copy-old="${i}">Copy</button></li>`).join("")}</ul></div>`
      : `<button type="button" class="link-btn" data-pw="history">Earlier passwords (${l.history.length})</button>`) : "";
    const actions = l.deletedAt
      ? `<button type="button" class="primary-btn" data-pw="restore">Put back</button>`
      : `<button type="button" class="primary-btn" data-pw="edit">Edit</button>
         <button type="button" class="link-btn" data-pw="favorite">${l.favorite ? "Remove from Favourites" : "Add to Favourites"}</button>
         ${other ? `<button type="button" class="link-btn" data-pw="move">Move to ${esc(other.label)}</button>` : ""}
         <button type="button" class="link-btn pw-danger" data-pw="trash">Delete</button>`;
    const body = `
      ${reasons ? `<div class="msg-banner msg-banner-warn"><strong>Needs attention</strong><ul>${reasons}</ul></div>` : ""}
      ${field("Username", l.username)}
      ${field("Password", l.password, { secret: true })}
      ${strength}
      ${l.totp ? `<div class="pw-field"><span class="pw-field-name">2FA code</span><span class="pw-field-value pw-mono pw-totp" data-pw-totp>······</span><span class="pw-field-actions"><span class="msg-muted" data-pw-totp-left></span><button type="button" class="link-btn" data-pw-copy="2FA code">Copy</button></span></div>` : ""}
      ${sites ? `<div class="pw-field"><span class="pw-field-name">${l.sites.length > 1 ? "Sites" : "Site"}</span><ul class="pw-sites">${sites}</ul></div>` : ""}
      ${l.exactSite ? `<p class="msg-muted">Fills on this exact address only.</p>` : ""}
      ${l.notes ? `<div class="pw-field"><span class="pw-field-name">Notes</span><pre class="pw-notes">${esc(l.notes)}</pre></div>` : ""}
      ${l.tags?.length ? `<p class="msg-muted">${l.tags.map(esc).join(" · ")}</p>` : ""}
      ${history}
      ${by}
      <div class="msg-row pw-actions">${actions}</div>`;
    if (l.totp && !l.deletedAt) queueMicrotask(startTotp); else stopTotp();
    return sheet(label(l), body);
  }

  function editorView() {
    const e = st.editing;
    const isNote = e.kind === "note";
    const genOpts = `<div class="pw-gen" data-pw-gen-box hidden>
        <label>Length <input type="range" min="12" max="64" value="${st.gen.length}" data-pw-gen-length /> <span data-pw-gen-len>${st.gen.length}</span></label>
        <label class="pw-toggle-row"><input type="checkbox" class="live-toggle" data-pw-gen-symbols ${st.gen.symbols ? "checked" : ""} /> Symbols</label>
        <label class="pw-toggle-row"><input type="checkbox" class="live-toggle" data-pw-gen-digits ${st.gen.digits ? "checked" : ""} /> Numbers</label>
        <button type="button" class="link-btn" data-pw="regen">Another one</button></div>`;
    const body = `<form class="pw-form" data-pw-form autocomplete="off">
      ${e.id ? "" : `<div class="pw-chips"><button type="button" class="pw-chip${isNote ? "" : " is-active"}" data-pw-kind="login">Password</button><button type="button" class="pw-chip${isNote ? " is-active" : ""}" data-pw-kind="note">Secure note</button></div>`}
      <label>Name<input type="text" name="title" maxlength="200" value="${esc(e.title || "")}" ${isNote ? "required" : ""} /></label>
      ${isNote ? "" : `
      <label>Website<textarea name="sites" rows="2" placeholder="netflix.com" autocapitalize="off" spellcheck="false">${esc((e.sites || []).join("\n"))}</textarea></label>
      <p class="msg-muted pw-hint">One per line if it's used on more than one site.</p>
      <label class="pw-toggle-row"><input type="checkbox" class="live-toggle" name="exactSite" ${e.exactSite ? "checked" : ""} /> This address only</label>
      <label>Username or email<input type="text" name="username" maxlength="512" value="${esc(e.username || "")}" autocapitalize="off" spellcheck="false" /></label>
      <label>Password<span class="pw-pass-row"><input type="password" name="password" maxlength="1024" value="${esc(e.password || "")}" autocapitalize="off" spellcheck="false" autocomplete="new-password" data-pw-pass /><button type="button" class="link-btn" data-pw="toggle-pass">Show</button><button type="button" class="link-btn" data-pw="generate">Generate</button></span></label>
      <p class="msg-muted pw-hint" data-pw-strength>${esc(strengthLabel(e.password || ""))}</p>
      ${genOpts}
      <label>2FA secret <span class="msg-muted">(optional)</span><input type="text" name="totp" maxlength="1024" value="${esc(e.totp || "")}" placeholder="otpauth://… or the setup key" autocapitalize="off" spellcheck="false" /></label>`}
      <label>Notes<textarea name="notes" rows="${isNote ? 8 : 3}" maxlength="10000">${esc(e.notes || "")}</textarea></label>
      ${st.error ? `<p class="msg-banner msg-banner-warn" role="alert">${esc(st.error)}</p>` : ""}
      <div class="msg-row"><button type="submit" class="primary-btn">Save</button><button type="button" class="link-btn" data-pw="cancel-edit">Cancel</button></div>
    </form>`;
    return sheet(e.id ? `Edit ${label(e)}` : isNote ? "New secure note" : "New password", body, "cancel-edit");
  }

  function importView() {
    const p = st.plan;
    const body = `<p>${esc(p.files.join(", "))}</p>
      <ul class="pw-import-sum">
        <li>${p.add.length} new</li>
        <li>${p.update.length} updated (a second password goes into its history and is listed under Needs attention)</li>
        <li>${p.same} already here</li>
        ${p.skipped ? `<li>${p.skipped} rows skipped (no username or password)</li>` : ""}
      </ul>
      <p class="msg-muted">They go into ${esc(host.kind() === "household" ? "Household — shared with your household" : "Personal")}.</p>
      ${st.error ? `<p class="msg-banner msg-banner-warn" role="alert">${esc(st.error)}</p>` : ""}
      <div class="msg-row"><button type="button" class="primary-btn" data-pw="import-go" ${p.add.length + p.update.length ? "" : "disabled"}>Import</button><button type="button" class="link-btn" data-pw="import-cancel">Cancel</button></div>`;
    return sheet("Import passwords", body, "import-cancel");
  }

  // ---- 2FA ticking (local only: no network) ---------------------------------------------------

  let tick = null;
  function stopTotp() { if (totpTimer) { clearInterval(totpTimer); totpTimer = null; } }
  function startTotp() {
    if (totpTimer) { tick?.(); return; } // a redraw made a new element: fill it now
    tick = async () => {
      const l = st.list.find((x) => x.id === st.openId);
      const el = host.root.querySelector("[data-pw-totp]");
      if (!l?.totp || !el) return stopTotp();
      try {
        const { code, remaining } = await totpNow(l.totp);
        el.textContent = `${code.slice(0, Math.ceil(code.length / 2))} ${code.slice(Math.ceil(code.length / 2))}`;
        const left = host.root.querySelector("[data-pw-totp-left]");
        if (left) left.textContent = `${remaining}s`;
      } catch { el.textContent = "Bad 2FA secret"; }
    };
    tick();
    totpTimer = setInterval(tick, 1000);
  }

  // ---- actions ---------------------------------------------------------------------------------

  async function copy(text, what) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch { host.toast?.("Couldn't copy."); return; }
    const token = ++clipToken;
    host.toast?.(`${what} copied. It's cleared from the clipboard in a minute.`);
    setTimeout(() => { if (token === clipToken) navigator.clipboard.writeText("").catch(() => {}); }, CLIPBOARD_CLEAR_MS);
  }

  const current = () => st.list.find((x) => x.id === st.openId);

  function readForm(form) {
    const e = st.editing;
    const fd = new FormData(form);
    const out = { kind: e.kind || "login", title: String(fd.get("title") || "").trim(), notes: String(fd.get("notes") || "") };
    if (out.kind === "note") return { ...out, sites: [], username: "", password: "", totp: "", exactSite: false };
    const sites = [];
    for (const line of String(fd.get("sites") || "").split(/\n/)) {
      if (!line.trim()) continue;
      const s = normalizeSiteInput(line);
      if (!s) throw new Error(`“${line.trim()}” isn't a web address.`);
      sites.push(s);
    }
    const totp = String(fd.get("totp") || "").trim();
    if (totp && !isValidTotp(totp)) throw new Error("That 2FA secret isn't one Liv can read. Paste the setup key or the otpauth:// address.");
    return { ...out, sites, exactSite: fd.get("exactSite") === "on", username: String(fd.get("username") || "").trim(), password: String(fd.get("password") || ""), totp };
  }

  async function saveForm(form) {
    let fields;
    try { fields = readForm(form); } catch (e) { st.error = e.message; host.draw(); return; }
    if (!fields.title && !fields.sites.length && !fields.username) { st.error = "Give it a name, a website or a username."; host.draw(); return; }
    const prev = st.editing.id ? st.list.find((x) => x.id === st.editing.id) : null;
    st.error = "";
    await host.run("Saving…", async (scope, isCurrent) => {
      const id = await host.logins().save(scope, prev, { ...fields, tags: prev?.tags || [], favorite: prev?.favorite || false });
      st.editing = null; st.openId = id;
      st.list = await host.logins().list(scope);
      if (isCurrent()) checkLeaks();
    });
  }

  async function startImport(files) {
    const entries = [];
    const names = [];
    let skipped = 0;
    try {
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is too large for a passwords export.`);
        const r = readExport(await file.text());
        entries.push(...r.entries); skipped += r.skipped;
        names.push(`${file.name} (${r.format === "icloud" ? "iCloud Passwords" : "Chrome"})`);
      }
    } catch (e) { st.error = e.message; host.draw(); return; }
    const plan = planImport(live(), entries);
    st.plan = { ...plan, files: names, skipped };
    st.error = "";
    host.draw();
  }

  async function runImport() {
    const p = st.plan;
    await host.run("Importing…", async (scope) => {
      await host.logins().addMany(scope, p.add);
      for (const u of p.update) {
        const prev = st.list.find((x) => x.id === u.id);
        if (prev) await host.logins().save(scope, prev, { ...u.login, password: prev.password, history: u.login.history, tags: u.login.tags });
      }
      st.plan = null;
      st.list = await host.logins().list(scope);
      host.toast?.(`Imported ${p.add.length + p.update.length}. Delete the export file now: it isn't encrypted.`);
      checkLeaks();
    });
  }

  async function exportNow() {
    const mode = window.prompt("Export as:\n1 — Encrypted backup (needs a passphrase to open)\n2 — CSV for Apple Passwords or another app (NOT encrypted)", "1");
    if (!mode) return;
    const logins = live();
    const csv = toCsv(logins);
    const { saveFile } = await import("../../save-file.js");
    const day = new Date().toISOString().slice(0, 10);
    if (mode.trim() === "2") {
      if (!window.confirm("The CSV file holds every password in plain text. Anyone with the file can read them. Export anyway?")) return;
      await saveFile(new Blob([csv], { type: "text/csv" }), `Liv passwords ${day}.csv`, { title: "Passwords export" });
      return;
    }
    const pass = window.prompt("Choose a passphrase for the backup (at least 8 characters). Without it the file can't be opened.");
    if (!pass) return;
    if (window.prompt("Type the passphrase again") !== pass) { host.toast?.("The passphrases didn't match."); return; }
    await host.run("Encrypting…", async () => {
      const { encryptBackup } = await import("../crypto/index.js");
      const file = encryptBackup(pass, new TextEncoder().encode(csv));
      await saveFile(new Blob([file], { type: "application/octet-stream" }), `Liv passwords ${day}.livpw`, { title: "Passwords backup" });
    });
  }

  // A .livpw backup picked in Import: opened with its passphrase, then read as a CSV.
  async function readPicked(files) {
    const out = [];
    for (const f of files) {
      if (!/\.livpw$/i.test(f.name)) { out.push(f); continue; }
      const pass = window.prompt(`Passphrase for ${f.name}`);
      if (!pass) return null;
      try {
        const { decryptBackup } = await import("../crypto/index.js");
        const text = new TextDecoder().decode(decryptBackup(pass, new Uint8Array(await f.arrayBuffer())));
        out.push({ name: f.name.replace(/\.livpw$/i, ".csv"), size: text.length, text: async () => text });
      } catch (e) { st.error = e.message.replace(/^backup: /, ""); host.draw(); return null; }
    }
    return out;
  }

  // ---- events (delegated from documents/ui.js) ---------------------------------------------------

  async function onClick(t) {
    const openBtn = t.closest("[data-pw-open]");
    if (openBtn) { st.openId = openBtn.dataset.pwOpen; st.reveal = false; st.showHistory = false; st.error = ""; host.draw(); return true; }
    const filt = t.closest("[data-pw-filter]");
    if (filt) { st.filter = filt.dataset.pwFilter; host.draw(); return true; }
    const kind = t.closest("[data-pw-kind]");
    if (kind) { st.editing = { ...st.editing, kind: kind.dataset.pwKind }; host.draw(); return true; }
    const cp = t.closest("[data-pw-copy]");
    if (cp) {
      const l = current();
      const what = cp.dataset.pwCopy;
      if (what === "2FA code") { try { copy((await totpNow(l.totp)).code, what); } catch { /* bad secret */ } }
      else copy(what === "Password" ? l?.password : l?.username, what);
      return true;
    }
    const old = t.closest("[data-pw-copy-old]");
    if (old) { copy(current()?.history?.[Number(old.dataset.pwCopyOld)]?.password, "Earlier password"); return true; }
    const act = t.closest("[data-pw]")?.dataset.pw;
    if (!act) return false;
    const l = current();
    if (act === "close") { st.openId = null; stopTotp(); host.draw(); }
    else if (act === "reveal") { st.reveal = !st.reveal; host.draw(); }
    else if (act === "history") { st.showHistory = true; host.draw(); }
    else if (act === "new") { st.editing = { kind: st.filter === "notes" ? "note" : "login" }; st.error = ""; host.draw(); }
    else if (act === "edit" && l) { st.editing = { ...l }; st.error = ""; host.draw(); }
    else if (act === "cancel-edit") { st.editing = null; st.error = ""; host.draw(); }
    else if (act === "toggle-pass") {
      const inp = host.root.querySelector("[data-pw-pass]");
      if (inp) { inp.type = inp.type === "password" ? "text" : "password"; t.textContent = inp.type === "password" ? "Show" : "Hide"; }
    } else if (act === "generate" || act === "regen") {
      host.root.querySelector("[data-pw-gen-box]")?.removeAttribute("hidden");
      setPassword(generatePassword(st.gen));
    } else if (act === "checked" && l) {
      await host.run("Saving…", async (scope) => { await host.logins().save(scope, l, { tags: (l.tags || []).filter((t) => t !== CHECK_TAG) }); st.list = await host.logins().list(scope); });
    } else if (act === "favorite" && l) {
      await host.run("Saving…", async (scope) => { await host.logins().save(scope, l, { favorite: !l.favorite }); st.list = await host.logins().list(scope); });
    } else if (act === "trash" && l) {
      if (!window.confirm(`Delete “${label(l)}”? It stays in Recently deleted for ${LOGINS_DELETED_DAYS} days.`)) return true;
      await host.run("Deleting…", async (scope) => { await host.logins().trash(scope, l.id); st.openId = null; st.list = await host.logins().list(scope); });
    } else if (act === "restore" && l) {
      await host.run("Putting back…", async (scope) => { await host.logins().restore(scope, l.id); st.list = await host.logins().list(scope); });
    } else if (act === "move" && l) {
      const other = host.otherScope();
      if (!other || !window.confirm(`Move “${label(l)}” to ${other.label}?${host.kind() === "personal" ? " Everyone in your household will see it." : ""}`)) return true;
      await host.run("Moving…", async (scope) => { await host.logins().move(scope, l, other.scope); st.openId = null; st.list = await host.logins().list(scope); host.toast?.(`Moved to ${other.label}.`); });
    } else if (act === "import") host.root.querySelector("[data-pw-file]")?.click();
    else if (act === "import-cancel") { st.plan = null; st.error = ""; host.draw(); }
    else if (act === "import-go") runImport();
    else if (act === "export") exportNow().catch((e) => host.toast?.(e?.message || "Export didn't work."));
    else return false;
    return true;
  }

  function setPassword(pw) {
    const inp = host.root.querySelector("[data-pw-pass]");
    if (!inp) return;
    inp.value = pw;
    inp.type = "text";
    const s = host.root.querySelector("[data-pw-strength]");
    if (s) s.textContent = strengthLabel(pw);
  }

  function onInput(t) {
    if (t.matches("[data-pw-search]")) {
      st.query = t.value;
      const pos = t.selectionStart;
      host.draw();
      const box = host.root.querySelector("[data-pw-search]");
      if (box) { box.focus(); try { box.setSelectionRange(pos, pos); } catch { /* */ } }
      return true;
    }
    if (t.matches("[data-pw-pass]")) {
      const s = host.root.querySelector("[data-pw-strength]");
      if (s) s.textContent = strengthLabel(t.value);
      return true;
    }
    if (t.matches("[data-pw-gen-length]")) {
      st.gen.length = Number(t.value);
      const lbl = host.root.querySelector("[data-pw-gen-len]");
      if (lbl) lbl.textContent = t.value;
      setPassword(generatePassword(st.gen));
      return true;
    }
    return false;
  }

  async function onChange(t) {
    if (t.matches("[data-pw-gen-symbols]") || t.matches("[data-pw-gen-digits]")) {
      st.gen.symbols = Boolean(host.root.querySelector("[data-pw-gen-symbols]")?.checked);
      st.gen.digits = Boolean(host.root.querySelector("[data-pw-gen-digits]")?.checked);
      setPassword(generatePassword(st.gen));
      return true;
    }
    if (t.matches("[data-pw-file]")) {
      const picked = await readPicked([...t.files]);
      t.value = "";
      if (picked?.length) startImport(picked);
      return true;
    }
    return false;
  }

  function onSubmit(form) {
    if (!form.matches("[data-pw-form]")) return false;
    saveForm(form);
    return true;
  }

  async function importFiles(fileList) {
    const picked = await readPicked([...fileList]);
    if (picked?.length) startImport(picked);
  }

  return { render, load, clear, onClick, onInput, onChange, onSubmit, importFiles, get state() { return st; } };
}

const ADD_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const IMPORT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>';
const EXPORT_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5M5 21h14"/></svg>';
