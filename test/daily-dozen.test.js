const test = require("node:test");
const assert = require("node:assert/strict");

const dailyDozen = require("../daily-dozen");

test("daily progress is isolated by family member", () => {
  const entries = dailyDozen.normalizeEntries([
    { id: "1", familyMemberId: "luke", categoryId: "beans", date: "2026-06-07", servingsCompleted: 2 },
    { id: "2", familyMemberId: "marijane", categoryId: "beans", date: "2026-06-07", servingsCompleted: 1 }
  ]);
  assert.equal(dailyDozen.progressFor(entries, "luke", "2026-06-07").find((item) => item.id === "beans").servingsCompleted, 2);
  assert.equal(dailyDozen.progressFor(entries, "marijane", "2026-06-07").find((item) => item.id === "beans").servingsCompleted, 1);
});

test("one grocery item supports multiple Daily Dozen tags", () => {
  const tags = dailyDozen.normalizeTagMap({
    kale: [
      { categoryId: "greens", confidenceScore: 1 },
      { categoryId: "cruciferous-vegetables", confidenceScore: 1 }
    ]
  });
  assert.deepEqual(tags.kale.map((tag) => tag.categoryId), ["greens", "cruciferous-vegetables"]);
});

test("manual serving adjustments aggregate without replacing prior entries", () => {
  const entries = dailyDozen.normalizeEntries([
    { id: "1", familyMemberId: "sophia", categoryId: "berries", date: "2026-06-07", servingsCompleted: 0.5 },
    { id: "2", familyMemberId: "sophia", categoryId: "berries", date: "2026-06-07", servingsCompleted: 0.5 }
  ]);
  assert.equal(dailyDozen.progressFor(entries, "sophia", "2026-06-07").find((item) => item.id === "berries").servingsCompleted, 1);
});

test("date keys reset at local midnight", () => {
  assert.equal(dailyDozen.localDateKey(new Date(2026, 5, 7, 23, 59)), "2026-06-07");
  assert.equal(dailyDozen.localDateKey(new Date(2026, 5, 8, 0, 1)), "2026-06-08");
});

test("recipe suggestions never create progress entries", () => {
  const tagMap = dailyDozen.seededTagMap((value) => value.toLowerCase());
  const suggestions = dailyDozen.recipeSuggestions(
    [{ item: "kale" }, { item: "chickpeas" }, { item: "brown rice" }],
    tagMap,
    (value) => value === "chickpeas" ? "garbanzo beans" : value.toLowerCase()
  );
  assert.deepEqual(new Set(suggestions.map((item) => item.categoryId)), new Set([
    "beans", "cruciferous-vegetables", "greens", "whole-grains"
  ]));
  assert.equal(dailyDozen.progressFor([], "luke", "2026-06-07").reduce((sum, item) => sum + item.servingsCompleted, 0), 0);
});

test("common recipe ingredient forms receive seeded suggestions", () => {
  const tagMap = dailyDozen.seededTagMap((value) => value.toLowerCase());
  const suggestions = dailyDozen.recipeSuggestions(
    [{ item: "rolled oats" }, { item: "mixed berries" }, { item: "chia seeds" }],
    tagMap,
    (value) => value.toLowerCase()
  );
  assert.deepEqual(new Set(suggestions.map((item) => item.categoryId)), new Set([
    "berries", "nuts-seeds", "whole-grains"
  ]));
});
