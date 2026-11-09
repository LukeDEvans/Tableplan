// The engine against Google Sheets' own answers (SPREADSHEET_DESIGN.md §3): every
// case in test/fixtures/sheet-conformance-cases.mjs, laid out exactly as in the sheet
// Sheets computed (scripts/sheet-conformance.mjs), must give the same value.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { CASES, DATA } from "./fixtures/sheet-conformance-cases.mjs";
import { book } from "./documents-sheet-helpers.js";
import { isErr, ERROR_TYPE } from "../documents/sheet/engine/values.js";
import { ParseError } from "../documents/sheet/engine/parser.js";

const answers = JSON.parse(readFileSync(new URL("./fixtures/sheet-conformance.json", import.meta.url), "utf8")).answers;

// Cases where we knowingly differ, with the reason (keep this list short and justified).
const KNOWN = {};

function encode(v) {
  if (isErr(v)) return `E|${ERROR_TYPE[v.code]}`;
  if (typeof v === "number") return { n: v };
  if (typeof v === "boolean") return `B|${v ? "TRUE" : "FALSE"}`;
  if (typeof v === "string") return `S|${v}`;
  return "X|";
}
function same(ours, theirs) {
  if (typeof ours === "object") {
    if (!theirs.startsWith("N|")) return false;
    const t = Number(theirs.slice(2));
    return Math.abs(ours.n - t) <= Math.max(1e-300, Math.abs(t) * 5e-14);
  }
  return ours === theirs;
}

describe("conformance with Google Sheets", () => {
  const b = book({ rows: CASES.length + 2, cols: 12 });
  ["E", "F", "G", "H", "I"].forEach((col) => DATA[col].forEach((v, i) => { if (v !== null) b.set(`${col}${i + 1}`, String(v)); }));
  const ours = [];
  CASES.forEach((f, i) => {
    b.set(`C${i + 1}`, "=1"); // Sheets had its answer formula here, so spills are blocked alike
    try { b.set(`B${i + 1}`, f); ours[i] = null; } catch (e) { if (!(e instanceof ParseError)) throw e; ours[i] = "E|8"; }
  });
  b.eng.recalc();

  it(`${CASES.length} cases agree`, () => {
    const wrong = [];
    CASES.forEach((f, i) => {
      if (KNOWN[f]) return;
      const theirs = answers[f];
      const mine = ours[i] ?? encode(b.get(`B${i + 1}`));
      if (!same(mine, theirs)) wrong.push(`${f}  →  ours ${typeof mine === "object" ? `N|${mine.n}` : mine}, Sheets ${theirs}`);
    });
    expect(wrong, wrong.join("\n")).toEqual([]);
  });
});
