"use strict";

const nutrientKeys = ["calories", "protein", "carbs", "fat", "fiber", "sugar", "sodium", "saturatedFat"];
const mealTypes = ["breakfast", "lunch", "dinner", "snack"];

function builtInTemplates(dailyDozenCategories = [], placeholderTemplates = []) {
  const dailyItems = dailyDozenCategories.map((category) => ({
    id: `daily-dozen:${category.id}`,
    templateId: "daily-dozen",
    name: category.name,
    description: category.servingGuidance || "",
    targetFrequency: Number(category.dailyTargetServings) || 1,
    sortOrder: Number(category.sortOrder) || 0,
    categoryType: category.id === "beverages" ? "beverage"
      : category.id === "exercise" ? "exercise"
        : "food",
    legacyCategoryId: category.id
  }));
  const placeholders = new Map((Array.isArray(placeholderTemplates) ? placeholderTemplates : [])
    .map((template) => [template.id, template]));
  const tweaks = placeholders.get("twenty-one-tweaks") || {
    id: "twenty-one-tweaks",
    name: "21 Tweaks for Weight Loss",
    description: "Placeholder awaiting reviewed checklist items.",
    sourceName: "NutritionFacts.org",
    isBuiltIn: true,
    items: []
  };
  const ldl = placeholders.get("maximally-ldl-lowering") || {
    id: "maximally-ldl-lowering",
    name: "Maximally LDL-Lowering Checklist",
    description: "Placeholder awaiting reviewed checklist items.",
    sourceName: "",
    isBuiltIn: true,
    items: []
  };
  return [
    {
      id: "daily-dozen",
      name: "Daily Dozen",
      description: "Inspired by Dr. Greger's Daily Dozen / NutritionFacts.org.",
      sourceName: "NutritionFacts.org",
      isBuiltIn: true,
      items: dailyItems
    },
    {
      id: "daily-dozen-plus-21",
      name: "Daily Dozen + 21 Tweaks",
      description: "Daily Dozen plus a placeholder for reviewed 21 Tweaks items.",
      sourceName: "NutritionFacts.org",
      isBuiltIn: true,
      items: [...dailyItems, ...normalizeChecklistItems(tweaks.items, tweaks.id)]
    },
    ldl,
    {
      id: "custom",
      name: "Custom",
      description: "A personal checklist configured by the user.",
      sourceName: "",
      isBuiltIn: true,
      items: []
    },
    tweaks
  ];
}

function defaultPersonSettings(members = []) {
  return Object.fromEntries(members.map((member) => [member.id, {
    personId: member.id,
    templateId: "daily-dozen",
    enabled: true,
    customTargets: {},
    hiddenItems: [],
    nutritionTargets: {},
    useAdultNutritionTargets: member.id !== "sophia"
  }]));
}

function normalizeTemplates(templates, dailyDozenCategories = []) {
  const source = Array.isArray(templates) && templates.length ? templates : builtInTemplates(dailyDozenCategories);
  const seen = new Set();
  return source.map((template) => ({
    id: String(template?.id || "").trim(),
    name: String(template?.name || "").trim(),
    description: String(template?.description || "").trim(),
    sourceName: String(template?.sourceName || "").trim(),
    isBuiltIn: template?.isBuiltIn !== false,
    items: normalizeChecklistItems(template?.items, template?.id)
  })).filter((template) => template.id && template.name && !seen.has(template.id) && seen.add(template.id));
}

