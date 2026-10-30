// The Messages tab of the Message page (MESSAGING_DESIGN.md §11). Loaded lazily the
// first time the tab opens, so libsodium never touches the app's boot.
//
// mountMessages(root, deps) → { show(), hide() }
// deps (from app.js): userId, baseUrl(), headers(), isNative, nativeMessagingKeys(),
//   nativeQrScan(), toast(text), cardSources() → { recipe:[…], event:[…], trip:[…],
//   shop:[…] } each { ref, title, subtitle?, date?, thumb? }, openCard(kind, ref) → bool,
//   onUnreadChange(hasUnread).
//
// Everything a person typed or a message carries is escaped before it reaches the
// page. Card thumbnails are never loaded automatically (§5): they'd tell the sender
// when and where a card was read.
//
// Fetching (§9, CLAUDE.md Supabase cautions): on show, on focus, and every 30 s only
// while this tab is visible and the app is in the foreground. Nothing runs when hidden.

import qrcode from "qrcode-generator";
import { loadSodium } from "./crypto/index.js";
import { createMessagingServer, createRestTransport } from "./server.js";
import { createKeystore, idbBackend } from "./keystore.js";
import { createMessagingAccount, MessagingError } from "./account.js";
import { createMessagingEngine } from "./engine.js";
import { TIMER_CHOICES } from "./envelope.js";
import { runCryptoSelfTest } from "./crypto/selftest.js";

const POLL_MS = 30 * 1000;
const LINK_POLL_MS = 3000;
const LINK_POLL_MAX = 100; // ~5 minutes

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TIMER_LABEL = { 3600: "1 hour", 86400: "1 day", 604800: "1 week", 2419200: "4 weeks" };
const timerLabel = (secs) => (secs ? TIMER_LABEL[secs] || `${secs}s` : "Off");
const CARD_LABEL = { recipe: "Recipe", event: "Event", trip: "Trip", shop: "Shop item" };

