// The engine's side of the calculation worker (SPREADSHEET_DESIGN.md §3): applies a
// batch of edits, recalculates, and reports every cell whose value may have changed.
// Pure (no Worker API), so tests run it in-process; engine/worker.js wires it to
// postMessage, documents/sheet/worker-client.js is the page's side.
//
// In:  { seq, ops: [[method, ...args], …] }        method ∈ setTab setOrder removeTab setCell setName setSettings
//      plus ["setRule", id, { tab, f, ranges } | null] for rules on cells with a custom formula
// Out: { seq, changes: [[key, value, anchor, info], …], rules?: { id: ["rowId.colId", …] } } or { seq, error }
//      rules: for each formula rule whose answer changed, the cells where it is TRUE
//      value: number | string | boolean | null | { e: "#REF!", m: "…" }

import { createEngine } from "./engine.js";
import { functionCatalog } from "./functions/index.js";
import { isErr, err } from "./values.js";
import { fromStored, unbind, bind, shift } from "./binding.js";

const MAX_RULE_CELLS = 100_000; // per batch, over all formula rules

const OPS = new Set(["setTab", "setOrder", "removeTab", "setCell", "setName", "setSettings", "setRule"]);

export function encodeValue(v) {
  if (v === null || v === undefined) return null;
  if (isErr(v)) return { e: v.code, m: v.message || "" };
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  return { e: "#VALUE!", m: "This value can't be shown in a cell." }; // a LAMBDA or range left over
}

// A typed-in error ("#N/A") crosses as { e, m } too.
export const decodeValue = (v) => (v && typeof v === "object" && typeof v.e === "string" && !v.formula ? err(v.e, v.m || "") : v);

export function createEngineHost(engine = createEngine({ functions: functionCatalog() })) {
  const rules = new Map(); // id → { tab, f, ranges }
  const lastHits = new Map(); // id → joined key list sent last time

  function boundsOf(t, rg) {
    const pos = (ix, id, dflt) => (id === null || id === undefined ? dflt : ix.get(id));
    const r1 = pos(t.rowIx, rg.top, 0), r2 = pos(t.rowIx, rg.bottom, t.rows.length - 1);
    const c1 = pos(t.colIx, rg.left, 0), c2 = pos(t.colIx, rg.right, t.cols.length - 1);
    if ([r1, r2, c1, c2].some((x) => x === undefined || x < 0)) return null;
    return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
  }
  // Every formula rule at every cell of its ranges, relative to the first range's top-left.
  function evaluateRules() {
    const out = {};
    let budget = MAX_RULE_CELLS;
    for (const [id, rule] of rules) {
      const t = engine.tab(rule.tab);
      const hits = [];
      let tree = null;
      try { tree = fromStored(rule.f); } catch { tree = null; }
      const bounds = t && tree ? (rule.ranges || []).map((rg) => boundsOf(t, rg)).filter(Boolean) : [];
      if (bounds.length) {
        const pos = unbind(tree, engine.grid, rule.tab);
        const r0 = bounds[0].r1, c0 = bounds[0].c1;
        for (const b of bounds) for (let r = b.r1; r <= b.r2; r++) for (let c = b.c1; c <= b.c2; c++) {
          if (--budget < 0) break;
          const here = bind(shift(pos, r - r0, c - c0), engine.grid, rule.tab);
          const v = engine.evaluateAt(rule.tab, here, t.rows[r], t.cols[c]);
          if (v === true || (typeof v === "number" && v !== 0)) hits.push(`${t.rows[r]}.${t.cols[c]}`);
        }
      }
      const joined = hits.join(",");
      if (lastHits.get(id) !== joined) { lastHits.set(id, joined); out[id] = hits; }
    }
    for (const id of [...lastHits.keys()]) if (!rules.has(id)) { lastHits.delete(id); out[id] = []; }
    return Object.keys(out).length ? out : null;
  }

  function handle(msg) {
    const { seq, ops = [] } = msg || {};
    try {
      for (const [m, ...args] of ops) {
        if (!OPS.has(m)) throw new Error(`Unknown engine call ${m}`);
        if (m === "setCell") args[3] = decodeValue(args[3]);
        if (m === "setRule") { if (args[1]) rules.set(args[0], args[1]); else rules.delete(args[0]); continue; }
        engine[m](...args);
      }
      const changed = engine.recalc();
      const changes = [];
      for (const k of changed) {
        const [tab, row, col] = k.split("|");
        const v = engine.value(tab, row, col);
        const anchor = engine.spillAnchorOf(tab, row, col);
        const fi = engine.formulaInfo(tab, row, col);
        const info = fi ? { volatile: fi.volatile, spill: fi.spill, blocked: fi.blocked, error: fi.error ? encodeValue(fi.error) : null } : null;
        changes.push([k, encodeValue(v), anchor, info]);
      }
      const ruleHits = rules.size || lastHits.size ? evaluateRules() : null;
      return ruleHits ? { seq, changes, rules: ruleHits } : { seq, changes };
    } catch (e) {
      return { seq, error: String(e?.message || e) };
    }
  }
  return { handle, engine };
}