function normalizeChecklistItems(items, templateId = "") {
  const validTypes = new Set(["food", "beverage", "behavior", "exercise", "supplement", "other"]);
  const seen = new Set();
  return (Array.isArray(items) ? items : []).map((item, index) => ({
    id: String(item?.id || "").trim(),
    templateId: String(item?.templateId || templateId).trim(),
    name: String(item?.name || "").trim(),
    description: String(item?.description || "").trim(),
    targetFrequency: Math.max(0.1, Number(item?.targetFrequency) || 1),
    sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Number(item.sortOrder) : (index + 1) * 10,
    categoryType: validTypes.has(item?.categoryType) ? item.categoryType : "other",
    legacyCategoryId: String(item?.legacyCategoryId || "").trim()
  })).filter((item) => item.id && item.name && !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function normalizePersonSettings(settings, members = [], templates = []) {
  const defaults = defaultPersonSettings(members);
  const templateIds = new Set(templates.map((template) => template.id));
  const source = settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
  return Object.fromEntries(members.map((member) => {
    const value = source[member.id] || defaults[member.id];
    const templateId = templateIds.has(value?.templateId) ? value.templateId : "daily-dozen";
    return [member.id, {
      personId: member.id,
      templateId,
      enabled: value?.enabled !== false,
      customTargets: normalizeNumberMap(value?.customTargets),
      hiddenItems: [...new Set((Array.isArray(value?.hiddenItems) ? value.hiddenItems : []).map(String).filter(Boolean))],
      nutritionTargets: normalizeNumberMap(value?.nutritionTargets),
      useAdultNutritionTargets: member.id === "sophia" ? Boolean(value?.useAdultNutritionTargets) : value?.useAdultNutritionTargets !== false
    }];
  }));
}

function normalizeNumberMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .map(([key, amount]) => [String(key), Number(amount)])
    .filter(([key, amount]) => key && Number.isFinite(amount) && amount >= 0));
}

function emptyNutrition() {
  return Object.fromEntries(nutrientKeys.map((key) => [key, 0]));
}

function normalizeNutritionSnapshot(snapshot, foodLogEntryId = "") {
  const result = { foodLogEntryId: String(snapshot?.foodLogEntryId || foodLogEntryId), sourceConfidenceScore: clamp(snapshot?.sourceConfidenceScore, 0, 1, 0) };
  nutrientKeys.forEach((key) => {
    result[key] = Math.max(0, Number(snapshot?.[key]) || 0);
  });
  return result;
}

function snapshotFromRecipe(recipe, servingMultiplier = 1, foodLogEntryId = "") {
  const perServing = recipe?.nutritionEstimate?.perServing || {};
  const multiplier = Math.max(0, Number(servingMultiplier) || 0);
  return normalizeNutritionSnapshot({
    foodLogEntryId,
    ...Object.fromEntries(nutrientKeys.map((key) => [key, (Number(perServing[key]) || 0) * multiplier])),
    sourceConfidenceScore: Number(recipe?.nutritionEstimate?.confidenceScore) || 0
  }, foodLogEntryId);
}

function snapshotFromValues(values, servingMultiplier = 1, foodLogEntryId = "", confidenceScore = 1) {
  const multiplier = Math.max(0, Number(servingMultiplier) || 0);
  return normalizeNutritionSnapshot({
    foodLogEntryId,
    ...Object.fromEntries(nutrientKeys.map((key) => [key, (Number(values?.[key]) || 0) * multiplier])),
    sourceConfidenceScore: confidenceScore
  }, foodLogEntryId);
}

function normalizeFoodLogEntries(entries, memberIds = []) {
  const validMembers = new Set(memberIds);
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const id = String(entry?.id || "").trim();
return {
      id,
      familyMemberId: String(entry?.familyMemberId || "").trim(),
      date: String(entry?.date || "").slice(0, 10),
      sourceType: ["recipe", "grocery_item", "manual"].includes(entry?.sourceType) ? entry.sourceType : "manual",
      sourceId: String(entry?.sourceId || "").trim(),
      displayName: String(entry?.displayName || "").trim(),
      servingMultiplier: Math.max(0.01, Number(entry?.servingMultiplier) || 1),
      mealType: mealTypes.includes(entry?.mealType) ? entry.mealType : "snack",
      notes: String(entry?.notes || "").trim(),
      leftovers: Boolean(entry?.leftovers),
      nutritionSnapshot: normalizeNutritionSnapshot(entry?.nutritionSnapshot, id),
      checklistContributions: normalizeContributions(entry?.checklistContributions, id)
    };
  }).filter((entry) => entry.id && validMembers.has(entry.familyMemberId) && /^\d{4}-\d{2}-\d{2}$/.test(entry.date));
}

