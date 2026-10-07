import { describe, it, expect } from "vitest";
import { mergeChecklistConfig } from "../grocery-sources.js";

const item = (id, name) => ({ id, name });
const names = (list) => list.map((e) => e.name);

describe("Shop checklist items survive a sync", () => {
  const full = [item("a", "Paper Towels"), item("b", "Milk"), item("c", "Hand Soap")];

  it("a device with an empty list can't erase the household's checklist", () => {
    // What happened on 2026-10-01: the empty copy was the more recently saved one.
    expect(names(mergeChecklistConfig([], full))).toEqual(["Paper Towels", "Milk", "Hand Soap"]);
    expect(names(mergeChecklistConfig(undefined, full))).toEqual(["Paper Towels", "Milk", "Hand Soap"]);
    expect(names(mergeChecklistConfig(full, []))).toEqual(["Paper Towels", "Milk", "Hand Soap"]);
  });

  it("items added on each device are both kept", () => {
    const phone = [...full, item("d", "Razors")];
    const laptop = [...full, item("e", "Shampoo")];
    expect(names(mergeChecklistConfig(phone, laptop))).toEqual(["Paper Towels", "Milk", "Hand Soap", "Razors", "Shampoo"]);
  });

  it("a removal sticks, even when the other copy still lists the item", () => {
    const afterRemoval = full.filter((e) => e.id !== "b");
    expect(names(mergeChecklistConfig(afterRemoval, full, ["b"]))).toEqual(["Paper Towels", "Hand Soap"]);
    expect(names(mergeChecklistConfig(full, afterRemoval, new Set(["b"])))).toEqual(["Paper Towels", "Hand Soap"]);
  });

  it("without a recorded removal, an item missing from one copy stays", () => {
    expect(names(mergeChecklistConfig(full.filter((e) => e.id !== "b"), full))).toEqual(["Paper Towels", "Hand Soap", "Milk"]);
  });

  it("order follows the newer copy", () => {
    const reordered = [full[2], full[0], full[1]];
    expect(names(mergeChecklistConfig(reordered, full))).toEqual(["Hand Soap", "Paper Towels", "Milk"]);
  });

  it("the same name under two ids is kept once; bad entries are dropped", () => {
    const merged = mergeChecklistConfig([item("x1", "Milk")], [item("x2", "milk "), item("", "No id"), item("y", ""), null]);
    expect(merged).toEqual([item("x1", "Milk")]);
  });
});
