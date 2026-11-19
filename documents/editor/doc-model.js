// The document's data (WORD_PROCESSOR_DESIGN.md §3, §6): one Y.Doc per document, its
// stored form, saving (merge first, then write) and version slots. No DOM, no network:
// the store passed in does the I/O (documents/editor/store-everyday.js, the Safe's).
//
// Y.Doc layout:
//   "default"   XmlFragment  the body (Tiptap Collaboration's field)
//   "header" / "footer" / "headerFirst" / "footerFirst"   XmlFragments (Pages mode)
//   "settings"  Map          page setup and modes (DEFAULT_SETTINGS)
//   "comments"  Map          threadId → Map { quote, resolved, createdBy, createdAt, replies: Array }
//
// Stored form ("content" part): "LDOC" + version byte + deflate(Yjs update). Yjs merges
// never conflict, so saving is: read what's stored, merge it in, write the result if
// it differs from what was stored. A write another device made between our read and
// our write can be lost from storage, but never from that device, which writes it
// again the next time it saves or opens (repairOnOpen).

import * as Y from "yjs";
import { deflateSync, inflateSync } from "fflate";

const MAGIC = [0x4c, 0x44, 0x4f, 0x43]; // "LDOC"
const FORMAT = 1;
export const DOC_MIME = "application/vnd.live.doc";
export const MAX_DOC_BYTES = 60 * 1024 * 1024;

export const PAGE_SIZES = Object.freeze({
  letter: { label: "Letter (8.5\" × 11\")", w: 8.5, h: 11 },
  legal: { label: "Legal (8.5\" × 14\")", w: 8.5, h: 14 },
  a4: { label: "A4 (8.27\" × 11.69\")", w: 8.27, h: 11.69 },
  a5: { label: "A5 (5.83\" × 8.27\")", w: 5.83, h: 8.27 },
  tabloid: { label: "Tabloid (11\" × 17\")", w: 11, h: 17 },
});
export const DEFAULT_SETTINGS = Object.freeze({
  pageless: false,
  pageSize: "letter",
  landscape: false,
  marginTop: 1, marginBottom: 1, marginLeft: 1, marginRight: 1, // inches
  pageColor: "#ffffff",
  headerFooter: false,
  differentFirst: false,
  pageNumberStart: 1,
  showWordCount: false,
});

const clampNum = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

// Settings as stored, checked (anyone in the scope can write the map).
export function readSettings(ydoc) {
  const m = ydoc.getMap("settings");
  const g = (k) => (m.has(k) ? m.get(k) : DEFAULT_SETTINGS[k]);
  return {
    pageless: Boolean(g("pageless")),
    pageSize: PAGE_SIZES[g("pageSize")] ? g("pageSize") : "letter",
    landscape: Boolean(g("landscape")),
    marginTop: clampNum(g("marginTop"), 0, 4, 1),
    marginBottom: clampNum(g("marginBottom"), 0, 4, 1),
    marginLeft: clampNum(g("marginLeft"), 0, 4, 1),
    marginRight: clampNum(g("marginRight"), 0, 4, 1),
    pageColor: /^#[0-9a-f]{6}$/i.test(String(g("pageColor"))) ? g("pageColor") : "#ffffff",
    headerFooter: Boolean(g("headerFooter")),
    differentFirst: Boolean(g("differentFirst")),
    pageNumberStart: Math.round(clampNum(g("pageNumberStart"), 0, 9999, 1)),
    showWordCount: Boolean(g("showWordCount")),
  };
}
export function writeSettings(ydoc, patch) {
  const m = ydoc.getMap("settings");
  ydoc.transact(() => { for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_SETTINGS) m.set(k, v); });
}

// Page box in inches (orientation applied).
export function pageBox(settings) {
  const s = PAGE_SIZES[settings.pageSize] || PAGE_SIZES.letter;
  return settings.landscape ? { w: s.h, h: s.w } : { w: s.w, h: s.h };
}

// ---- stored form ---------------------------------------------------------------------------

export function encodeContent(update) {
  const body = deflateSync(update, { level: 6 });
  const out = new Uint8Array(5 + body.length);
  out.set(MAGIC, 0);
  out[4] = FORMAT;
  out.set(body, 5);
  return out;
}

export function decodeContent(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 6) throw new Error("doc: empty");
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC[i]) throw new Error("doc: not a Live document");
  if (bytes[4] !== FORMAT) throw new Error("doc: made by a newer version of Live");
  const out = inflateSync(bytes.subarray(5));
  if (out.length > 200 * 1024 * 1024) throw new Error("doc: too large");
  return out;
}

