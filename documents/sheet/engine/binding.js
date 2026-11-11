// Between positions and identities (SPREADSHEET_DESIGN.md §2). A person types A1 text;
// the shared document stores references by row / column / tab id, so inserting, deleting
// or sorting rows never rewrites a formula; on screen the ids are shown as A1 again.
//
//   bind(positionalTree, grid, homeTab)     → bound tree (ids; missing → { t: "ref", bad })
//   unbind(boundTree, grid, homeTab)        → positional tree (for printing as A1)
//   toStored(boundTree)                     → { f: "=…n…", refs: [...] }
//   fromStored(stored)                      → bound tree
//   shift(positionalTree, dr, dc, limits)   → the formula copied dr rows / dc columns away
//   formulaText(stored, grid, homeTab)      → "=SUM(A1:B3)" as it reads now
//
// grid: { tabIdByName(name), tabName(id), rowId(tab, i), colId(tab, i),
//         rowIndex(tab, id), colIndex(tab, id) } — undefined / -1 when there is none.

import { parse, print, refToA1, PLACEHOLDER, MAX_ROWS, MAX_COLS } from "./parser.js";

function mapRefs(tree, fn) {
  if (!tree || typeof tree !== "object") return tree;
  switch (tree.t) {
    case "ref": case "bound": return fn(tree);
    case "fn": return { ...tree, args: tree.args.map((a) => mapRefs(a, fn)) };
    case "arr": return { ...tree, rows: tree.rows.map((r) => r.map((x) => mapRefs(x, fn))) };
    case "un": case "pct": return { ...tree, a: mapRefs(tree.a, fn) };
    case "bin": return { ...tree, a: mapRefs(tree.a, fn), b: mapRefs(tree.b, fn) };
    default: return tree;
  }
}

const BAD = { t: "ref", bad: true };
const flags = (n) => ({ ar1: !!n.ar1, ac1: !!n.ac1, ar2: !!n.ar2, ac2: !!n.ac2 });

export function bind(tree, grid, homeTab) {
  return mapRefs(tree, (n) => {
    if (n.t !== "ref" || n.bad) return n;
    let tab = homeTab;
    if (n.sheet) { tab = grid.tabIdByName(n.sheet); if (!tab) return { ...BAD, sheetName: n.sheet }; }
    const out = { t: "ref", kind: n.kind, sheet: tab === homeTab ? null : tab, ...flags(n), r1: null, r2: null, c1: null, c2: null };
    const rid = (i) => (i === null ? null : grid.rowId(tab, i));
    const cid = (i) => (i === null ? null : grid.colId(tab, i));
    out.r1 = rid(n.r1); out.c1 = cid(n.c1);
    if (n.kind !== "cell") { out.r2 = n.kind === "open" ? null : rid(n.r2); out.c2 = cid(n.c2); }
    else { out.r2 = out.r1; out.c2 = out.c1; }
    const need = { cell: ["r1", "c1"], range: ["r1", "c1", "r2", "c2"], cols: ["c1", "c2"], rows: ["r1", "r2"], open: ["r1", "c1", "c2"] }[n.kind];
    if (need.some((k) => out[k] === undefined || out[k] === null)) return { ...BAD, a1: refToA1(n) };
    return out;
  });
}

export function unbind(tree, grid, homeTab) {
  return mapRefs(tree, (n) => {
    if (n.t !== "ref" || n.bad) return BAD;
    const tab = n.sheet || homeTab;
    const name = n.sheet ? grid.tabName(tab) : null;
    if (n.sheet && name === undefined) return BAD;
    const ri = (id) => (id === null || id === undefined ? null : grid.rowIndex(tab, id));
    const ci = (id) => (id === null || id === undefined ? null : grid.colIndex(tab, id));
    const out = { t: "ref", kind: n.kind, sheet: name, ...flags(n), r1: ri(n.r1), c1: ci(n.c1), r2: ri(n.r2), c2: ci(n.c2) };
    const need = { cell: ["r1", "c1"], range: ["r1", "c1", "r2", "c2"], cols: ["c1", "c2"], rows: ["r1", "r2"], open: ["r1", "c1", "c2"] }[n.kind];
    if (need.some((k) => out[k] === undefined || out[k] === null || out[k] < 0)) return BAD;
    // a range's corners may have swapped places after a sort: keep top-left first
    if (out.r1 !== null && out.r2 !== null && out.r1 > out.r2) { [out.r1, out.r2] = [out.r2, out.r1]; [out.ar1, out.ar2] = [out.ar2, out.ar1]; }
    if (out.c1 !== null && out.c2 !== null && out.c1 > out.c2) { [out.c1, out.c2] = [out.c2, out.c1]; [out.ac1, out.ac2] = [out.ac2, out.ac1]; }
    return out;
  });
}

// Stored form: text with placeholders + the bound refs (compact keys).
export function toStored(boundTree) {
  const refs = [];
  const text = print(boundTree, {
    ref: (n) => {
      if (n.bad) return "#REF!";
      const i = refs.length;
      const r = { k: n.kind };
      if (n.sheet) r.s = n.sheet;
      for (const key of ["r1", "c1", "r2", "c2"]) if (n[key] !== null && n[key] !== undefined) r[key] = n[key];
      const f = (n.ar1 ? 1 : 0) | (n.ac1 ? 2 : 0) | (n.ar2 ? 4 : 0) | (n.ac2 ? 8 : 0);
      if (f) r.a = f;
      refs.push(r);
      return PLACEHOLDER(i);
    },
  });
  return { f: text, refs };
}

export function fromStored(stored) {
  const tree = parse(stored.f, { refs: stored.refs });
  return mapRefs(tree, (n) => {
    if (n.t !== "bound") return n;
    const r = stored.refs[n.i];
    const a = r.a || 0;
    return { t: "ref", kind: r.k, sheet: r.s || null, r1: r.r1 ?? null, c1: r.c1 ?? null, r2: r.r2 ?? null, c2: r.c2 ?? null, ar1: !!(a & 1), ac1: !!(a & 2), ar2: !!(a & 4), ac2: !!(a & 8) };
  });
}

// Copy / fill: relative parts move with the formula; going off the sheet is #REF!.
export function shift(tree, dr, dc, { rows = MAX_ROWS, cols = MAX_COLS } = {}) {
  return mapRefs(tree, (n) => {
    if (n.t !== "ref" || n.bad) return n;
    const out = { ...n };
    const mv = (v, abs, d, max) => (v === null || abs ? v : v + d);
    out.r1 = mv(n.r1, n.ar1, dr); out.r2 = mv(n.r2, n.ar2, dr);
    out.c1 = mv(n.c1, n.ac1, dc); out.c2 = mv(n.c2, n.ac2, dc);
    for (const k of ["r1", "r2"]) if (out[k] !== null && (out[k] < 0 || out[k] >= rows)) return BAD;
    for (const k of ["c1", "c2"]) if (out[k] !== null && (out[k] < 0 || out[k] >= cols)) return BAD;
    return out;
  });
}

export function formulaText(stored, grid, homeTab) {
  return print(unbind(fromStored(stored), grid, homeTab));
}

// Parse what a person typed ("=sum(a1:b2)") into a stored formula.
export function storedFromText(text, grid, homeTab) {
  const tree = parse(text);
  return toStored(bind(tree, grid, homeTab));
}
