// One open document's life (WORD_PROCESSOR_DESIGN.md §3, §4, §6): load (device copy
// first, then storage), save (merge then write, a few seconds after typing stops and
// on close), the device copy, live co-editing while someone else is in, and version
// snapshots. No DOM beyond page-visibility and online events.
//
// createDocSession({ store, me, liveOpen?, cache? }) → session (see the return value).
// store: documents/editor/store-everyday.js (or the Safe's). cache: cache.js.

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { mergeAndSave, docFromContent, docToContent, slotsFor, liveVersions, namedSlot, SNAPSHOT_EVERY_MS, restoreInto } from "./doc-model.js";
import { connectLive, LIVE_ORIGIN, colorFor } from "./live.js";

const SAVE_IDLE_MS = 2000;
const SAVE_MAX_MS = 10000;
const CACHE_MS = 600;
const ROW_EVERY_MS = 3 * 60 * 1000;

export function createDocSession({ store, me, liveOpen = null, cache = null, getText = null, onRemoteChange = null, now = () => Date.now(), win = globalThis.window }) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  awareness.setLocalStateField("user", { id: me.id, name: me.name, color: colorFor(me.id) });
  const listeners = new Set();
  const state = { status: "loading", lastSaved: 0, error: "", offline: false, peers: [], dirty: false, sinceSnapshot: false };
  const emit = () => { for (const cb of listeners) { try { cb({ ...state }); } catch { /* a listener's problem */ } } };
  const set = (p) => { Object.assign(state, p); emit(); };

  let closed = false;
  let saving = null;
  let idleTimer = null;
  let maxTimer = null;
  let cacheTimer = null;
  let lastRow = 0;
  let lastSnapshot = 0;
  let live = null;
  let lastText = null;

  // ---- loading -------------------------------------------------------------------------------
  const ready = (async () => {
    let fromCache = false;
    if (cache) {
      const local = await cache.get();
      if (local) { try { docFromContent(local, ydoc); fromCache = true; } catch { /* a stale or damaged copy */ } }
    }
    try {
      const stored = await store.loadContent();
      if (stored) Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(docFromContent(stored)), "remote");
      set({ status: "saved", offline: false });
      // The device had edits storage lacks (made offline, or a write lost in a race): save them.
      if (fromCache && (!stored || !Y.equalSnapshots(Y.snapshot(docFromContent(stored)), Y.snapshot(ydoc)))) schedule(true);
    } catch (e) {
      if (!fromCache) { set({ status: "error", error: e?.message || "The document couldn't be opened." }); throw e; }
      set({ status: "offline", offline: true });
    }
    try {
      const rows = await store.versions.list();
      lastSnapshot = Math.max(0, ...rows.map((r) => Date.parse(r.savedAt) || 0));
    } catch { /* the version list comes later */ }
    startLive();
    return { fromCache };
  })();

  // ---- saving -------------------------------------------------------------------------------
  function schedule(soon = false) {
    if (closed) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => save(), soon ? 50 : SAVE_IDLE_MS);
    if (!maxTimer) maxTimer = setTimeout(() => save(), SAVE_MAX_MS);
  }

  async function save({ final = false } = {}) {
    clearTimeout(idleTimer); idleTimer = null;
    clearTimeout(maxTimer); maxTimer = null;
    if (saving) { await saving; if (!state.dirty && !final) return; }
    saving = (async () => {
      const wasDirty = state.dirty;
      state.dirty = false;
      set({ status: "saving" });
      try {
        const r = await mergeAndSave(ydoc, store);
        state.lastSaved = now();
        set({ status: "saved", offline: false, error: "" });
        await cache?.put(r.bytes || docToContent(ydoc));
        if (r.wrote || final) await saveRow({ force: final, size: (r.bytes || []).length });
        if (state.sinceSnapshot && (final || now() - lastSnapshot >= SNAPSHOT_EVERY_MS)) await snapshot();
      } catch (e) {
        state.dirty = state.dirty || wasDirty;
        const offline = win?.navigator && win.navigator.onLine === false;
        set({ status: offline ? "offline" : "error", offline, error: offline ? "" : (e?.message || "Couldn't save.") });
        await cache?.put(docToContent(ydoc)); // kept on this device; saved when back online
      }
    })();
    try { await saving; } finally { saving = null; }
  }

  async function saveRow({ force = false, size = null } = {}) {
    if (!getText) return;
    if (!force && now() - lastRow < ROW_EVERY_MS) return;
    const { text, pages } = getText();
    if (text === lastText && !force) return;
    lastRow = now();
    lastText = text;
    try { await store.saveRow({ bodyText: text, size, pages }); } catch { /* next time */ }
  }

  const onUpdate = (update, origin) => {
    if (closed || origin === "load") return;
    state.sinceSnapshot = true;
    if (origin === "remote" || origin === LIVE_ORIGIN) {
      // Someone else's edit: it's already stored (or will be by them); keep the device copy.
      clearTimeout(cacheTimer);
      cacheTimer = setTimeout(() => cache?.put(docToContent(ydoc)), CACHE_MS);
      onRemoteChange?.();
      return;
    }
    state.dirty = true;
    if (state.status === "saved") set({ status: "unsaved" });
    clearTimeout(cacheTimer);
    cacheTimer = setTimeout(() => cache?.put(docToContent(ydoc)), CACHE_MS);
    schedule();
  };
  ydoc.on("update", onUpdate);

  // ---- versions ------------------------------------------------------------------------------
  async function snapshot(name = null) {
    const bytes = docToContent(ydoc);
    const t = now();
    if (name) {
      const slot = namedSlot();
      await store.versions.put(slot, bytes, { name });
      return slot;
    }
    const rows = store.versions.cached() || (await store.versions.list().catch(() => []));
    for (const slot of slotsFor(t, rows)) await store.versions.put(slot, bytes);
    lastSnapshot = t;
    state.sinceSnapshot = false;
    return null;
  }

  async function versions() {
    return liveVersions(await store.versions.list(), now());
  }

  async function loadVersion(slot) {
    return docFromContent(await store.versions.get(slot));
  }

  // Makes the document what the version was; first keeps a snapshot of now (so a
  // restore can itself be undone from the list).
  async function restore(slot, copyFragment) {
    await snapshot().catch(() => {});
    const v = await loadVersion(slot);
    restoreInto(ydoc, v, { copyFragment });
    await save();
  }

  // ---- live ----------------------------------------------------------------------------------
  function startLive() {
    if (!liveOpen || live || closed) return;
    try {
      live = connectLive({ ydoc, awareness, open: (h) => liveOpen(store.channel, h), me: { id: me.id, name: me.name, color: colorFor(me.id) }, encrypt: store.encrypt, decrypt: store.decrypt });
      live.onPeers((peers) => set({ peers: peers.map((p) => ({ id: p.uid, name: p.name, color: p.color, cid: p.cid })) }));
    } catch { live = null; }
  }
  function stopLive() {
    live?.close();
    live = null;
    set({ peers: [] });
  }

  // Leaving the app: save and leave the channel; coming back: merge from storage, rejoin.
  const onVisibility = () => {
    if (closed || !win?.document) return;
    if (win.document.visibilityState === "hidden") { stopLive(); save(); }
    else { save(); startLive(); }
  };
  const onOnline = () => { if (!closed) save(); };
  win?.document?.addEventListener?.("visibilitychange", onVisibility);
  win?.addEventListener?.("online", onOnline);

  return {
    ydoc,
    awareness,
    ready,
    get state() { return { ...state }; },
    subscribe(cb) { listeners.add(cb); cb({ ...state }); return () => listeners.delete(cb); },
    save: () => save(),
    snapshot,
    versions,
    loadVersion,
    restore,
    renameVersion: (slot, name) => store.versions.rename(slot, name),
    async close() {
      if (closed) return;
      win?.document?.removeEventListener?.("visibilitychange", onVisibility);
      win?.removeEventListener?.("online", onOnline);
      stopLive();
      try { if (state.dirty || state.sinceSnapshot) await save({ final: true }); } catch { /* kept on the device */ }
      closed = true;
      clearTimeout(cacheTimer);
      ydoc.off("update", onUpdate);
      awareness.destroy();
    },
  };
}
