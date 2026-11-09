// The function catalog (SPREADSHEET_DESIGN.md §3): every function by name.

import { mathFunctions } from "./math.js";
import { statsFunctions } from "./stats.js";
import { logicFunctions } from "./logic.js";
import { textFunctions } from "./text.js";
import { dateFunctions } from "./dates.js";
import { lookupFunctions } from "./lookup.js";
import { arrayFunctions } from "./arrays.js";

let catalog = null;

export function functionCatalog() {
  if (catalog) return catalog;
  const map = new Map();
  const all = () => map;
  for (const list of [mathFunctions(all), statsFunctions(), logicFunctions(), textFunctions(), dateFunctions(), lookupFunctions(), arrayFunctions()]) {
    for (const d of list) {
      if (map.has(d.name)) throw new Error(`Function ${d.name} defined twice`);
      map.set(d.name, d);
    }
  }
  catalog = map;
  return map;
}

// The display hint of a formula's result when its cell has no number format of its own
// (TODAY() shows a date): the outermost function's fmt, if any.
export function resultFormatHint(tree, functions = functionCatalog()) {
  let n = tree;
  while (n && n.t === "fn" && (n.name === "ARRAYFORMULA" || n.name === "IFERROR" || n.name === "IFNA") && n.args[0]) n = n.args[0];
  if (n?.t === "fn") return functions.get(n.name)?.fmt || null;
  return null;
}
