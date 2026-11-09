// Browser side of scripts/qa-docs-editor.mjs: opens the word processor on a stand-in
// store (blobs and version rows on the QA server) with a BroadcastChannel standing in
// for Supabase Realtime, so two pages in one browser can edit together.
import { openDocEditor } from "/documents/editor/editor.js";

const params = new URLSearchParams(location.search);
const who = params.get("who") || "luke";
const ME = who === "luke" ? { id: "11111111-1111-4111-8111-111111111111", name: "Luke" } : { id: "22222222-2222-4222-8222-222222222222", name: "Marijane" };
const PEOPLE = [{ id: "11111111-1111-4111-8111-111111111111", name: "Luke" }, { id: "22222222-2222-4222-8222-222222222222", name: "Marijane" }];
const FILE = { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: params.get("name") || "QA document", scope: "g-qa" };

const blob = async (key, init) => fetch(`/qa-blob/${key}`, init);
let rows = [];
const store = {
  kind: "everyday", scope: FILE.scope, fileId: FILE.id, channel: `livedoc:${FILE.scope}:${FILE.id}`, encrypt: null,
  async loadContent() { const r = await blob("content"); return r.status === 404 ? null : new Uint8Array(await r.arrayBuffer()); },
  async saveContent(bytes) { window.__saves = (window.__saves || 0) + 1; await blob("content", { method: "PUT", body: bytes }); },
  async saveRow(r) { window.__row = r; },
  async rename(n) { window.__renamed = n; },
  images: {
    put: async (id, bytes) => { await blob(`i${id}`, { method: "PUT", body: bytes }); },
    get: async (id) => new Uint8Array(await (await blob(`i${id}`)).arrayBuffer()),
  },
  versions: {
    async list() { rows = await (await fetch("/qa-rows")).json(); return rows; },
    cached: () => rows,
    async put(slot, bytes, { name = null } = {}) {
      await blob(`v${slot}`, { method: "PUT", body: bytes });
      await fetch("/qa-rows", { method: "POST", body: JSON.stringify({ slot, name, savedBy: ME.id, size: bytes.length }) });
      rows = await (await fetch("/qa-rows")).json();
    },
    get: async (slot) => new Uint8Array(await (await blob(`v${slot}`)).arrayBuffer()),
    rename: async () => {},
  },
};

// Realtime stand-in: presence by join/here/leave messages on a BroadcastChannel.
function liveOpen(topic, h) {
  const bc = new BroadcastChannel(`qa-${topic}`);
  const peers = new Map();
  let meta = null;
  const announce = () => h.presence([...(meta ? [meta] : []), ...peers.values()]);
  bc.onmessage = (e) => {
    const m = e.data;
    if (m.kind === "join") { peers.set(m.meta.cid, m.meta); bc.postMessage({ kind: "here", meta }); announce(); }
    else if (m.kind === "here" && m.meta) { peers.set(m.meta.cid, m.meta); announce(); }
    else if (m.kind === "leave") { peers.delete(m.cid); announce(); }
    else if (m.kind === "msg") h.message(m.msg);
  };
  return {
    send: (msg) => { window.__liveSent = (window.__liveSent || 0) + 1; bc.postMessage({ kind: "msg", msg }); },
    track: (m) => { meta = m; bc.postMessage({ kind: "join", meta: m }); announce(); },
    close: () => { if (meta) bc.postMessage({ kind: "leave", cid: meta.cid }); bc.close(); },
  };
}

window.__toasts = [];
window.__shared = [];
window.__wp = await openDocEditor({
  store, file: FILE, me: ME, people: PEOPLE, startEditing: true,
  deps: {
    liveOpen, toast: (m) => window.__toasts.push(m),
    chipSource: async (q) => [{ kind: "recipe", refId: "r1", label: "Lemon pasta", sub: "Recipe" }].filter((x) => x.label.toLowerCase().includes(q.toLowerCase())),
    openChip: (kind, id) => { window.__chipOpened = `${kind}:${id}`; },
    share: async (b, name, mime) => { window.__shared.push({ name, mime, size: b.size, bytes: Array.from(new Uint8Array(await b.arrayBuffer()).slice(0, 4)) }); },
  },
  onClose: () => { window.__closed = true; },
});
window.__ready = true;
