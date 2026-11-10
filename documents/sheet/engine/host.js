// The engine's side of the calculation worker (SPREADSHEET_DESIGN.md §3): applies a
// batch of edits, recalculates, and reports every cell whose value may have changed.
// Pure (no Worker API), so tests run it in-process; engine/worker.js wires it to
// postMessage, documents/sheet/worker-client.js is the page's side.
//
// In:  { seq, ops: [[method, ...args], …] }        method ∈ setTab setOrder removeTab setCell setName setSettings
// Out: { seq, changes: [[key, value, anchor, info], …] } or { seq, error }
//      value: number | string | boolean | null | { e: "#REF!", m: "…" }

import { createEngine } from "./engine.js";
import { functionCatalog } from "./functions/index.js";
import { isErr, err } from "./values.js";

const OPS = new Set(["setTab", "setOrder", "removeTab", "setCell", "setName", "setSettings"]);

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
  function handle(msg) {
    const { seq, ops = [] } = msg || {};
    try {
      for (const [m, ...args] of ops) {
        if (!OPS.has(m)) throw new Error(`Unknown engine call ${m}`);
        if (m === "setCell") args[3] = decodeValue(args[3]);
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
      return { seq, changes };
    } catch (e) {
      return { seq, error: String(e?.message || e) };
    }
  }
  return { handle, engine };
}
