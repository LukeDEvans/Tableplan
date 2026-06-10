(function foodHealthChecklistFactory(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.LiveFoodHealthChecklists = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createFoodHealthChecklists() {
"use strict";

const placeholderTemplates = [
  {
    id: "twenty-one-tweaks",
    name: "21 Tweaks for Weight Loss",
    description: "Evidence-based daily habits from Dr. Greger's How Not to Diet, layered on top of the Daily Dozen.",
    sourceName: "NutritionFacts.org",
    isBuiltIn: true,
    items: [
      { id: "tweak-water-preload", name: "Water preload", description: "Drink 2 cups of water 30 minutes before each meal.", targetFrequency: 3, sortOrder: 10, categoryType: "behavior" },
      { id: "tweak-greens-preload", name: "Greens preload", description: "Start meals with a large salad or a bowl of low-calorie broth-based soup.", targetFrequency: 1, sortOrder: 20, categoryType: "food" },
      { id: "tweak-vinegar", name: "Vinegar", description: "1–2 tsp of vinegar (e.g. cider or rice vinegar) before or with a meal.", targetFrequency: 1, sortOrder: 30, categoryType: "food" },
      { id: "tweak-intact-grains", name: "Intact whole grains", description: "Choose intact grains (oat groats, wheat berries, farro) over flour-based products.", targetFrequency: 1, sortOrder: 40, categoryType: "food" },
      { id: "tweak-black-cumin", name: "Black cumin seed", description: "¼ tsp Nigella sativa (black cumin) seeds daily — evidence for modest weight reduction.", targetFrequency: 1, sortOrder: 50, categoryType: "supplement" },
      { id: "tweak-nutritional-yeast", name: "Nutritional yeast", description: "2 Tbsp nutritional yeast — source of chromium and niacin supporting metabolism.", targetFrequency: 1, sortOrder: 60, categoryType: "food" },
      { id: "tweak-front-load", name: "Front-load calories", description: "Make breakfast the largest meal; keep dinner the smallest.", targetFrequency: 1, sortOrder: 70, categoryType: "behavior" },
      { id: "tweak-time-restricted", name: "12-hour eating window", description: "Limit all eating to a 12-hour window each day.", targetFrequency: 1, sortOrder: 80, categoryType: "behavior" },
      { id: "tweak-no-night-eating", name: "No late-night eating", description: "Stop eating at least 2 hours before bedtime.", targetFrequency: 1, sortOrder: 90, categoryType: "behavior" },
      { id: "tweak-mindful-eating", name: "Mindful eating", description: "Eat without screens; sit down; chew thoroughly; focus on flavours.", targetFrequency: 1, sortOrder: 100, categoryType: "behavior" },
      { id: "tweak-twenty-minute", name: "20-minute pause", description: "Wait 20 minutes before going back for seconds — satiety signals take time to arrive.", targetFrequency: 1, sortOrder: 110, categoryType: "behavior" },
      { id: "tweak-post-meal-walk", name: "Post-meal walk", description: "Take a 10–15 minute walk after eating to blunt the glycaemic response.", targetFrequency: 1, sortOrder: 120, categoryType: "exercise" },
      { id: "tweak-sleep", name: "7–9 hours sleep", description: "Inadequate sleep elevates hunger hormones; consistent rest supports a healthy weight.", targetFrequency: 1, sortOrder: 130, categoryType: "behavior" },
      { id: "tweak-no-liquid-calories", name: "No liquid calories", description: "Drink water, unsweetened tea, or black coffee; avoid juice, soda, and alcohol.", targetFrequency: 1, sortOrder: 140, categoryType: "behavior" },
      { id: "tweak-daily-weigh", name: "Daily weigh-in", description: "Weigh yourself each morning at the same time — track the trend, not daily fluctuations.", targetFrequency: 1, sortOrder: 150, categoryType: "behavior" }
    ]
  },
  {
    id: "maximally-ldl-lowering",
    name: "Maximally LDL-Lowering",
    description: "Evidence-based foods and habits from the portfolio diet and NutritionFacts.org research on LDL reduction.",
    sourceName: "NutritionFacts.org",
    isBuiltIn: true,
    items: [
      { id: "ldl-oat-betaglucan", name: "Oats or oat bran", description: "At least ½ cup cooked oats or oat bran — beta-glucan fibre is the most studied LDL-lowering food component.", targetFrequency: 1, sortOrder: 10, categoryType: "food" },
      { id: "ldl-barley", name: "Barley", description: "½ cup cooked barley — rich in beta-glucan, comparable to oats for LDL reduction.", targetFrequency: 1, sortOrder: 20, categoryType: "food" },
      { id: "ldl-psyllium", name: "Psyllium husk", description: "1 tsp psyllium mixed into food or water — soluble fibre with consistent LDL-lowering evidence.", targetFrequency: 1, sortOrder: 30, categoryType: "supplement" },
      { id: "ldl-legumes", name: "3 servings legumes", description: "3 servings of beans, lentils, or other legumes — the portfolio diet cornerstone.", targetFrequency: 3, sortOrder: 40, categoryType: "food" },
      { id: "ldl-almonds", name: "Almonds", description: "1 oz (~23 almonds) daily — the nut with the strongest portfolio diet LDL-lowering evidence.", targetFrequency: 1, sortOrder: 50, categoryType: "food" },
      { id: "ldl-walnuts", name: "Walnuts", description: "1 oz walnuts daily — rich in omega-3 ALA, associated with reduced LDL and inflammation.", targetFrequency: 1, sortOrder: 60, categoryType: "food" },
      { id: "ldl-soy", name: "Soy protein", description: "25g soy protein daily via tofu, tempeh, edamame, or unsweetened soy milk.", targetFrequency: 1, sortOrder: 70, categoryType: "food" },
      { id: "ldl-flaxseed", name: "Ground flaxseed (extra)", description: "2 Tbsp freshly ground flaxseed daily — beyond the Daily Dozen minimum.", targetFrequency: 1, sortOrder: 80, categoryType: "food" },
      { id: "ldl-amla", name: "Amla powder", description: "¼–½ tsp Indian gooseberry (amla) powder daily — outperformed a statin in one direct comparison.", targetFrequency: 1, sortOrder: 90, categoryType: "supplement" },
      { id: "ldl-green-tea", name: "Green tea", description: "3–5 cups green tea daily — catechins associated with modest but consistent LDL reduction.", targetFrequency: 3, sortOrder: 100, categoryType: "beverage" },
      { id: "ldl-avocado", name: "Avocado", description: "½ avocado daily as a replacement for saturated fat sources.", targetFrequency: 1, sortOrder: 110, categoryType: "food" },
      { id: "ldl-no-sat-fat", name: "Eliminate saturated fat", description: "Avoid meat, full-fat dairy, coconut oil, and palm oil — the primary dietary drivers of LDL.", targetFrequency: 1, sortOrder: 120, categoryType: "behavior" },
      { id: "ldl-soluble-fiber", name: "Soluble fibre foods", description: "Include okra, eggplant, apples, pears, or citrus — viscous fibres bind cholesterol in the gut.", targetFrequency: 1, sortOrder: 130, categoryType: "food" }
    ]
  }
];

return { placeholderTemplates };
}));
