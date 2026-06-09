const test = require("node:test");
const assert = require("node:assert/strict");
const foodHealth = require("../food-health");

const members = ["luke", "marijane", "sophia"];

function recipeEstimate(calories = 400) {
  return { nutritionEstimate: { perServing: { calories, protein: 20, carbs: 40, fat: 12, fiber: 8, sugar: 4, sodium: 500, saturatedFat: 2 }, confidenceScore: 0.8 } };
}

test("logging a recipe updates daily nutrition totals using serving size", () => {
  const entry = foodHealth.normalizeFoodLogEntries([{
    id: "log-1", familyMemberId: "luke", date: "2026-06-07", sourceType: "recipe",
    servingMultiplier: 0.5, mealType: "lunch",
    nutritionSnapshot: foodHealth.snapshotFromRecipe(recipeEstimate(), 0.5, "log-1")
  }], members)[0];
  assert.equal(foodHealth.nutritionTotals([entry], "luke", "2026-06-07").calories, 200);
  assert.equal(foodHealth.nutritionTotals([entry], "luke", "2026-06-07").protein, 10);
});

test("recipe checklist suggestions can be confirmed without auto-counting", () => {
  const templates = foodHealth.builtInTemplates([{ id: "beans", name: "Beans", dailyTargetServings: 3 }]);
  const entry = foodHealth.normalizeFoodLogEntries([{
    id: "log-1", familyMemberId: "luke", date: "2026-06-07", sourceType: "recipe", mealType: "dinner",
    checklistContributions: [{ checklistItemId: "daily-dozen:beans", estimatedServings: 1, userConfirmed: false }]
  }], members)[0];
  const before = foodHealth.checklistProgress({ template: templates[0], settings: {}, manualEntries: [], foodLogEntries: [entry], personId: "luke", date: "2026-06-07" });
  assert.equal(before[0].completedAmount, 0);
  entry.checklistContributions[0].userConfirmed = true;
  const after = foodHealth.checklistProgress({ template: templates[0], settings: {}, manualEntries: [], foodLogEntries: [entry], personId: "luke", date: "2026-06-07" });
  assert.equal(after[0].completedAmount, 1);
});

test("copying a meal preserves snapshots and changes family member", () => {
  const source = foodHealth.normalizeFoodLogEntries([{
    id: "log-1", familyMemberId: "luke", date: "2026-06-07", sourceType: "recipe", mealType: "dinner",
    nutritionSnapshot: foodHealth.snapshotFromRecipe(recipeEstimate(300), 1, "log-1")
  }], members)[0];
  const copy = foodHealth.copyFoodLogEntry(source, "marijane", "log-2");
  assert.equal(copy.familyMemberId, "marijane");
  assert.equal(copy.nutritionSnapshot.calories, 300);
  assert.equal(copy.nutritionSnapshot.foodLogEntryId, "log-2");
});

test("Sophia does not use adult targets by default", () => {
  const templates = foodHealth.builtInTemplates([]);
  const settings = foodHealth.normalizePersonSettings({}, [{ id: "sophia", name: "Sophia" }], templates);
  assert.equal(settings.sophia.useAdultNutritionTargets, false);
});

test("nutrition snapshots do not change when a recipe changes later", () => {
  const recipe = recipeEstimate(400);
  const snapshot = foodHealth.snapshotFromRecipe(recipe, 1, "log-1");
  recipe.nutritionEstimate.perServing.calories = 900;
  assert.equal(snapshot.calories, 400);
});

test("manual checklist edits are preserved beside food log contributions", () => {
  const templates = foodHealth.builtInTemplates([{ id: "beans", name: "Beans", dailyTargetServings: 3 }]);
  const manual = [{ id: "manual-1", personId: "luke", checklistItemId: "daily-dozen:beans", date: "2026-06-07", completedAmount: 1, sourceType: "manual" }];
  const food = [{ id: "food-1", familyMemberId: "luke", date: "2026-06-07", sourceType: "recipe", mealType: "lunch", checklistContributions: [{ checklistItemId: "daily-dozen:beans", estimatedServings: 1, userConfirmed: true }] }];
  const progress = foodHealth.checklistProgress({ template: templates[0], settings: {}, manualEntries: manual, foodLogEntries: food, personId: "luke", date: "2026-06-07" });
  assert.equal(progress[0].completedAmount, 2);
});

test("existing Daily Dozen entries migrate into generic checklist entries", () => {
  const migrated = foodHealth.migrateDailyDozenEntries([{
    id: "legacy-1",
    familyMemberId: "marijane",
    categoryId: "greens",
    date: "2026-06-07",
    servingsCompleted: 2,
    sourceType: "manual"
  }]);
  assert.deepEqual(migrated[0], {
    id: "legacy-1",
    personId: "marijane",
    checklistItemId: "daily-dozen:greens",
    date: "2026-06-07",
    completedAmount: 2,
    notes: "",
    sourceType: "manual",
    sourceId: ""
  });
});

test("per-person hidden items and target overrides shape checklist progress", () => {
  const template = foodHealth.builtInTemplates([
    { id: "beans", name: "Beans", dailyTargetServings: 3 },
    { id: "greens", name: "Greens", dailyTargetServings: 2 }
  ])[0];
  const progress = foodHealth.checklistProgress({
    template,
    settings: {
      hiddenItems: ["daily-dozen:greens"],
      customTargets: { "daily-dozen:beans": 4 }
    },
    manualEntries: [],
    foodLogEntries: [],
    personId: "luke",
    date: "2026-06-07"
  });
  assert.equal(progress.length, 1);
  assert.equal(progress[0].id, "daily-dozen:beans");
  assert.equal(progress[0].targetFrequency, 4);
});
