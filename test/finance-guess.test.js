import { describe, it, expect } from "vitest";
import { labelProfile, merchantDecision, itemKey, categoryForKind, guessForMerchant, guessForLine, splitFromLines, addCount, isMemoryKey, ITEM_PREFIX, AI_PREFIX } from "../finance-guess.js";

const FOOD = "cat:needs:food";
const BOOZE = "cat:wants:booze";
const OUT = "cat:wants:eatout";
const GAS = "cat:needs:transport";
const CATS = [
  { key: "cat:needs:housing", name: "Needs · Housing" },
  { key: FOOD, name: "Needs · Food" },
  { key: GAS, name: "Needs · Transportation" },
  { key: "cat:needs:util", name: "Needs · Utilities" },
  { key: OUT, name: "Wants · Eating Out" },
  { key: BOOZE, name: "Wants · Booze" },
  { key: "cat:wants:ent", name: "Wants · Entertainment" },
];

describe("merchant memory", () => {
  it("files a consistent store on its own after two approvals", () => {
    expect(merchantDecision({ [FOOD]: 2 })).toEqual({ auto: FOOD, guess: FOOD, mixed: false });
  });
  it("only guesses after one approval", () => {
    expect(merchantDecision({ [FOOD]: 1 })).toEqual({ auto: null, guess: FOOD, mixed: false });
  });
  it("never files a mixed store on its own (Trader Joe's: food and booze)", () => {
    expect(merchantDecision({ [FOOD]: 9, [BOOZE]: 1 })).toEqual({ auto: null, guess: FOOD, mixed: true });
  });
  it("ignores zero and junk counts", () => {
    expect(labelProfile({ [FOOD]: 0, x: "a" })).toBeNull();
    expect(merchantDecision(null)).toEqual({ auto: null, guess: null, mixed: false });
  });
  it("item and AI entries are not merchant memory", () => {
    expect(isMemoryKey("trader joe s")).toBe(true);
    expect(isMemoryKey(ITEM_PREFIX + "wine")).toBe(false);
    expect(isMemoryKey(AI_PREFIX + "x")).toBe(false);
  });
});

describe("itemKey", () => {
  it("drops sizes, codes and punctuation", () => {
    expect(itemKey("TJ's Unexpected Cheddar 7 OZ")).toBe("tj unexpected cheddar");
    expect(itemKey("2x  Paper Towels 12 ct")).toBe("paper towels");
    expect(itemKey("")).toBe("");
  });
});

describe("categoryForKind", () => {
  it("finds the user's own category by name", () => {
    expect(categoryForKind("groceries", CATS)).toBe(FOOD);
    expect(categoryForKind("alcohol", CATS)).toBe(BOOZE);
    expect(categoryForKind("dining", CATS)).toBe(OUT);
    expect(categoryForKind("gas", CATS)).toBe(GAS);
  });
  it("is null when there is no such category", () => {
    expect(categoryForKind("alcohol", CATS.filter((c) => c.key !== BOOZE))).toBeNull();
  });
  it("Eating Out is not groceries", () => {
    expect(categoryForKind("groceries", [{ key: OUT, name: "Wants · Eating Out" }])).toBeNull();
  });
});