function normalizeContributions(contributions, foodLogEntryId = "") {
  return (Array.isArray(contributions) ? contributions : []).map((contribution) => ({
    foodLogEntryId: String(contribution?.foodLogEntryId || foodLogEntryId),
    checklistItemId: String(contribution?.checklistItemId || contribution?.categoryId || "").trim(),
    estimatedServings: Math.max(0, Number(contribution?.estimatedServings) || 0),
    userConfirmed: Boolean(contribution?.userConfirmed),
    confidenceScore: clamp(contribution?.confidenceScore, 0, 1, 0)
  })).filter((contribution) => contribution.checklistItemId && contribution.estimatedServings > 0);
}

function normalizeDailyChecklistEntries(entries, memberIds = []) {
  const validMembers = new Set(memberIds);
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: String(entry?.id || "").trim(),
    personId: String(entry?.personId || entry?.familyMemberId || "").trim(),
    checklistItemId: String(entry?.checklistItemId || entry?.categoryId || "").trim(),
    date: String(entry?.date || "").slice(0, 10),
    completedAmount: Math.max(0, Number(entry?.completedAmount ?? entry?.servingsCompleted) || 0),
    notes: String(entry?.notes || "").trim(),
    sourceType: ["manual", "recipe", "food_log", "exercise", "custom"].includes(entry?.sourceType) ? entry.sourceType : "manual",
    sourceId: String(entry?.sourceId || "").trim()
  })).filter((entry) => entry.id && validMembers.has(entry.personId)
    && entry.checklistItemId && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.completedAmount > 0);
}

function migrateDailyDozenEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    id: entry.id,
    personId: entry.familyMemberId,
    checklistItemId: `daily-dozen:${entry.categoryId}`,
    date: entry.date,
    completedAmount: entry.servingsCompleted,
    notes: entry.notes || "",
    sourceType: entry.sourceType === "recipe" ? "recipe" : "manual",
    sourceId: entry.sourceId || ""
  }));
}

function nutritionTotals(entries, memberId, date) {
  const totals = emptyNutrition();
  normalizeFoodLogEntries(entries, [memberId]).forEach((entry) => {
    if (entry.familyMemberId !== memberId || entry.date !== date) return;
    nutrientKeys.forEach((key) => {
      totals[key] += Number(entry.nutritionSnapshot?.[key]) || 0;
    });
  });
  return totals;
}

function checklistProgress({ template, settings, manualEntries, foodLogEntries, personId, date }) {
  const hidden = new Set(settings?.hiddenItems || []);
  const customTargets = settings?.customTargets || {};
  const totals = {};
  normalizeDailyChecklistEntries(manualEntries, [personId]).forEach((entry) => {
    if (entry.personId !== personId || entry.date !== date) return;
    totals[entry.checklistItemId] = (totals[entry.checklistItemId] || 0) + entry.completedAmount;
  });
  normalizeFoodLogEntries(foodLogEntries, [personId]).forEach((entry) => {
    if (entry.familyMemberId !== personId || entry.date !== date) return;
    entry.checklistContributions.filter((contribution) => contribution.userConfirmed).forEach((contribution) => {
      totals[contribution.checklistItemId] = (totals[contribution.checklistItemId] || 0) + contribution.estimatedServings;
    });
  });
  return (template?.items || []).filter((item) => !hidden.has(item.id)).map((item) => {
    const target = Number(customTargets[item.id]) || item.targetFrequency;
    const completed = totals[item.id] || 0;
return { ...item, targetFrequency: target, completedAmount: completed, percent: Math.min(100, completed / target * 100) };
  });
}

function copyFoodLogEntry(entry, nextPersonId, nextId) {
return {
    ...entry,
    id: nextId,
    familyMemberId: nextPersonId,
    nutritionSnapshot: { ...entry.nutritionSnapshot, foodLogEntryId: nextId },
    checklistContributions: (entry.checklistContributions || []).map((contribution) => ({ ...contribution, foodLogEntryId: nextId }))
  };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export {
  nutrientKeys,
  mealTypes,
  builtInTemplates,
  defaultPersonSettings,
  normalizeTemplates,
  normalizeChecklistItems,
  normalizePersonSettings,
  normalizeNutritionSnapshot,
  snapshotFromRecipe,
  snapshotFromValues,
  normalizeFoodLogEntries,
  normalizeContributions,
  normalizeDailyChecklistEntries,
  migrateDailyDozenEntries,
  nutritionTotals,
  checklistProgress,
  copyFoodLogEntry
};
