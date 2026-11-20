// Test harness for the spreadsheet engine: a small workbook addressed in A1.

import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { storedFromText, fromStored, formulaText } from "../documents/sheet/engine/binding.js";
import { parseTyped, isErr, isMatrix } from "../documents/sheet/engine/values.js";
import { readRef } from "../documents/sheet/engine/parser.js";

// Fixed "now": Monday 2026-11-09 12:00 UTC.
export const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

export function book({ rows = 40, cols = 12, tabs = ["Sheet1"], now = NOW, random } = {}) {
  let n = 0;
  const id = (p) => `${p}${(n++).toString(36)}`;
  const eng = createEngine({ functions: functionCatalog(), now: () => now, random: random || (() => 0.5) });
  const tabIds = new Map();
  for (const name of tabs) {
    const tid = id("t");
    tabIds.set(name, tid);
    eng.setTab(tid, { name, rows: Array.from({ length: rows }, () => id("r")), cols: Array.from({ length: cols }, () => id("c")) });
  }
  const home = (name) => tabIds.get(name || tabs[0]);
  const at = (addr, tabName) => {
    const r = readRef(addr);
    if (!r) throw new Error(`bad address ${addr}`);
    const tab = r.node.sheet ? tabIds.get(r.node.sheet) : home(tabName);
    return { tab, r: r.node.r1, c: r.node.c1 };
  };
  const ids = ({ tab, r, c }) => { const t = eng.tab(tab); return [tab, t.rows[r], t.cols[c]]; };
  const api = {
    eng, tabIds, home,
    set(addr, input, tabName) {
      const p = at(addr, tabName);
      const [tab, rid, cid] = ids(p);
      if (typeof input === "string" && input.startsWith("=") && input.length > 1) {
        const stored = storedFromText(input, eng.grid, tab);
        eng.setCell(tab, rid, cid, { formula: fromStored(stored) });
        api.stored.set(`${tab}|${rid}|${cid}`, stored);
      } else eng.setCell(tab, rid, cid, parseTyped(input).value);
      return api;
    },
    stored: new Map(),
    fill(map, tabName) { for (const [a, v] of Object.entries(map)) api.set(a, v, tabName); return api; },
    get(addr, tabName) { eng.recalc(); const p = at(addr, tabName); return eng.valueAt(p.tab, p.r, p.c); },
    text(addr, tabName) { const p = at(addr, tabName); const [tab, rid, cid] = ids(p); const s = api.stored.get(`${tab}|${rid}|${cid}`); return s ? formulaText(s, eng.grid, tab) : null; },
    // Evaluate one formula in a scratch cell (bottom-right) and return its value.
    calc(formula, tabName) {
      const t = eng.tab(home(tabName));
      const addr = `L${t.rows.length}`;
      api.set(addr, formula, tabName);
      const v = api.get(addr, tabName);
      return v;
    },
    // Values of a range as a 2-D array.
    grid(range, tabName) {
      eng.recalc();
      const r = readRef(range).node;
      const tab = r.sheet ? tabIds.get(r.sheet) : home(tabName);
      const out = [];
      for (let i = r.r1; i <= r.r2; i++) { const row = []; for (let j = r.c1; j <= r.c2; j++) row.push(show(eng.valueAt(tab, i, j))); out.push(row); }
      return out;
    },
    insertRows(at, count = 1, tabName) {
      const tab = home(tabName);
      const t = eng.tab(tab);
      const rowsNow = t.rows.slice();
      rowsNow.splice(at, 0, ...Array.from({ length: count }, () => id("r")));
      eng.setOrder(tab, rowsNow, t.cols.slice());
    },
    deleteRows(at, count = 1, tabName) {
      const tab = home(tabName);
      const t = eng.tab(tab);
      const rowsNow = t.rows.slice();
      const gone = rowsNow.splice(at, count);
      for (const rid of gone) for (const cid of t.cols) eng.setCell(tab, rid, cid, null);
      eng.setOrder(tab, rowsNow, t.cols.slice());
    },
  };
  return api;
}

// A value as tests compare it: errors become their code.
export const show = (v) => (isErr(v) ? v.code : isMatrix(v) ? v.rows.map((r) => r.map(show)) : v);
