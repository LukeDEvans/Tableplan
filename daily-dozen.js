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
  // Beans
  lentils: ["beans"],
  "red lentils": ["beans"],
  "green lentils": ["beans"],
  "french lentils": ["beans"],
  "black lentils": ["beans"],
  "black beans": ["beans"],
  "kidney beans": ["beans"],
  "navy beans": ["beans"],
  "pinto beans": ["beans"],
  "cannellini beans": ["beans"],
  "great northern beans": ["beans"],
  "white beans": ["beans"],
  "chickpeas": ["beans"],
  "garbanzo beans": ["beans"],
  "split peas": ["beans"],
  "green peas": ["beans"],
  "yellow peas": ["beans"],
  "black-eyed peas": ["beans"],
  "mung beans": ["beans"],
  "adzuki beans": ["beans"],
  "fava beans": ["beans"],
  "lima beans": ["beans"],
  "butter beans": ["beans"],
  "refried beans": ["beans"],
  edamame: ["beans"],
  tofu: ["beans"],
  "silken tofu": ["beans"],
  "firm tofu": ["beans"],
  "extra firm tofu": ["beans"],
  tempeh: ["beans"],
  hummus: ["beans"],
  "soy milk": ["beans"],

  // Berries
  blueberries: ["berries"],
  strawberries: ["berries"],
  raspberries: ["berries"],
  blackberries: ["berries"],
  cranberries: ["berries"],
  "goji berries": ["berries"],
  boysenberries: ["berries"],
  currants: ["berries"],
  "mixed berries": ["berries"],
  "frozen berries": ["berries"],
  "acai": ["berries"],
  cherries: ["berries"],

  // Other Fruits
  apples: ["other-fruits"],
  pears: ["other-fruits"],
  peaches: ["other-fruits"],
  plums: ["other-fruits"],
  nectarines: ["other-fruits"],
  apricots: ["other-fruits"],
  oranges: ["other-fruits"],
  tangerines: ["other-fruits"],
  clementines: ["other-fruits"],
  mandarins: ["other-fruits"],
  grapefruit: ["other-fruits"],
  lemons: ["other-fruits"],
  limes: ["other-fruits"],
  bananas: ["other-fruits"],
  mangoes: ["other-fruits"],
  pineapple: ["other-fruits"],
  papaya: ["other-fruits"],
  kiwi: ["other-fruits"],
  guava: ["other-fruits"],
  pomegranate: ["other-fruits"],
  watermelon: ["other-fruits"],
  cantaloupe: ["other-fruits"],
  honeydew: ["other-fruits"],
  grapes: ["other-fruits"],
  "red grapes": ["other-fruits"],
  "green grapes": ["other-fruits"],
  figs: ["other-fruits"],
  dates: ["other-fruits"],
  prunes: ["other-fruits"],
  raisins: ["other-fruits"],
  avocado: ["other-fruits"],
  "dried mango": ["other-fruits"],
  "dried apricots": ["other-fruits"],

  // Cruciferous Vegetables
  broccoli: ["cruciferous-vegetables"],
  "broccoli florets": ["cruciferous-vegetables"],
  "broccoli rabe": ["cruciferous-vegetables"],
  cauliflower: ["cruciferous-vegetables"],
  cabbage: ["cruciferous-vegetables"],
  "red cabbage": ["cruciferous-vegetables"],
  "green cabbage": ["cruciferous-vegetables"],
  "savoy cabbage": ["cruciferous-vegetables"],
  "napa cabbage": ["cruciferous-vegetables"],
  "Brussels sprouts": ["cruciferous-vegetables"],
  kale: ["cruciferous-vegetables", "greens"],
  "lacinato kale": ["cruciferous-vegetables", "greens"],
  "curly kale": ["cruciferous-vegetables", "greens"],
  "baby kale": ["cruciferous-vegetables", "greens"],
  "bok choy": ["cruciferous-vegetables", "greens"],
  "baby bok choy": ["cruciferous-vegetables", "greens"],
  arugula: ["cruciferous-vegetables", "greens"],
  watercress: ["cruciferous-vegetables", "greens"],
  radishes: ["cruciferous-vegetables"],
  "daikon radish": ["cruciferous-vegetables"],
  turnips: ["cruciferous-vegetables"],
  "turnip greens": ["cruciferous-vegetables", "greens"],
  kohlrabi: ["cruciferous-vegetables"],
  rutabaga: ["cruciferous-vegetables"],
  "collard greens": ["cruciferous-vegetables", "greens"],
  collards: ["cruciferous-vegetables", "greens"],

  // Greens
  spinach: ["greens"],
  "baby spinach": ["greens"],
  "Swiss chard": ["greens"],
  "rainbow chard": ["greens"],
  "romaine lettuce": ["greens"],
  "iceberg lettuce": ["greens"],
  "butter lettuce": ["greens"],
  "mixed greens": ["greens"],
  "spring mix": ["greens"],
  "salad greens": ["greens"],
  "beet greens": ["greens"],
  "mustard greens": ["greens"],
  endive: ["greens"],
  radicchio: ["greens"],
  microgreens: ["greens"],
  "lettuce": ["greens"],

  // Other Vegetables
  carrots: ["other-vegetables"],
  "baby carrots": ["other-vegetables"],
  "bell peppers": ["other-vegetables"],
  "red bell pepper": ["other-vegetables"],
  "green bell pepper": ["other-vegetables"],
  "yellow bell pepper": ["other-vegetables"],
  "orange bell pepper": ["other-vegetables"],
  tomatoes: ["other-vegetables"],
  "cherry tomatoes": ["other-vegetables"],
  "roma tomatoes": ["other-vegetables"],
  "grape tomatoes": ["other-vegetables"],
  "canned tomatoes": ["other-vegetables"],
  "diced tomatoes": ["other-vegetables"],
  "crushed tomatoes": ["other-vegetables"],
  "tomato paste": ["other-vegetables"],
  "tomato sauce": ["other-vegetables"],
  zucchini: ["other-vegetables"],
  "yellow squash": ["other-vegetables"],
  "butternut squash": ["other-vegetables"],
  "acorn squash": ["other-vegetables"],
  "spaghetti squash": ["other-vegetables"],
  cucumbers: ["other-vegetables"],
  celery: ["other-vegetables"],
  "green beans": ["other-vegetables"],
  "snap peas": ["other-vegetables"],
  "snow peas": ["other-vegetables"],
  corn: ["other-vegetables"],
  "sweet corn": ["other-vegetables"],
  mushrooms: ["other-vegetables"],
  "cremini mushrooms": ["other-vegetables"],
  "portobello mushrooms": ["other-vegetables"],
  "shiitake mushrooms": ["other-vegetables"],
  "oyster mushrooms": ["other-vegetables"],
  onions: ["other-vegetables"],
  "red onion": ["other-vegetables"],
  "yellow onion": ["other-vegetables"],
  "white onion": ["other-vegetables"],
  "green onions": ["other-vegetables"],
  scallions: ["other-vegetables"],
  leeks: ["other-vegetables"],
  shallots: ["other-vegetables"],
  "sweet potatoes": ["other-vegetables"],
  yams: ["other-vegetables"],
  potatoes: ["other-vegetables"],
  "russet potatoes": ["other-vegetables"],
  "red potatoes": ["other-vegetables"],
  "yukon gold potatoes": ["other-vegetables"],
  beets: ["other-vegetables"],
  eggplant: ["other-vegetables"],
  asparagus: ["other-vegetables"],
  artichokes: ["other-vegetables"],
  fennel: ["other-vegetables"],
  jalapeños: ["other-vegetables"],
  "serrano peppers": ["other-vegetables"],
  "poblano peppers": ["other-vegetables"],
  pumpkin: ["other-vegetables"],
  "canned pumpkin": ["other-vegetables"],
  "peas": ["other-vegetables"],
  "frozen peas": ["other-vegetables"],
  "frozen corn": ["other-vegetables"],
  "frozen vegetables": ["other-vegetables"],
  cucumber: ["other-vegetables"],
  "hearts of palm": ["other-vegetables"],
  jicama: ["other-vegetables"],
  "water chestnuts": ["other-vegetables"],
  "bamboo shoots": ["other-vegetables"],

  // Flaxseed
  flaxseed: ["flaxseed"],
  flaxseeds: ["flaxseed"],
  "ground flaxseed": ["flaxseed"],
  "flax meal": ["flaxseed"],
  "golden flaxseed": ["flaxseed"],

  // Nuts and Seeds
  walnuts: ["nuts-seeds"],
  almonds: ["nuts-seeds"],
  cashews: ["nuts-seeds"],
  pecans: ["nuts-seeds"],
  pistachios: ["nuts-seeds"],
  "macadamia nuts": ["nuts-seeds"],
  "brazil nuts": ["nuts-seeds"],
  hazelnuts: ["nuts-seeds"],
  peanuts: ["nuts-seeds"],
  "mixed nuts": ["nuts-seeds"],
  "sunflower seeds": ["nuts-seeds"],
  "pumpkin seeds": ["nuts-seeds"],
  "sesame seeds": ["nuts-seeds"],
  "poppy seeds": ["nuts-seeds"],
  "hemp seeds": ["nuts-seeds"],
  "hemp hearts": ["nuts-seeds"],
  "chia seeds": ["nuts-seeds"],
  "pine nuts": ["nuts-seeds"],
  "peanut butter": ["nuts-seeds"],
  "almond butter": ["nuts-seeds"],
  "cashew butter": ["nuts-seeds"],
  "sunflower seed butter": ["nuts-seeds"],
  tahini: ["nuts-seeds"],
  "nut butter": ["nuts-seeds"],
  "trail mix": ["nuts-seeds"],

  // Herbs and Spices
  turmeric: ["herbs-spices"],
  cinnamon: ["herbs-spices"],
  ginger: ["herbs-spices"],
  "fresh ginger": ["herbs-spices"],
  garlic: ["herbs-spices"],
  "garlic powder": ["herbs-spices"],
  "garlic cloves": ["herbs-spices"],
  basil: ["herbs-spices"],
  "fresh basil": ["herbs-spices"],
  cilantro: ["herbs-spices"],
  parsley: ["herbs-spices"],
  mint: ["herbs-spices"],
  oregano: ["herbs-spices"],
  thyme: ["herbs-spices"],
  rosemary: ["herbs-spices"],
  sage: ["herbs-spices"],
  dill: ["herbs-spices"],
  chives: ["herbs-spices"],
  tarragon: ["herbs-spices"],
  cumin: ["herbs-spices"],
  coriander: ["herbs-spices"],
  paprika: ["herbs-spices"],
  "smoked paprika": ["herbs-spices"],
  "chili powder": ["herbs-spices"],
  "cayenne pepper": ["herbs-spices"],
  "black pepper": ["herbs-spices"],
  "bay leaves": ["herbs-spices"],
  cloves: ["herbs-spices"],
  allspice: ["herbs-spices"],
  nutmeg: ["herbs-spices"],
  "curry powder": ["herbs-spices"],
  "garam masala": ["herbs-spices"],
  cardamom: ["herbs-spices"],
  "chili flakes": ["herbs-spices"],
  "red pepper flakes": ["herbs-spices"],
  lemongrass: ["herbs-spices"],
  "Italian seasoning": ["herbs-spices"],
  "herbs de Provence": ["herbs-spices"],
  "mixed herbs": ["herbs-spices"],
  "onion powder": ["herbs-spices"],

  // Whole Grains
  oats: ["whole-grains"],
  "rolled oats": ["whole-grains"],
  "steel-cut oats": ["whole-grains"],
  oatmeal: ["whole-grains"],
  "quick oats": ["whole-grains"],
  "brown rice": ["whole-grains"],
  "wild rice": ["whole-grains"],
  "black rice": ["whole-grains"],
  "red rice": ["whole-grains"],
  quinoa: ["whole-grains"],
  farro: ["whole-grains"],
  barley: ["whole-grains"],
  bulgur: ["whole-grains"],
  millet: ["whole-grains"],
  amaranth: ["whole-grains"],
  teff: ["whole-grains"],
  buckwheat: ["whole-grains"],
  sorghum: ["whole-grains"],
  "whole wheat bread": ["whole-grains"],
  "whole grain bread": ["whole-grains"],
  "whole wheat pasta": ["whole-grains"],
  "whole wheat tortillas": ["whole-grains"],
  "corn tortillas": ["whole-grains"],
  popcorn: ["whole-grains"],
  "whole wheat flour": ["whole-grains"],
  "rye bread": ["whole-grains"],
  pumpernickel: ["whole-grains"],
  "whole wheat crackers": ["whole-grains"],
  "grain bread": ["whole-grains"],
  "sprouted grain bread": ["whole-grains"],
  "spelt": ["whole-grains"],
  "whole wheat pita": ["whole-grains"],

  // Beverages
  water: ["beverages"],
  "sparkling water": ["beverages"],
  "mineral water": ["beverages"],
  tea: ["beverages"],
  "green tea": ["beverages"],
  "black tea": ["beverages"],
  "white tea": ["beverages"],
  "herbal tea": ["beverages"],
  "chamomile tea": ["beverages"],
  "peppermint tea": ["beverages"],
  "hibiscus tea": ["beverages"],
  "oolong tea": ["beverages"],
  "matcha": ["beverages"],
  coffee: ["beverages"],
  "cold brew": ["beverages"]
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

export {
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