export const isDocContent = (bytes) => bytes instanceof Uint8Array && bytes.length >= 6 && MAGIC.every((b, i) => bytes[i] === b);

// The document's stored bytes from a Y.Doc.
export const docToContent = (ydoc) => encodeContent(Y.encodeStateAsUpdate(ydoc));

export function docFromContent(bytes, ydoc = new Y.Doc()) {
  Y.applyUpdate(ydoc, decodeContent(bytes), "load");
  return ydoc;
}

// True when b has nothing a lacks and vice versa (same inserts and deletes).
export function sameState(a, b) {
  return Y.equalSnapshots(Y.snapshot(a), Y.snapshot(b));
}

// ---- saving --------------------------------------------------------------------------------

// store: { loadContent() → bytes | null, saveContent(bytes) }.
// Merges what's stored into ydoc (origin "remote"), then writes ydoc if storage lacks
// anything it has. Returns { wrote, merged, bytes }.
export async function mergeAndSave(ydoc, store, { force = false } = {}) {
  const stored = await store.loadContent();
  let storedDoc = null;
  let merged = false;
  if (stored) {
    storedDoc = docFromContent(stored);
    const before = Y.snapshot(ydoc);
    // The whole stored update: a delete-only change wouldn't show in a state-vector diff.
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(storedDoc), "remote");
    merged = !Y.equalSnapshots(before, Y.snapshot(ydoc));
  }
  if (!force && storedDoc && sameState(ydoc, storedDoc)) return { wrote: false, merged, bytes: stored };
  const bytes = docToContent(ydoc);
  if (bytes.length > MAX_DOC_BYTES) throw new Error("This document is too large to save (over 60 MB).");
  await store.saveContent(bytes);
  return { wrote: true, merged, bytes };
}

// ---- plain text (search, word count, file list) ------------------------------------------------

// Plain text of a ProseMirror node (blocks on their own lines).
export function nodeText(node) {
  return node.textBetween(0, node.content.size, "\n", (leaf) => {
    if (leaf.type.name === "smartChip") return leaf.attrs.label || "";
    if (leaf.type.name === "footnote") return "";
    if (leaf.type.name === "hardBreak") return "\n";
    return "";
  });
}

export function countWords(text) {
  const t = String(text || "").trim();
  if (!t) return { words: 0, characters: 0, charactersNoSpaces: 0 };
  const words = t.split(/[\s—]+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
  return { words, characters: [...t].length, charactersNoSpaces: [...t.replace(/\s+/g, "")].length };
}

// ---- version history (§6): bounded slots ---------------------------------------------------------

export const SNAPSHOT_EVERY_MS = 15 * 60 * 1000;
export const SLOT_RE = /^(h(0[0-9]|1[0-9]|2[0-3])|d(0[1-9]|[12][0-9]|3[01])|w([0-4][0-9]|5[0-2])|n[0-9a-f]{32})$/;
const HOUR = 3600e3;
const DAY = 24 * HOUR;

// Weeks since 1970-01-05 (a Monday), wrapped onto 53 slots.
export function weekSlot(ms) {
  const weeks = Math.floor((ms - Date.UTC(1970, 0, 5)) / (7 * DAY));
  return `w${String(((weeks % 53) + 53) % 53).padStart(2, "0")}`;
}

// The automatic slots a snapshot taken at `ms` goes in: always this hour's; this day's
// and this week's when their row is missing or more than an hour old (so a busy day
// keeps writing three objects only once an hour). rows: [{ slot, savedAt }].
export function slotsFor(ms, rows = []) {
  const d = new Date(ms);
  const hour = `h${String(d.getUTCHours()).padStart(2, "0")}`;
  const day = `d${String(d.getUTCDate()).padStart(2, "0")}`;
  const week = weekSlot(ms);
  const savedAt = (slot) => {
    const r = rows.find((x) => x.slot === slot);
    return r ? Date.parse(r.savedAt) : 0;
  };
  const out = [hour];
  if (ms - savedAt(day) > HOUR) out.push(day);
  if (ms - savedAt(week) > HOUR) out.push(week);
  return out;
}

// The versions worth listing, newest first: slots still inside their window (an hour
// slot written today, a day slot this month, a week slot this year, named ones always),
// with copies of the same snapshot shown once (the named one wins).
export function liveVersions(rows, now = Date.now()) {
  const fresh = rows.filter((r) => {
    const age = now - Date.parse(r.savedAt);
    if (!SLOT_RE.test(r.slot) || !(age >= -HOUR)) return false;
    if (r.slot[0] === "h") return age < DAY;
    if (r.slot[0] === "d") return age < 31 * DAY;
    if (r.slot[0] === "w") return age < 53 * 7 * DAY;
    return true;
  });
  fresh.sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt) || (a.slot[0] === "n" ? -1 : b.slot[0] === "n" ? 1 : 0));
  const out = [];
  for (const r of fresh) {
    const dup = out.find((x) => Math.abs(Date.parse(x.savedAt) - Date.parse(r.savedAt)) < 60e3 && (x.slot[0] !== "n" || r.slot[0] !== "n"));
    if (dup) { if (r.slot[0] === "n" && dup.slot[0] !== "n") out[out.indexOf(dup)] = r; continue; }
    out.push(r);
  }
  return out;
}

