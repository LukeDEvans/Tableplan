// grocery-bought.js — when a manually added grocery item counts as bought for good.
//
// Why: the Shop list keeps its checked / swept ("bought") marks per shopping cycle
// (the cycle key is the range's end date, normally the upcoming Friday), so a new
// cycle starts clean. That is right for meal-plan needs, which come back with each
// week's meals. A manually typed item is different: it stays on the manual list
// until someone removes it, so every new cycle (each Friday, or any change to the
// date range) showed it again, unchecked (Luke, 2026-10-06).
//
// Rule: a manual item that was checked off in some other cycle is still bought.
//   - that cycle is over (its end date is today or earlier)  → "retire": take the
//     item off the manual list for good (a stamped removal, so it survives a sync).
//   - that cycle is still ahead (the range was moved)        → "bought": keep it
//     under "Show N bought" instead of listing it unchecked again.
// Marks from before the item was (re-)added don't count, and nothing checked off
// before this rule existed is removed (CARRY_FROM_CYCLE).
//
// Pure: no state, no clock reads (callers pass `today`), fully unit-tested.

// First cycle whose marks can carry over. Earlier marks are ignored, so items that
// were bought before this fix and are sitting on the list again are left alone.
export const CARRY_FROM_CYCLE = "2026-10-09";

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));

function eachMark(map, separator, visit) {
  if (!map || typeof map !== "object" || Array.isArray(map)) return;
  for (const [key, value] of Object.entries(map)) {
    const at = key.indexOf(separator);
    if (at < 0) continue;
    visit(key.slice(0, at), key.slice(at + separator.length), value, key);
  }
}

// rowKey → Set of cycles in which that row is checked ("<cycle>|<rowKey>" in
// checkedGroceries) or swept ("<cycle>::<rowKey>" in groceryCleared).
export function boughtCyclesByKey(checked, cleared) {
  const out = new Map();
  const add = (cycle, rowKey, value) => {
    if (!value || !rowKey) return;
    if (!out.has(rowKey)) out.set(rowKey, new Set());
    out.get(rowKey).add(cycle);
  };
  eachMark(checked, "|", add);
  eachMark(cleared, "::", add);
  return out;
}

// "retire" | "bought" | "" for one manual item, from the cycles it is marked in.
// addedDay: the local day (YYYY-MM-DD) the item was last added, "" if unknown.
export function manualItemCarry(cycles, { currentCycle, today, addedDay = "", fromCycle = CARRY_FROM_CYCLE } = {}) {
  const carried = [...(cycles || [])].filter((cycle) =>
    isDay(cycle) && cycle !== currentCycle && cycle >= fromCycle && (!addedDay || cycle >= addedDay));
  if (!carried.length) return "";
  return carried.some((cycle) => cycle <= today) ? "retire" : "bought";
}

// Turn every mark for one row off, in every cycle (the item was added again, or
// un-checked while it was showing as bought). Writes an explicit false instead of
// deleting the key, the same merge-safety trick setGroceryCleared uses. Mutates the
// two maps; returns true if anything changed.
export function resetBoughtMarks(checked, cleared, rowKey) {
  let changed = false;
  const off = (map, separator) => eachMark(map, separator, (cycle, key, value, fullKey) => {
    if (key !== rowKey || !value) return;
    map[fullKey] = false;
    changed = true;
  });
  off(checked, "|");
  off(cleared, "::");
  return changed;
}