function qrSvg(text) {
  const q = qrcode(0, "L"); // shown on a clean screen: low error correction keeps it less dense
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

function timeLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export async function mountMessages(root, deps) {
  root.innerHTML = `<div class="msg-pane"><p class="msg-muted">Loading secure messages…</p></div>`;
  await loadSodium();
  const keyPlugin = deps.nativeMessagingKeys?.();
  const getRawWrapKey = keyPlugin
    ? async () => { const { key } = await keyPlugin.wrapKey(); return Uint8Array.from(atob(key), (c) => c.charCodeAt(0)); }
    : async () => null;
  const store = createKeystore(await idbBackend({ getRawWrapKey }));
  // Another account used messaging in this browser before: wipe it now, so nothing of
  // theirs (keys, sessions, messages) sits under this sign-in.
  const prior = await store.get("account");
  if (prior && prior.userId !== deps.userId) await store.clear();
  const server = createMessagingServer(createRestTransport({ baseUrl: deps.baseUrl, headers: deps.headers }));
  const userId = deps.userId;
  const account = createMessagingAccount({ server, store, userId });
  const engine = createMessagingEngine({ account, server, store, userId });

  const ui = { view: "loading", convId: null, linkCode: null, linkTries: 0, error: "", busy: false, contacts: null, people: {}, verifyFor: null };
  let pollTimer = null;
  let linkTimer = null;
  let visible = false;

  const names = () => Object.fromEntries((ui.contacts || []).map((c) => [c.user_id, c.display_name || "Someone"]));
  const nameOf = (uid) => (uid === userId ? "You" : names()[uid] || "Someone");
  const convTitle = (c) => c.name || c.members.filter((m) => m !== userId).map(nameOf).join(", ") || "Just you";

  async function loadContacts() {
    if (ui.contacts) return ui.contacts;
    try { ui.contacts = await server.contacts(); } catch { ui.contacts = []; }
    return ui.contacts;
  }

  // ---- rendering ---------------------------------------------------------------------

  function frame(inner, { title = "", back = null, actions = "" } = {}) {
    return `<div class="msg-pane">
      ${title || back ? `<header class="msg-head">${back ? `<button type="button" class="msg-icon-btn" data-act="${back}" aria-label="Back">‹</button>` : ""}<h2 class="msg-title">${title}</h2><div class="msg-head-actions">${actions}</div></header>` : ""}
      ${ui.error ? `<p class="msg-error" role="alert">${esc(ui.error)}</p>` : ""}
      ${inner}
    </div>`;
  }

  async function render() {
    ui.error = ui.error || "";
    let html = "";
    try {
      html = await views[ui.view]();
    } catch (e) {
      html = frame(`<p class="msg-error">${esc(e.message || e)}</p>`, { title: "Messages" });
    }
    root.innerHTML = html;
    const input = root.querySelector("[data-autofocus]");
    if (input && !deps.isNative) input.focus();
    const list = root.querySelector(".msg-thread-list");
    if (list) list.scrollTop = list.scrollHeight;
  }

  const views = {
    loading: async () => frame(`<p class="msg-muted">Loading…</p>`, { title: "Messages" }),

    setup: async () => {
      const st = await account.status();
      if (st.state === "removed") {
        return frame(`<p>This device was removed from your secure messages${deps.isNative ? "" : " or messaging was reset on your phone"}.</p>
          <button type="button" class="primary-btn" data-act="${deps.isNative ? "setup-phone" : "start-link"}">${deps.isNative ? "Set up on this iPhone" : "Link this browser again"}</button>`, { title: "Messages" });
      }
      if (deps.isNative) {
        return frame(`<div class="msg-intro"><h3>Secure messages</h3>
          <p>End-to-end encrypted messages with your household. Only your devices and theirs can read them — not Supabase, not this app's servers.</p>
          <p class="msg-muted">Messages disappear after a week unless a conversation's timer is changed.</p>
          <button type="button" class="primary-btn" data-act="setup-phone" ${ui.busy ? "disabled" : ""}>Set up on this iPhone</button></div>`, { title: "Messages" });
      }
      return frame(`<div class="msg-intro"><h3>Secure messages</h3>
        <p>Your iPhone holds your messaging keys. Link this browser from your phone to read and send messages here.</p>
        <p class="msg-muted">This browser will only see messages sent after it's linked.</p>
        <button type="button" class="primary-btn" data-act="start-link" ${ui.busy ? "disabled" : ""}>Link this browser</button></div>`, { title: "Messages" });
    },

    link: async () => {
      const waiting = ui.linkTries < LINK_POLL_MAX;
      return frame(`<div class="msg-link">
        <p>On your iPhone: <b>Message › Messages › ⋯ › Link a device</b>, then scan this code.</p>
        <div class="msg-qr" aria-label="Link code">${qrSvg(ui.linkCode)}</div>
        <details class="msg-details"><summary>Can't scan? Copy the code</summary>
          <p class="msg-muted">Copy it here, then paste it on your phone (Universal Clipboard works between your Mac and iPhone).</p>
          <textarea class="msg-code" readonly rows="4">${esc(ui.linkCode)}</textarea>
          <button type="button" class="secondary-btn" data-act="copy-link">Copy code</button>
        </details>
        <p class="msg-muted" aria-live="polite">${waiting ? "Waiting for your phone…" : "Stopped waiting."} ${waiting ? "" : `<button type="button" class="link-btn" data-act="resume-link">Check again</button>`}</p>
      </div>`, { title: "Link this browser", back: "cancel-link" });
    },

    list: async () => {
      const convs = await engine.conversations();
      const rows = await Promise.all(convs.map(async (c) => {
        const msgs = (await engine.messages(c.id)).filter((m) => m.type === "text" || m.type === "card" || m.type === "deleted");
        const last = msgs.at(-1);
        const preview = !last ? "No messages yet" : last.type === "card" ? `${CARD_LABEL[last.body.kind] || "Card"}: ${last.body.snapshot.title}` : last.type === "deleted" ? "Message deleted" : last.body.text;
        return `<li><button type="button" class="msg-conv" data-act="open" data-id="${esc(c.id)}">
          <span class="msg-conv-title">${esc(convTitle(c))}${c.unread ? `<span class="msg-dot" aria-label="${c.unread} unread"></span>` : ""}</span>
          <span class="msg-conv-preview">${esc(String(preview).slice(0, 140))}</span>
          <span class="msg-conv-meta">${c.timerSecs ? `⏱ ${esc(timerLabel(c.timerSecs))}` : ""}${last ? ` · ${esc(timeLabel(last.sentAtMs))}` : ""}</span>
        </button></li>`;
      }));
      deps.onUnreadChange?.(convs.some((c) => c.unread));
      return frame(convs.length ? `<ul class="msg-conv-list">${rows.join("")}</ul>` : `<p class="msg-muted">No conversations yet. Tap <b>New</b> to start one.</p>`, {
        title: "Messages",
        actions: `<button type="button" class="secondary-btn" data-act="new">New</button><button type="button" class="msg-icon-btn" data-act="devices" aria-label="Devices and security">⋯</button>`,
      });
    },

    thread: async () => {
      const c = (await engine.conversations()).find((x) => x.id === ui.convId);
      if (!c) { ui.view = "list"; return views.list(); }
      if (c.unread) await engine.markRead(c.id).catch(() => {});
      const { people } = await account.resolveDevices(c.members).catch(() => ({ people: {} }));
      ui.people = people;
      const others = c.members.filter((m) => m !== userId);
      const changed = others.filter((m) => people[m]?.changed);
      const unverified = others.filter((m) => people[m] && !people[m].verified);
      const blocked = others.filter((m) => people[m]?.blocked);
      const banner = blocked.length
        ? `<div class="msg-banner msg-banner-warn" role="alert">${esc(blocked.map(nameOf).join(", "))}'s security code changed since you verified it. Messages won't send until you check it.
            <button type="button" class="link-btn" data-act="verify" data-id="${esc(blocked[0])}">Verify again</button> · <button type="button" class="link-btn" data-act="ack-change" data-id="${esc(blocked[0])}">Send anyway</button></div>`
        : changed.length
        ? `<div class="msg-banner msg-banner-warn">${esc(changed.map(nameOf).join(", "))}'s security code changed. <button type="button" class="link-btn" data-act="verify" data-id="${esc(changed[0])}">Verify</button></div>`
        : unverified.length ? `<div class="msg-banner">Not verified · <button type="button" class="link-btn" data-act="verify" data-id="${esc(unverified[0])}">Verify</button></div>` : "";
      const msgs = await engine.messages(c.id);
      const lastMine = [...msgs].reverse().find((m) => m.from === userId && (m.type === "text" || m.type === "card"));
      const items = msgs.map((m) => {
        if (m.type === "system") return `<li class="msg-system">${esc(systemText(m))}</li>`;
        const mine = m.from === userId;
        const who = !mine && others.length > 1 ? `<span class="msg-from">${esc(nameOf(m.from))}</span>` : "";
        let body;
        if (m.type === "deleted") body = `<span class="msg-muted">Message deleted</span>`;
        else if (m.type === "card") body = cardHtml(m);
        else body = `<span class="msg-text">${esc(m.body.text)}</span>`;
        const read = mine && m.status === "failed"
          ? `<span class="msg-read">Not delivered · <button type="button" class="link-btn" data-act="retry" data-id="${esc(m.id)}">Retry</button></span>`
          : mine && m === lastMine && Object.keys(m.readBy || {}).length ? `<span class="msg-read">Read</span>` : "";
        const menu = m.type !== "deleted" ? `<button type="button" class="msg-more" data-act="msg-menu" data-id="${esc(m.id)}" aria-label="Message options">⋯</button>` : "";
        return `<li class="msg-bubble ${mine ? "is-mine" : ""}">${who}${body}<span class="msg-time">${esc(timeLabel(m.sentAtMs))}</span>${read}${menu}</li>`;
      });
      return frame(`${banner}
        <ol class="msg-thread-list">${items.join("") || `<li class="msg-system">${c.timerSecs ? `Messages here disappear ${esc(timerLabel(c.timerSecs))} after they're read.` : "Messages here don't disappear."}</li>`}</ol>
        <form class="msg-compose" data-form="send">
          <button type="button" class="msg-icon-btn" data-act="card-picker" aria-label="Share a recipe, event, trip or shop item">+</button>
          <textarea name="text" rows="1" maxlength="4000" placeholder="Message" aria-label="Message" data-autofocus data-autogrow></textarea>
          <button type="submit" class="primary-btn">Send</button>
        </form>`, { title: esc(convTitle(c)), back: "to-list", actions: `<button type="button" class="msg-icon-btn" data-act="info" aria-label="Conversation info">ⓘ</button>` });
    },

    new: async () => {
      const contacts = (await loadContacts()).filter((c) => c.user_id !== userId);
      return frame(contacts.length ? `<form data-form="new" class="msg-form">
          <fieldset><legend>People</legend>${contacts.map((c) => `<label class="msg-check"><input type="checkbox" name="m" value="${esc(c.user_id)}"> ${esc(c.display_name || "Someone")}</label>`).join("")}</fieldset>
          <label class="msg-field">Group name (optional)<input type="text" name="name" maxlength="80"></label>
          <button type="submit" class="primary-btn">Start</button>
        </form>` : `<p class="msg-muted">Nobody to message yet — people in your household or business space appear here.</p>`, { title: "New conversation", back: "to-list" });
    },

    info: async () => {
      const c = (await engine.conversations()).find((x) => x.id === ui.convId);
      if (!c) { ui.view = "list"; return views.list(); }
      const contacts = (await loadContacts()).filter((x) => x.user_id !== userId && !c.members.includes(x.user_id));
      const members = c.members.map((m) => `<li>${esc(nameOf(m))}${m !== userId ? ` <span class="msg-muted">${ui.people[m]?.verified ? "✓ verified" : "not verified"}</span>
          <button type="button" class="link-btn" data-act="verify" data-id="${esc(m)}">Verify</button>
          <button type="button" class="link-btn" data-act="remove-member" data-id="${esc(m)}">Remove</button>` : ""}</li>`).join("");
      return frame(`<form data-form="rename" class="msg-form"><label class="msg-field">Name<input type="text" name="name" maxlength="80" value="${esc(c.name || "")}" placeholder="${esc(convTitle(c))}"></label><button type="submit" class="secondary-btn">Save name</button></form>
        <label class="msg-field">Disappearing messages
          <select data-act-change="timer">${[...TIMER_CHOICES, null].map((s) => `<option value="${s ?? "off"}" ${c.timerSecs === s ? "selected" : ""}>${esc(timerLabel(s))}</option>`).join("")}</select></label>
        <h3 class="msg-sub">Members</h3><ul class="msg-members">${members}</ul>
        ${contacts.length ? `<form data-form="add" class="msg-form"><label class="msg-field">Add someone<select name="m">${contacts.map((x) => `<option value="${esc(x.user_id)}">${esc(x.display_name || "Someone")}</option>`).join("")}</select></label><button type="submit" class="secondary-btn">Add</button></form>` : ""}
        <button type="button" class="danger-btn" data-act="leave">Leave conversation</button>`, { title: "Conversation info", back: "to-thread" });
    },

    verify: async () => {
      const other = ui.verifyFor;
      const number = await account.safetyNumberWith(other);
      const code = await account.safetyQrWith(other);
      const verified = (await account.resolveDevices([other])).people[other]?.verified;
      return frame(`<p>Compare with ${esc(nameOf(other))} in person. Either scan their code, or check that the numbers on both phones match.</p>
        <p class="msg-safety" aria-label="Safety number">${esc(number)}</p>
        <div class="msg-qr">${qrSvg(code)}</div>
        <div class="msg-row">
          ${deps.nativeQrScan?.() ? `<button type="button" class="primary-btn" data-act="scan-safety">Scan their code</button>` : ""}
          <button type="button" class="secondary-btn" data-act="${verified ? "unverify" : "mark-verified"}">${verified ? "Clear verified" : "The numbers match"}</button>
        </div>
        <p class="msg-muted">${verified ? "✓ Verified" : "Not verified"}</p>`, { title: `Verify ${esc(nameOf(other))}`, back: ui.convId ? "to-thread" : "devices" });
    },

    devices: async () => {
      const st = await account.status();
      const devices = await account.myDevices().catch(() => []);
      const p = await engine.prefs();
      return frame(`<h3 class="msg-sub">Your devices</h3>
        <ul class="msg-members">${devices.map((d) => `<li>${esc(d.label || (d.kind === "phone" ? "iPhone" : "Browser"))} <span class="msg-muted">${d.kind === "phone" ? "phone" : "linked"}${d.thisDevice ? " · this device" : ""}</span>
          ${(st.kind === "phone" ? !d.thisDevice : d.kind !== "phone") ? `<button type="button" class="link-btn" data-act="remove-device" data-id="${esc(d.deviceId)}">Remove</button>` : ""}</li>`).join("")}</ul>
        ${st.kind === "phone" ? `<div class="msg-row">${deps.nativeQrScan?.() ? `<button type="button" class="primary-btn" data-act="scan-link">Link a device</button>` : ""}
          <button type="button" class="secondary-btn" data-act="paste-link">Paste a link code</button></div>` : ""}
        <label class="msg-toggle-row"><span>Read receipts<br><span class="msg-muted">Off also hides others' receipts from you.</span></span><input type="checkbox" class="live-toggle" data-act-change="receipts" ${p.readReceipts ? "checked" : ""}></label>
        <button type="button" class="secondary-btn" data-act="selftest">Run crypto check</button>
        <p class="msg-muted" id="msgSelftest" aria-live="polite"></p>
        ${st.kind === "phone" ? `<button type="button" class="danger-btn" data-act="reset">Reset messaging…</button>` : ""}`, { title: "Devices & security", back: "to-list" });
    },

    cards: async () => {
      const src = deps.cardSources?.() || {};
      const groups = Object.entries(CARD_LABEL).map(([kind, label]) => {
        const items = (src[kind] || []).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(String(x.ref || ""))).slice(0, 50);
        if (!items.length) return "";
        return `<h3 class="msg-sub">${esc(label)}s</h3><ul class="msg-card-pick">${items.map((x) => `<li><button type="button" class="msg-pick" data-act="send-card" data-kind="${kind}" data-ref="${esc(x.ref)}">${esc(x.title)}${x.subtitle ? ` <span class="msg-muted">${esc(x.subtitle)}</span>` : ""}</button></li>`).join("")}</ul>`;
      }).join("");
      return frame(groups || `<p class="msg-muted">Nothing to share yet.</p>`, { title: "Share", back: "to-thread" });
    },
  };

  function systemText(m) {
    const who = nameOf(m.from);
    switch (m.body?.op) {
      case "renamed": return `${who} renamed the conversation.`;
      case "timer": return `${who} changed disappearing messages.`;
      case "added": return `${who} added someone.`;
      case "removed": return `${who} removed someone.`;
      case "left": return `${who} left.`;
      case "undecryptable": return `A message from ${who} couldn't be decrypted. Asked their device to start over.`;
      default: return "";
    }
  }

  function cardHtml(m) {
    const s = m.body.snapshot || {};
    return `<button type="button" class="msg-card" data-act="open-card" data-kind="${esc(m.body.kind)}" data-ref="${esc(m.body.ref)}">
      <span class="msg-card-kind">${esc(CARD_LABEL[m.body.kind] || "Card")}</span>
      <span class="msg-card-title">${esc(s.title)}</span>
      ${s.subtitle ? `<span class="msg-muted">${esc(s.subtitle)}</span>` : ""}${s.date ? `<span class="msg-muted">${esc(s.date)}</span>` : ""}
    </button>`;
  }

  // ---- actions -------------------------------------------------------------------------

  async function go(view, extra = {}) {
    Object.assign(ui, { view, error: "" }, extra);
    await render();
  }

  async function guarded(fn) {
    if (ui.busy) return;
    ui.busy = true;
    ui.error = "";
    try { await fn(); } catch (e) {
      ui.error = e?.code === "SAFETY_CHANGED"
        ? `${(e.details?.userIds || []).map(nameOf).join(", ")}'s security code changed since you verified it. Verify again, or choose Send anyway in the notice.`
        : e instanceof MessagingError || e?.message ? e.message : String(e);
      await render();
    } finally { ui.busy = false; }
  }

  async function pollLink() {
    clearTimeout(linkTimer);
    if (!visible || ui.view !== "link") return;
    ui.linkTries++;
    const st = await account.finishLink().catch(() => null);
    if (st?.state === "ready") { deps.toast?.("This browser is linked."); await refresh(); return; }
    if (ui.linkTries < LINK_POLL_MAX) linkTimer = setTimeout(pollLink, LINK_POLL_MS);
    else await render();
  }

  async function scan(prompt) {
    const scanner = deps.nativeQrScan?.();
    if (!scanner) return null;
    try { return (await scanner.scan({ prompt })).text; } catch (e) {
      if (/DENIED/.test(String(e?.code || e?.message))) deps.toast?.("Camera access is off for this app in iPhone Settings.");
      return null;
    }
  }

  const actions = {
    "setup-phone": () => guarded(async () => {
      try {
        await account.setupPhone();
      } catch (e) {
        if (e.code !== "IDENTITY_EXISTS") throw e;
        if (!window.confirm("Secure messages are already set up on another phone. Use this iPhone instead? Your other devices will be removed and need linking again, and people you message will see your security code changed.")) return;
        await account.setupPhone({ replaceExisting: true });
      }
      await refresh();
    }),
    "start-link": () => guarded(async () => {
      const label = /Mac/.test(navigator.userAgent) ? "Browser on Mac" : "Browser";
      const code = await account.startLink({ label });
      await go("link", { linkCode: code, linkTries: 0 });
      linkTimer = setTimeout(pollLink, LINK_POLL_MS);
    }),
    "resume-link": async () => { ui.linkTries = 0; await render(); pollLink(); },
    "cancel-link": () => { clearTimeout(linkTimer); return go("setup"); },
    "copy-link": async () => { try { await navigator.clipboard.writeText(ui.linkCode); deps.toast?.("Link code copied."); } catch { root.querySelector(".msg-code")?.select(); } },
    "scan-link": () => guarded(async () => {
      const text = await scan("Scan the code on the browser you're linking");
      if (!text) return;
      const r = await account.approveLink(text);
      deps.toast?.(`Linked ${r.label}.`);
      await go("devices");
    }),
    "paste-link": () => guarded(async () => {
      let text = "";
      try { text = await navigator.clipboard.readText(); } catch { /* fall through */ }
      if (!text?.startsWith("LIVEMSG2:")) text = window.prompt("Paste the link code from the other device") || "";
      if (!text) return;
      const r = await account.approveLink(text);
      deps.toast?.(`Linked ${r.label}.`);
      await go("devices");
    }),
    new: () => go("new"),
    devices: () => go("devices"),
    "to-list": () => go("list", { convId: null }),
    "to-thread": () => go("thread"),
    open: (el) => go("thread", { convId: el.dataset.id }),
    info: () => go("info"),
    verify: (el) => go("verify", { verifyFor: el.dataset.id }),
    "scan-safety": () => guarded(async () => {
      const text = await scan(`Scan ${nameOf(ui.verifyFor)}'s code`);
      if (!text) return;
      const ok = await account.confirmSafetyScan(ui.verifyFor, text);
      deps.toast?.(ok ? `${nameOf(ui.verifyFor)} is verified.` : "That code doesn't match. Don't trust this conversation until it does.");
      await render();
    }),
    "mark-verified": () => guarded(async () => {
      if (!window.confirm("Only mark them verified if every digit matches on both phones.")) return;
      await account.markVerified(ui.verifyFor, true);
      await render();
    }),
    unverify: () => guarded(async () => { await account.markVerified(ui.verifyFor, false); await render(); }),
    "remove-member": (el) => guarded(async () => {
      if (!window.confirm(`Remove ${nameOf(el.dataset.id)} from this conversation?`)) return;
      await engine.removeMember(ui.convId, el.dataset.id);
      await render();
    }),
    leave: () => guarded(async () => {
      if (!window.confirm("Leave this conversation? Its messages are removed from this device.")) return;
      await engine.leave(ui.convId);
      await go("list", { convId: null });
    }),
    "remove-device": (el) => guarded(async () => {
      if (!window.confirm("Remove this device? It stops receiving messages and must be linked again to use them.")) return;
      await account.removeDevice(el.dataset.id);
      await refresh();
    }),
    reset: () => guarded(async () => {
      if (!window.confirm("Reset secure messages? This makes a new security code, removes all your other devices and ends every conversation's encryption session. People you message will see your security code changed.")) return;
      await account.reset(); // clears the store; the Keychain key stays (the open store still uses it)
      deps.toast?.("Messaging was reset. Link your other devices again.");
      await refresh();
    }),
    selftest: async () => {
      const out = root.querySelector("#msgSelftest");
      if (out) out.textContent = "Checking…";
      const r = await runCryptoSelfTest();
      if (out) out.textContent = r.ok ? `All ${r.checks.length} checks passed (${r.ms} ms).` : `Failed: ${r.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`;
    },
    retry: (el) => guarded(async () => { await engine.retry(ui.convId, el.dataset.id); await render(); }),
    "ack-change": (el) => guarded(async () => {
      if (!window.confirm(`Send to ${nameOf(el.dataset.id)} without checking their new security code? Only do this if you know why it changed (a new phone, a reset).`)) return;
      await engine.acknowledgeSafetyChange(el.dataset.id);
      await render();
    }),
    "card-picker": () => go("cards"),
    "send-card": (el) => guarded(async () => {
      const item = (deps.cardSources?.()[el.dataset.kind] || []).find((x) => x.ref === el.dataset.ref);
      if (!item) return;
      await engine.sendCard(ui.convId, { kind: el.dataset.kind, ref: item.ref, snapshot: { title: String(item.title).slice(0, 200), subtitle: item.subtitle ? String(item.subtitle).slice(0, 200) : null, date: item.date || null, thumb: null } });
      await go("thread");
    }),
    "open-card": (el) => {
      if (!deps.openCard?.(el.dataset.kind, el.dataset.ref)) deps.toast?.("That isn't something you can open — it's someone else's private item.");
    },
    "msg-menu": (el) => guarded(async () => {
      const msgs = await engine.messages(ui.convId);
      const m = msgs.find((x) => x.id === el.dataset.id);
      if (!m) return;
      const canEveryone = m.from === userId && Date.now() - m.sentAtMs < 24 * 3600 * 1000;
      if (canEveryone && window.confirm("Delete this message for everyone?")) await engine.deleteForEveryone(ui.convId, m.id);
      else if (window.confirm("Delete this message from this device?")) await engine.deleteForMe(ui.convId, m.id);
      await render();
    }),
  };

  const changes = {
    timer: (el) => guarded(async () => { await engine.setTimer(ui.convId, el.value === "off" ? null : Number(el.value)); await render(); }),
    receipts: (el) => guarded(async () => { await engine.setReadReceipts(el.checked); }),
  };

  const forms = {
    send: (form) => guarded(async () => {
      const text = form.text.value.trim();
      if (!text) return;
      form.text.value = "";
      await engine.sendText(ui.convId, text);
      await render();
    }),
    new: (form) => guarded(async () => {
      const ids = [...form.querySelectorAll("input[name=m]:checked")].map((i) => i.value);
      if (!ids.length) { ui.error = "Pick at least one person."; await render(); return; }
      const c = await engine.createConversation(ids, { name: form.name.value.trim() || null });
      await go("thread", { convId: c.id });
    }),
    rename: (form) => guarded(async () => { await engine.renameGroup(ui.convId, form.name.value.trim() || null); await render(); }),
    add: (form) => guarded(async () => { await engine.addMembers(ui.convId, [form.m.value]); await render(); }),
  };

  root.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el || !root.contains(el)) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el); }
  });
  root.addEventListener("change", (e) => {
    const el = e.target.closest("[data-act-change]");
    if (el) changes[el.dataset.actChange]?.(el);
  });
  root.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    forms[form.dataset.form]?.(form);
  });
  root.addEventListener("input", (e) => {
    const t = e.target;
    if (!t.matches?.("[data-autogrow]")) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.matches(".msg-compose textarea") && !deps.isNative) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  engine.on((ev) => {
    if (!visible) return;
    if (ev.type === "received" || ev.type === "receipt" || ev.type === "conversation") {
      if (["list", "thread", "info"].includes(ui.view)) render();
    }
  });

  // ---- lifecycle ----------------------------------------------------------------------

  async function refresh() {
    const st = await account.status();
    if (st.state !== "ready") {
      if (st.state === "awaiting-link" && ui.view !== "link") {
        ui.linkCode = await account.startLink();
        ui.linkTries = 0;
        await go("link");
        pollLink();
        return;
      }
      if (ui.view !== "link") await go("setup");
      return;
    }
    await account.maintain().catch(() => {});
    await engine.receive().catch(() => {});
    await engine.sweepAll().catch(() => {});
    await loadContacts();
    if (["setup", "loading", "link"].includes(ui.view)) ui.view = "list";
    await render();
  }

  async function tick() {
    if (!visible || document.visibilityState !== "visible") return;
    const st = await account.status().catch(() => null);
    if (st?.state !== "ready") return;
    const r = await engine.receive().catch(() => null);
    await engine.sweepAll().catch(() => {});
    if (r && (r.received || r.dropped) && ["list", "thread"].includes(ui.view)) await render();
  }

  const onFocus = () => tick();
  const onVisibility = () => { if (document.visibilityState === "visible") tick(); };

  return {
    async show() {
      visible = true;
      window.addEventListener("focus", onFocus);
      document.addEventListener("visibilitychange", onVisibility);
      clearInterval(pollTimer);
      pollTimer = setInterval(tick, POLL_MS);
      await refresh();
    },
    hide() {
      visible = false;
      clearInterval(pollTimer);
      clearTimeout(linkTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    },
    // Sign-out: stop everything and let go of the store so it can be deleted.
    destroy() {
      this.hide();
      root.innerHTML = "";
      store.close();
    },
  };
}