export function namedSlot() {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `n${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}

// ---- restore ---------------------------------------------------------------------------------

// Makes `ydoc`'s body, headers, footers and settings equal to the version's, as a
// normal edit (so everyone sees it, and it can be undone or restored again). Comment
// threads are kept as they are now. `toPm(fragment) → json` / `fromPm(json, fragment)`
// convert through the editor's schema (passed in to keep this module DOM-free).
export function restoreInto(ydoc, versionDoc, { fragments = ["default", "header", "footer", "headerFirst", "footerFirst"], copyFragment }) {
  ydoc.transact(() => {
    for (const name of fragments) copyFragment(versionDoc.getXmlFragment(name), ydoc.getXmlFragment(name));
    const from = versionDoc.getMap("settings");
    const to = ydoc.getMap("settings");
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
      if (from.has(k)) to.set(k, from.get(k)); else to.delete(k);
    }
  }, "restore");
}

// ---- comments --------------------------------------------------------------------------------

const cleanText = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);

export function addThread(ydoc, { id, quote, text, user }) {
  const threads = ydoc.getMap("comments");
  ydoc.transact(() => {
    const t = new Y.Map();
    t.set("quote", cleanText(quote, 300));
    t.set("resolved", false);
    t.set("createdBy", user.id);
    t.set("createdAt", Date.now());
    const replies = new Y.Array();
    replies.push([{ id: `${id}-0`, by: user.id, name: cleanText(user.name, 80), text: cleanText(text, 5000), at: Date.now() }]);
    t.set("replies", replies);
    threads.set(id, t);
  });
}

export function replyTo(ydoc, threadId, { text, user }) {
  const t = ydoc.getMap("comments").get(threadId);
  if (!t) return false;
  const replies = t.get("replies");
  replies.push([{ id: `${threadId}-${Date.now().toString(36)}`, by: user.id, name: cleanText(user.name, 80), text: cleanText(text, 5000), at: Date.now() }]);
  if (t.get("resolved")) t.set("resolved", false);
  return true;
}

export function editReply(ydoc, threadId, replyId, text, userId) {
  const t = ydoc.getMap("comments").get(threadId);
  if (!t) return false;
  const replies = t.get("replies");
  const arr = replies.toArray();
  const i = arr.findIndex((r) => r.id === replyId);
  if (i < 0 || arr[i].by !== userId) return false;
  ydoc.transact(() => { replies.delete(i, 1); replies.insert(i, [{ ...arr[i], text: cleanText(text, 5000), edited: Date.now() }]); });
  return true;
}

export function deleteReply(ydoc, threadId, replyId, userId) {
  const threads = ydoc.getMap("comments");
  const t = threads.get(threadId);
  if (!t) return false;
  const replies = t.get("replies");
  const arr = replies.toArray();
  const i = arr.findIndex((r) => r.id === replyId);
  if (i < 0 || arr[i].by !== userId) return false;
  if (i === 0) { threads.delete(threadId); return "thread"; } // deleting the first comment removes the thread, as Docs
  replies.delete(i, 1);
  return true;
}

export const setResolved = (ydoc, threadId, resolved) => {
  const t = ydoc.getMap("comments").get(threadId);
  if (t) t.set("resolved", Boolean(resolved));
  return Boolean(t);
};

export function listThreads(ydoc) {
  const out = [];
  ydoc.getMap("comments").forEach((t, id) => {
    if (!(t instanceof Y.Map)) return;
    out.push({
      id, quote: String(t.get("quote") || ""), resolved: Boolean(t.get("resolved")), createdBy: t.get("createdBy") || null,
      createdAt: Number(t.get("createdAt")) || 0, replies: (t.get("replies")?.toArray?.() || []).filter((r) => r && typeof r === "object"),
    });
  });
  return out;
}

// @mentions in a comment: the ids of the people named (by display name) in the text.
export function mentionsIn(text, people) {
  const found = new Set();
  for (const p of people) {
    const n = String(p.name || "").trim();
    if (n && new RegExp(`(^|\\s)@${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) found.add(p.id);
  }
  return [...found];
}

export { Y };
