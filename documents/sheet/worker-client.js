// The page's side of the calculation worker (SPREADSHEET_DESIGN.md §3). Has the same
// methods as the engine, so bridge.js can drive either one:
//
//   const eng = createWorkerEngine({ onChange(keys) });   // keys: cells whose value changed
//   eng.setCell(…); eng.recalc();                          // sends the batch, returns at once
//   eng.valueAt(tab, r, c)                                 // the latest answer the worker sent
//   await eng.whenIdle()                                   // every batch so far answered
//
// The grid reads values synchronously, so the page keeps a copy of every answer (and,
// for a typed constant, shows it at once instead of waiting for the round trip). It
// also keeps the inputs it sent: if the worker can't start or dies, the same engine
// runs on the page instead (engine/host.js), fed from that copy.

import { createEngineHost, decodeValue } from "./engine/host.js";
import { err, isErr } from "./engine/values.js";

const keyOf = (tab, row, col) => `${tab}|${row}|${col}`;
const encodeInput = (v) => (isErr(v) ? { e: v.code, m: v.message || "" } : v);
const isFormula = (v) => v && typeof v === "object" && v.formula;

export function defaultWorkerFactory() {
  if (typeof Worker === "undefined") return null;
  return new Worker(new URL("./engine/worker.js", import.meta.url), { type: "module" });
}

