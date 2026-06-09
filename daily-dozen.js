(function dailyDozenFactory(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LiveDailyDozen = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createDailyDozen() {
"use strict";

const categories = [
  { id: "beans", name: "Beans", dailyTargetServings: 3, servingGuidance: "About 1/2 cup cooked beans, lentils, tofu, or tempeh.", sortOrder: 10 },
  { id: "berries", name: "Berries", dailyTargetServings: 1, servingGuidance: "About 1/2 cup fresh or frozen berries.", sortOrder: 20 },
  { id: "other-fruits", name: "Other Fruits", dailyTargetServings: 3, servingGuidance: "One medium fruit or about 1 cup cut fruit.", sortOrder: 30 },
  { id: "cruciferous-vegetables", name: "Cruciferous Vegetables", dailyTargetServings: 1, servingGuidance: "About 1/2 cup chopped cruciferous vegetables.", sortOrder: 40 },
  { id: "greens", name: "Greens", dailyTargetServings: 2, servingGuidance: "About 1 cup raw or 1/2 cup cooked leafy greens.", sortOrder: 50 },
  { id: "other-vegetables", name: "Other Vegetables", dailyTargetServings: 2, servingGuidance: "About 1/2 cup non-leafy vegetables.", sortOrder: 60 },
  { id: "flaxseed", name: "Flaxseed", dailyTargetServings: 1, servingGuidance: "About 1 tablespoon ground flaxseed.", sortOrder: 70 },
  { id: "nuts-seeds", name: "Nuts and Seeds", dailyTargetServings: 1, servingGuidance: "About 1/4 cup nuts or 2 tablespoons nut or seed butter.", sortOrder: 80 },
  { id: "herbs-spices", name: "Herbs and Spices", dailyTargetServings: 1, servingGuidance: "Include herbs or spices, such as 1/4 teaspoon turmeric.", sortOrder: 90 },
  { id: "whole-grains", name: "Whole Grains", dailyTargetServings: 3, servingGuidance: "About 1/2 cup cooked whole grains or one slice whole-grain bread.", sortOrder: 100 },
  { id: "beverages", name: "Beverages", dailyTargetServings: 5, servingGuidance: "One glass or cup of water, tea, or coffee.", sortOrder: 110 },
  { id: "exercise", name: "Exercise", dailyTargetServings: 1, servingGuidance: "A daily movement session appropriate for you.", sortOrder: 120 }
];

const familyMembers = [
  { id: "luke", name: "Luke" },
  { id: "marijane", name: "Marijane" },
  { id: "sophia", name: "Sophia" }
];

const seededTags = {
  lentil: ["beans"],
  "garbanzo beans": ["beans"],
  "black beans": ["beans"],
  tofu: ["beans"],
  tempeh: ["beans"],
  blueberry: ["berries"],
  strawberry: ["berries"],
  raspberry: ["berries"],
  "mixed berries": ["berries"],
  apple: ["other-fruits"],
  banana: ["other-fruits"],
  orange: ["other-fruits"],
  broccoli: ["cruciferous-vegetables"],
  cauliflower: ["cruciferous-vegetables"],
  cabbage: ["cruciferous-vegetables"],
  kale: ["cruciferous-vegetables", "greens"],
  "Brussels sprouts": ["cruciferous-vegetables"],
  spinach: ["greens"],
  collards: ["greens"],
  "collard greens": ["greens"],
  "romaine lettuce": ["greens"],
  carrot: ["other-vegetables"],
  "bell pepper": ["other-vegetables"],
  mushroom: ["other-vegetables"],
  onion: ["other-vegetables"],
  "sweet potato": ["other-vegetables"],
  "ground flaxseed": ["flaxseed"],
  flaxseed: ["flaxseed"],
  walnut: ["nuts-seeds"],
  almond: ["nuts-seeds"],
  "chia seeds": ["nuts-seeds"],
  "peanut butter": ["nuts-seeds"],
  turmeric: ["herbs-spices"],
  cinnamon: ["herbs-spices"],
  garlic: ["herbs-spices"],
  ginger: ["herbs-spices"],
  herbs: ["herbs-spices"],
  basil: ["herbs-spices"],
  cilantro: ["herbs-spices"],
  dill: ["herbs-spices"],
  parsley: ["herbs-spices"],
  rosemary: ["herbs-spices"],
  thyme: ["herbs-spices"],
  oat: ["whole-grains"],
  "rolled oats": ["whole-grains"],
  "brown rice": ["whole-grains"],
  quinoa: ["whole-grains"],
  "whole wheat bread": ["whole-grains"],
  "corn tortilla": ["whole-grains"],
  water: ["beverages"],
  tea: ["beverages"],
  coffee: ["beverages"]
};

function localDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCategories(value) {
  const source = Array.isArray(value) && value.length ? value : categories;
  const seen = new Set();
  return source
    .map((category, index) => ({
      id: String(category?.id || "").trim(),
      name: String(category?.name || "").trim(),
      dailyTargetServings: Math.max(1, Number(category?.dailyTargetServings) || 1),
      servingGuidance: String(category?.servingGuidance || "").trim(),
      sortOrder: Number.isFinite(Number(category?.sortOrder)) ? Number(category.sortOrder) : (index + 1) * 10
    }))
    .filter((category) => category.id && category.name && !seen.has(category.id) && seen.add(category.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

function normalizeFamilyMembers(value) {
  const source = Array.isArray(value) && value.length ? value : familyMembers;
  const seen = new Set();
  return source
    .map((member) => ({ id: String(member?.id || "").trim(), name: String(member?.name || "").trim() }))
    .filter((member) => member.id && member.name && !seen.has(member.id) && seen.add(member.id));
}

function normalizeEntries(entries, validMembers = familyMembers, validCategories = categories) {
  const memberIds = new Set(normalizeFamilyMembers(validMembers).map((member) => member.id));
  const categoryIds = new Set(normalizeCategories(validCategories).map((category) => category.id));
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      id: String(entry?.id || "").trim(),
      familyMemberId: String(entry?.familyMemberId || "").trim(),
      categoryId: String(entry?.categoryId || "").trim(),
      date: String(entry?.date || "").slice(0, 10),
      servingsCompleted: Math.max(0, Number(entry?.servingsCompleted) || 0),
      sourceType: ["manual", "recipe", "grocery_item"].includes(entry?.sourceType) ? entry.sourceType : "manual",
      sourceId: String(entry?.sourceId || "").trim(),
      notes: String(entry?.notes || "").trim()
    }))
    .filter((entry) => entry.id && memberIds.has(entry.familyMemberId)
      && categoryIds.has(entry.categoryId) && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
      && entry.servingsCompleted > 0);
}

function normalizeTagMap(tagMap, validCategories = categories) {
  const categoryIds = new Set(normalizeCategories(validCategories).map((category) => category.id));
  const normalized = {};
  Object.entries(tagMap && typeof tagMap === "object" && !Array.isArray(tagMap) ? tagMap : {}).forEach(([itemId, tags]) => {
    const itemKey = String(itemId || "").trim();
    if (!itemKey) return;
    const seen = new Set();
    const list = (Array.isArray(tags) ? tags : [])
      .map((tag) => ({
        groceryItemId: itemKey,
        categoryId: String(tag?.categoryId || tag || "").trim(),
        confidenceScore: Math.max(0, Math.min(1, Number(tag?.confidenceScore ?? 1))),
        notes: String(tag?.notes || "").trim()
      }))
      .filter((tag) => categoryIds.has(tag.categoryId) && !seen.has(tag.categoryId) && seen.add(tag.categoryId));
    if (list.length) normalized[itemKey] = list;
  });
  return normalized;
}

function seededTagMap(normalizeItemName = (value) => String(value || "").toLowerCase().trim()) {
  const result = {};
  Object.entries(seededTags).forEach(([itemName, categoryIds]) => {
    const itemKey = normalizeItemName(itemName);
    if (!itemKey) return;
    result[itemKey] = categoryIds.map((categoryId) => ({
      groceryItemId: itemKey,
      categoryId,
      confidenceScore: 1,
      notes: "Seeded Daily Dozen catalog tag"
    }));
  });
  return result;
}

function progressFor(entries, familyMemberId, date, categoryList = categories) {
  const normalizedCategories = normalizeCategories(categoryList);
  const totals = Object.fromEntries(normalizedCategories.map((category) => [category.id, 0]));
  normalizeEntries(entries).forEach((entry) => {
    if (entry.familyMemberId !== familyMemberId || entry.date !== date) return;
    totals[entry.categoryId] = (totals[entry.categoryId] || 0) + entry.servingsCompleted;
  });
  return normalizedCategories.map((category) => ({
    ...category,
    servingsCompleted: totals[category.id] || 0,
    remaining: Math.max(0, category.dailyTargetServings - (totals[category.id] || 0)),
    percent: Math.min(100, ((totals[category.id] || 0) / category.dailyTargetServings) * 100)
  }));
}

function recipeSuggestions(ingredients, tagMap, normalizeItemName = (value) => String(value || "").toLowerCase().trim()) {
  const matches = new Map();
  (Array.isArray(ingredients) ? ingredients : []).forEach((ingredient) => {
    const rawItem = typeof ingredient === "string" ? ingredient : ingredient?.item;
    const itemKey = normalizeItemName(rawItem);
    (tagMap[itemKey] || []).forEach((tag) => {
      if (!matches.has(tag.categoryId)) matches.set(tag.categoryId, { categoryId: tag.categoryId, itemNames: new Set(), confidenceScore: 0 });
      const match = matches.get(tag.categoryId);
      match.itemNames.add(String(rawItem || "").trim());
      match.confidenceScore = Math.max(match.confidenceScore, Number(tag.confidenceScore) || 0);
    });
  });
  return [...matches.values()].map((match) => ({
    categoryId: match.categoryId,
    itemNames: [...match.itemNames],
    confidenceScore: match.confidenceScore
  }));
}

return {
  categories,
  familyMembers,
  seededTags,
  localDateKey,
  normalizeCategories,
  normalizeFamilyMembers,
  normalizeEntries,
  normalizeTagMap,
  seededTagMap,
  progressFor,
  recipeSuggestions
};
}));