describe("guessForMerchant", () => {
  it("your own history comes first", () => {
    const g = guessForMerchant({ description: "ALDI 72031", merchantKey: "aldi", rules: { aldi: { [OUT]: 1 } }, categories: CATS });
    expect(g).toEqual({ label: OUT, source: "yours", mixed: false });
  });
  it("marks a mixed store", () => {
    const g = guessForMerchant({ description: "TRADER JOE S #710", merchantKey: "trader joe s", rules: { "trader joe s": { [FOOD]: 3, [BOOZE]: 1 } }, categories: CATS });
    expect(g).toEqual({ label: FOOD, source: "yours", mixed: true });
  });
  it("then the AI's answer, then the built-in list", () => {
    expect(guessForMerchant({ description: "BLUEAIR INC", merchantKey: "blueair", rules: { [AI_PREFIX + "blueair"]: { "cat:needs:housing": 1 } }, categories: CATS }).source).toBe("ai");
    expect(guessForMerchant({ description: "ALDI 72031", merchantKey: "aldi", rules: {}, categories: CATS })).toEqual({ label: FOOD, source: "common", mixed: false });
    expect(guessForMerchant({ description: "HOLIDAY STATIONSTORES", merchantKey: "holiday stationstores", rules: {}, categories: CATS })?.label).toBe(GAS);
    expect(guessForMerchant({ description: "SQ *DANGEROUS MAN BREW", merchantKey: "sq dangerous man", rules: {}, categories: CATS })?.label).toBe(BOOZE);
  });
  it("drops a guess for a category that no longer exists", () => {
    expect(guessForMerchant({ description: "ZZZ", merchantKey: "zzz", rules: { zzz: { "cat:gone:x": 3 } }, categories: CATS })).toBeNull();
  });
});

describe("guessForLine", () => {
  it("your item history beats the reader", () => {
    expect(guessForLine({ name: "Paper Towels 12 ct", readCategory: FOOD, rules: { [ITEM_PREFIX + "paper towels"]: { "cat:needs:housing": 1 } }, categories: CATS }))
      .toEqual({ label: "cat:needs:housing", source: "yours", mixed: false });
  });
  it("drinks go to Booze even when the reader said Food", () => {
    expect(guessForLine({ name: "Charles Shaw Cabernet", readCategory: FOOD, rules: {}, categories: CATS })?.label).toBe(BOOZE);
    expect(guessForLine({ name: "Simpler Times IPA 6pk", readCategory: "", rules: {}, categories: CATS })?.label).toBe(BOOZE);
  });
  it("falls back to the reader's category", () => {
    expect(guessForLine({ name: "Bananas", readCategory: FOOD, rules: {}, categories: CATS })).toEqual({ label: FOOD, source: "receipt", mixed: false });
    expect(guessForLine({ name: "Bananas", readCategory: "", rules: {}, categories: CATS })).toBeNull();
  });
});

describe("splitFromLines", () => {
  it("spreads tax across the categories so it adds up to the charge", () => {
    const p = splitFromLines([{ price: 30, label: FOOD }, { price: 10, label: BOOZE }, { price: 10, label: FOOD }], 53.5);
    expect(p).toEqual([{ label: FOOD, amount: 42.8 }, { label: BOOZE, amount: 10.7 }]);
    expect(p.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(53.5, 2);
  });
  it("one category is the whole charge", () => {
    expect(splitFromLines([{ price: 3, label: FOOD }, { price: 4, label: FOOD }], 7.49)).toEqual([{ label: FOOD, amount: 7.49 }]);
  });
  it("rounding drift lands on the biggest portion", () => {
    const p = splitFromLines([{ price: 1, label: FOOD }, { price: 1, label: BOOZE }, { price: 1, label: OUT }], 10);
    expect(p.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(10, 5);
  });
  it("discount lines are spread, not categorized", () => {
    expect(splitFromLines([{ price: 10, label: FOOD }, { price: -2, label: "" }, { price: 10, label: BOOZE }], 18)).toEqual([{ label: FOOD, amount: 9 }, { label: BOOZE, amount: 9 }]);
  });
  it("null when a priced line has no category", () => {
    expect(splitFromLines([{ price: 3, label: FOOD }, { price: 4, label: "" }], 7)).toBeNull();
    expect(splitFromLines([{ price: 3, label: FOOD }], 0)).toBeNull();
  });
});

it("addCount doesn't mutate", () => {
  const a = { [FOOD]: 1 };
  expect(addCount(a, BOOZE)).toEqual({ [FOOD]: 1, [BOOZE]: 1 });
  expect(a).toEqual({ [FOOD]: 1 });
});