export function createWorkerEngine({ onChange = null, makeWorker = defaultWorkerFactory } = {}) {
  // inputs, for replay
  const tabs = new Map(); // id → { name, rows, cols }
  const cells = new Map(); // key → encoded input
  const names = new Map();
  let settings = null;
  const rules = new Map(); // id → { tab, f, ranges } (custom-formula rules on cells)
  const ruleHits = new Map(); // id → Set("rowId.colId") where the formula is TRUE
  // answers
  const values = new Map(); // key → value (decoded)
  const anchors = new Map(); // key → { row, col }
  const infos = new Map(); // key → formula info
  const listeners = new Set(onChange ? [onChange] : []);

  let queue = [];
  let seq = 0, answered = 0;
  const waiting = []; // [seq, resolve]
  let worker = null, local = null;

  function start() {
    try { worker = makeWorker?.() || null; } catch { worker = null; }
    if (!worker) { goLocal(); return; }
    worker.onmessage = (e) => receive(e.data);
    worker.onerror = (e) => { e?.preventDefault?.(); fail(); };
    worker.onmessageerror = () => fail();
  }
  function fail() {
    if (local) return;
    try { worker?.terminate(); } catch {}
    worker = null;
    goLocal();
    // everything sent so far, once more, to the engine on the page; the old answers go
    // first, so nothing the dead worker said lingers (a shrunk spill, a cleared formula)
    const stale = new Set([...values.keys(), ...anchors.keys(), ...infos.keys()]);
    values.clear(); anchors.clear(); infos.clear(); ruleHits.clear();
    for (const [k, v] of cells) if (!isFormula(v)) values.set(k, decodeValue(v));
    receive(local.handle({ seq, ops: replayOps() }), true, stale);
  }
  function goLocal() { local = createEngineHost(); }

  function replayOps() {
    const ops = [];
    if (settings) ops.push(["setSettings", settings]);
    for (const [id, t] of tabs) ops.push(["setTab", id, { name: t.name, rows: t.rows, cols: t.cols }]);
    for (const [k, v] of cells) { const [tab, row, col] = k.split("|"); ops.push(["setCell", tab, row, col, v]); }
    for (const [k, ref] of names) ops.push(["setName", k, ref]);
    for (const [id, r] of rules) ops.push(["setRule", id, r]);
    return ops;
  }

  function receive(msg, all = false, alsoChanged = null) {
    if (!msg) return;
    if (msg.error) {
      console.error("[sheet] calculation failed:", msg.error);
      // the worker's engine threw on this batch: start over on the page from the inputs
      if (!local) { fail(); return; }
    }
    const changed = new Set(alsoChanged || []);
    for (const [k, v, anchor, info] of msg.changes || []) {
      const val = decodeValue(v);
      if (val === null) values.delete(k); else values.set(k, val);
      if (anchor) anchors.set(k, anchor); else anchors.delete(k);
      if (info) infos.set(k, { ...info, error: info.error ? decodeValue(info.error) : null }); else infos.delete(k);
      changed.add(k);
    }
    let rulesChanged = false;
    for (const [id, list] of Object.entries(msg.rules || {})) { if (list.length) ruleHits.set(id, new Set(list)); else ruleHits.delete(id); rulesChanged = true; }
    answered = all ? seq : Math.max(answered, msg.seq);
    while (waiting.length && waiting[0][0] <= answered) waiting.shift()[1]();
    if (changed.size || rulesChanged || all) for (const fn of listeners) fn(changed);
  }

  function send(op) { queue.push(op); }

  function setTab(id, { name = id, rows = [], cols = [] } = {}) {
    tabs.set(id, { name, rows: rows.slice(), cols: cols.slice() });
    send(["setTab", id, { name, rows, cols }]);
  }
  function setOrder(id, rows, cols) {
    const t = tabs.get(id);
    if (!t) return;
    t.rows = rows.slice(); t.cols = cols.slice();
    send(["setOrder", id, rows, cols]);
  }
  function removeTab(id) {
    tabs.delete(id);
    const p = `${id}|`;
    for (const m of [cells, values, anchors, infos]) for (const k of [...m.keys()]) if (k.startsWith(p)) m.delete(k);
    send(["removeTab", id]);
  }
  function setCell(tab, row, col, input) {
    const k = keyOf(tab, row, col);
    const enc = encodeInput(input);
    if (enc === null || enc === undefined) cells.delete(k); else cells.set(k, enc);
    // a typed constant shows at once; a formula keeps its old answer until the new one comes
    if (!isFormula(input)) {
      if (input === null || input === undefined) values.delete(k); else values.set(k, input);
      infos.delete(k);
    }
    send(["setCell", tab, row, col, enc]);
  }
  function setName(k, ref) {
    if (ref) names.set(k, ref); else names.delete(k);
    send(["setName", k, ref]);
  }
  // A rule on cells with a custom formula: { tab, f (stored), ranges } or null to remove.
  function setRule(id, spec) {
    if (spec) rules.set(id, spec); else { rules.delete(id); ruleHits.delete(id); }
    send(["setRule", id, spec || null]);
  }
  function setSettings(s) { settings = { ...(settings || {}), ...s }; send(["setSettings", s]); }

  // Sends what's queued. Returns at once with no changes; the answers arrive via onChange.
  function recalc() {
    if (!queue.length && seq) return new Set();
    const msg = { seq: ++seq, ops: queue };
    queue = [];
    if (local) receive(local.handle(msg));
    else {
      try { worker.postMessage(msg); } catch { fail(); }
    }
    return new Set();
  }

  function value(tab, row, col) {
    const v = values.get(keyOf(tab, row, col));
    return v === undefined ? null : v;
  }
  function valueAt(tab, r, c) {
    const t = tabs.get(tab);
    if (!t) return err("#REF!");
    const row = t.rows[r], col = t.cols[c];
    if (row === undefined || col === undefined) return null;
    return value(tab, row, col);
  }
  const spillAnchorOf = (tab, row, col) => anchors.get(keyOf(tab, row, col)) || null;
  const formulaInfo = (tab, row, col) => infos.get(keyOf(tab, row, col)) || null;

  function whenIdle() {
    if (queue.length) recalc();
    if (answered >= seq) return Promise.resolve();
    return new Promise((res) => waiting.push([seq, res]));
  }

  function close() {
    try { worker?.terminate(); } catch {}
    worker = null;
    for (const [, res] of waiting.splice(0)) res();
  }

  start();
  return {
    setTab, setOrder, removeTab, setCell, setName, setSettings, setRule, recalc,
    ruleHits: (id) => ruleHits.get(id) || null,
    value, valueAt, spillAnchorOf, formulaInfo, whenIdle, close,
    onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    get inWorker() { return Boolean(worker); },
  };
}
