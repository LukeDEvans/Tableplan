// Live co-editing (WORD_PROCESSOR_DESIGN.md §4): Yjs updates and cursors over a
// Supabase Realtime private broadcast channel, only while someone else has the
// document open. Nothing goes through Postgres; nothing polls.
//
// connectLive({ ydoc, awareness, open, me, encrypt?, decrypt? }) → { close(), peers(), onPeers(cb) }
//   open(handlers) → channel adapter { send(msg), track(meta), close() } and calls
//     handlers.message(msg), handlers.presence(list), handlers.status(s) — app.js
//     makes it from supabase-js (liveDocChannel), tests from a fake bus.
//   encrypt / decrypt: (bytes) → bytes; the Safe's documents pass them, so the
//     channel only ever carries ciphertext.
//
// Protocol (messages are { t, from, to?, d } with d base64):
//   hello  my state vector; anyone else answers with "up" (what I lack) and, once,
//          their own hello (so both sides catch up)
//   up     a Yjs update (batched while typing, ~4 a second)
//   aw     an awareness update (cursor, selection, name, colour)
// A big update is sent in pieces ("part", 120 KB each) and put back together.

import * as Y from "yjs";
import { encodeAwarenessUpdate, applyAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";

const BATCH_MS = 250;
const AW_MS = 200;
const PART_BYTES = 120 * 1024;

const toB64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b) => {
  const s = atob(b);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
};

export const LIVE_ORIGIN = "live-remote";

export function connectLive({ ydoc, awareness, open, me, encrypt = null, decrypt = null, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const myId = String(ydoc.clientID);
  let peers = [];
  let closed = false;
  let pending = [];
  let flushTimer = null;
  let awTimer = null;
  let answered = new Set();
  const peerListeners = new Set();
  const parts = new Map();

  const pack = async (bytes) => toB64(encrypt ? await encrypt(bytes) : bytes);
  const unpack = async (b64) => {
    const bytes = fromB64(b64);
    return decrypt ? decrypt(bytes) : bytes;
  };
  const others = () => peers.filter((p) => p.cid !== myId);

  async function send(t, bytes, to = null) {
    if (closed || !channel) return;
    const d = await pack(bytes);
    if (d.length <= PART_BYTES) { channel.send({ t, from: myId, ...(to ? { to } : {}), d }); return; }
    const id = Math.random().toString(36).slice(2, 10);
    const n = Math.ceil(d.length / PART_BYTES);
    for (let i = 0; i < n; i++) channel.send({ t: "part", of: t, id, i, n, from: myId, ...(to ? { to } : {}), d: d.slice(i * PART_BYTES, (i + 1) * PART_BYTES) });
  }

  async function onMessage(msg) {
    if (closed || !msg || msg.from === myId || (msg.to && msg.to !== myId)) return;
    if (msg.t === "part") {
      const key = `${msg.from}:${msg.id}`;
      const got = parts.get(key) || { n: msg.n, of: msg.of, pieces: [] };
      if (msg.n !== got.n || msg.n > 500) return;
      got.pieces[msg.i] = msg.d;
      parts.set(key, got);
      if (got.pieces.filter(Boolean).length === got.n) {
        parts.delete(key);
        await onMessage({ t: got.of, from: msg.from, to: msg.to, d: got.pieces.join("") });
      }
      return;
    }
    let bytes;
    try { bytes = await unpack(msg.d); } catch { return; } // not ours, or tampered with
    try {
      if (msg.t === "up") Y.applyUpdate(ydoc, bytes, LIVE_ORIGIN);
      else if (msg.t === "aw" && awareness) applyAwarenessUpdate(awareness, bytes, LIVE_ORIGIN);
      else if (msg.t === "hello") {
        await send("up", Y.encodeStateAsUpdate(ydoc, bytes), msg.from);
        if (awareness) await send("aw", encodeAwarenessUpdate(awareness, [awareness.clientID]), msg.from);
        if (!answered.has(msg.from)) { answered.add(msg.from); await send("hello", Y.encodeStateVector(ydoc), msg.from); }
      }
    } catch { /* a bad update is dropped; the next save merges from storage anyway */ }
  }

  function onPresence(list) {
    const before = new Set(others().map((p) => p.cid));
    peers = list.filter((p) => p && typeof p.cid === "string");
    const now = others();
    // Someone new: say hello so both sides catch up.
    if (now.some((p) => !before.has(p.cid))) send("hello", Y.encodeStateVector(ydoc));
    // Someone left: drop their cursor.
    if (awareness) {
      const gone = [...awareness.getStates().keys()].filter((c) => c !== awareness.clientID && !now.some((p) => p.cid === String(c)));
      if (gone.length) removeAwarenessStates(awareness, gone, LIVE_ORIGIN);
    }
    for (const cb of peerListeners) cb(now);
  }

  function flush() {
    flushTimer = null;
    if (!pending.length) return;
    const merged = Y.mergeUpdates(pending);
    pending = [];
    if (others().length) send("up", merged);
  }

  const onUpdate = (update, origin) => {
    if (origin === LIVE_ORIGIN || closed) return;
    if (!others().length) return; // alone: the next save carries it
    pending.push(update);
    if (!flushTimer) flushTimer = setTimer(flush, BATCH_MS);
  };
  ydoc.on("update", onUpdate);

  const onAwareness = ({ added, updated, removed }, origin) => {
    if (origin === LIVE_ORIGIN || closed || !others().length) return;
    const changed = [...added, ...updated, ...removed].filter((c) => c === awareness.clientID);
    if (!changed.length || awTimer) return;
    awTimer = setTimer(() => { awTimer = null; send("aw", encodeAwarenessUpdate(awareness, [awareness.clientID])); }, AW_MS);
  };
  awareness?.on("update", onAwareness);

  const channel = open({
    message: (m) => { onMessage(m); },
    presence: onPresence,
    status: () => {},
  });
  channel?.track({ cid: myId, uid: me.id, name: me.name, color: me.color });

  return {
    peers: () => others(),
    onPeers(cb) { peerListeners.add(cb); return () => peerListeners.delete(cb); },
    flush,
    close() {
      if (closed) return;
      flush();
      closed = true;
      clearTimer(flushTimer);
      clearTimer(awTimer);
      ydoc.off("update", onUpdate);
      awareness?.off("update", onAwareness);
      try { channel?.close(); } catch { /* already gone */ }
      peers = [];
      answered = new Set();
    },
  };
}

// A colour per person, from their id (stable across devices).
const COLORS = ["#d93025", "#1a73e8", "#188038", "#e37400", "#9334e6", "#c5221f", "#007b83", "#b06000"];
export function colorFor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

// A fake channel bus for tests: every open() on the same bus hears the others.
export function memoryBus() {
  const members = new Set();
  const presence = () => [...members].filter((m) => m.meta).map((m) => m.meta);
  const announce = () => { for (const m of members) m.h.presence(presence()); };
  return {
    open(h) {
      const m = { h, meta: null };
      members.add(m);
      return {
        send: (msg) => { const copy = JSON.parse(JSON.stringify(msg)); for (const o of members) if (o !== m) queueMicrotask(() => o.h.message(copy)); },
        track: (meta) => { m.meta = meta; queueMicrotask(announce); },
        close: () => { members.delete(m); queueMicrotask(announce); },
      };
    },
  };
}
