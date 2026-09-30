"use strict";

const prepPhrases = [
  "plus more", "for serving", "for garnish", "as needed", "to serve",
  "chopped", "diced", "minced", "sliced", "divided", "optional",
  "peeled", "crushed", "rinsed", "drained", "grated", "shredded",
  "zested", "juiced", "melted", "softened", "trimmed", "seeded"
];

const shoppingNotes = ["extra virgin"];

const synonymEntries = {
  chickpea: "garbanzo beans",
  "garbanzo bean": "garbanzo beans",
  scallion: "green onions",
  "green onion": "green onions",
  "spring onion": "green onions",
  "coriander leaf": "cilantro",
  "coriander leaves": "cilantro",
  "confectioner sugar": "powdered sugar",
  "confectioners sugar": "powdered sugar",
  "icing sugar": "powdered sugar",
  "caster sugar": "superfine sugar",
  "castor sugar": "superfine sugar",
  "aubergine": "eggplant",
  "courgette": "zucchini",
  "rocket": "arugula",
  "capsicum": "bell pepper",
  "all purpose flour": "all-purpose flour",
  "plain flour": "all-purpose flour",
  "bicarbonate of soda": "baking soda",
  "rapeseed oil": "canola oil"
};

const irregularSingulars = {
  apples: "apple", onions: "onion", carrots: "carrot", lemons: "lemon",
  limes: "lime", oranges: "orange", bananas: "banana", avocados: "avocado",
  tomatoes: "tomato", potatoes: "potato", berries: "berry", blueberries: "blueberry",
  strawberries: "strawberry", raspberries: "raspberry", blackberries: "blackberry",
  cherries: "cherry", peaches: "peach", radishes: "radish", sandwiches: "sandwich",
  loaves: "loaf", leaves: "leaf", knives: "knife", halves: "half",
  chickpeas: "chickpea", scallions: "scallion", tortillas: "tortilla",
  eggs: "egg", mushrooms: "mushroom", cucumbers: "cucumber", peppers: "pepper",
  beans: "bean", lentils: "lentil", oats: "oat", noodles: "noodle",
  crackers: "cracker", chips: "chip", walnuts: "walnut", almonds: "almond",
  pecans: "pecan", cashews: "cashew", peanuts: "peanut"
};

const singularExceptions = new Set([
  "asparagus", "bass", "bitters", "couscous", "glass", "greens", "grits", "hummus", "molasses",
  "mussels", "oats", "Swiss", "swiss", "watercress"
]);

// Prep/shopping-note phrases compiled once (normalizeBaseName runs per row per render).
// `test` is non-global so it carries no lastIndex state between calls.
const notePhrasePatterns = [...prepPhrases, ...shoppingNotes].map((phrase) => {
  const source = `\\b${phrase.replace(/\s+/g, "\\s+")}\\b`;
  return { phrase, test: new RegExp(source), replace: new RegExp(source, "g") };
});

const catalogGroups = {
  Produce: {
    Vegetables: [
      "artichoke", "asparagus", "beet", "bell pepper", "bok choy", "broccoli", "Brussels sprouts",
      "cabbage", "carrot", "cauliflower", "celery", "corn", "cucumber", "eggplant", "fennel",
      "green beans", "jalapeno", "kale", "lettuce", "mushroom", "okra", "parsnip", "peas",
      "potato", "pumpkin", "radish", "romaine lettuce", "snap peas", "spinach", "sweet potato",
      "tomatillo", "tomato", "turnip", "zucchini"
    ],
    "Onions & Aromatics": [
      "garlic", "ginger", "green onions", "leek", "onion", "red onion", "shallot", "yellow onion"
    ],
    Fruits: [
      "apple", "apricot", "avocado", "banana", "blackberry", "blueberry", "cherry", "clementine",
      "coconut", "cranberry", "date", "fig", "grape", "grapefruit", "kiwi", "lemon", "lime",
      "mango", "nectarine", "orange", "papaya", "peach", "pear", "pineapple", "plum",
      "pomegranate", "raspberry", "strawberry", "watermelon"
    ],
    Herbs: [
      "basil", "chives", "cilantro", "dill", "mint", "oregano", "parsley", "rosemary", "sage",
      "tarragon", "thyme"
    ]
  },
  Dairy: {
    Butter: ["butter", "salted butter", "unsalted butter", "ghee"],
    Milk: ["milk", "whole milk", "2% milk", "skim milk", "buttermilk", "evaporated milk", "condensed milk"],
    Cheese: [
      "American cheese", "blue cheese", "cheddar cheese", "cottage cheese", "cream cheese", "feta",
      "goat cheese", "gruyere", "Monterey jack", "mozzarella", "parmesan", "pepper jack",
      "provolone", "ricotta", "Swiss cheese"
    ],
    "Yogurt & Cream": [
      "Greek yogurt", "yogurt", "sour cream", "heavy cream", "half-and-half", "whipped cream", "creme fraiche"
    ],
    Eggs: ["egg", "egg whites"]
  },
  Meat: {
    Chicken: ["chicken", "chicken breast", "chicken thighs", "ground chicken", "rotisserie chicken"],
    Beef: ["beef", "beef chuck", "beef roast", "flank steak", "ground beef", "sirloin", "steak"],
    Pork: ["bacon", "ham", "pork", "pork chops", "pork shoulder", "prosciutto", "sausage"],
    Turkey: ["turkey", "ground turkey", "turkey breast", "turkey sausage"],
    Other: ["lamb", "lamb chops", "ground lamb", "veal"]
  },
  Seafood: {
    Fish: ["cod", "halibut", "salmon", "sardines", "tilapia", "trout", "tuna"],
    Shellfish: ["clams", "crab", "lobster", "mussels", "scallops", "shrimp"]
  },
  Pantry: {
    Beans: [
      "garbanzo beans", "black beans", "cannellini beans", "kidney beans", "navy beans",
      "pinto beans", "refried beans", "white beans"
    ],
    "Grains & Rice": [
      "arborio rice", "barley", "brown rice", "bulgur", "couscous", "farro", "jasmine rice",
      "millet", "quinoa", "rice", "wild rice"
    ],
    "Pasta & Noodles": [
      "angel hair pasta", "egg noodles", "elbow macaroni", "fettuccine", "lasagna noodles",
      "linguine", "orzo", "pasta", "penne", "ramen noodles", "rice noodles", "spaghetti"
    ],
    Baking: [
      "all-purpose flour", "almond flour", "baking powder", "baking soda", "bread flour",
      "brown sugar", "cake flour", "chocolate chips", "cocoa powder", "cornstarch", "flour",
      "powdered sugar", "self-rising flour", "superfine sugar", "sugar", "vanilla extract", "yeast"
    ],
    Oils: [
      "avocado oil", "canola oil", "coconut oil", "olive oil", "peanut oil", "sesame oil",
      "vegetable oil"
    ],
    Vinegars: [
      "apple cider vinegar", "balsamic vinegar", "red wine vinegar", "rice vinegar",
      "sherry vinegar", "white vinegar", "white wine vinegar"
    ],
    "Sauces & Condiments": [
      "barbecue sauce", "buffalo sauce", "fish sauce", "hoisin sauce", "hot sauce", "ketchup",
      "mayonnaise", "mustard", "pesto", "salsa", "soy sauce", "sriracha", "tahini",
      "teriyaki sauce", "tomato paste", "tomato sauce", "Worcestershire sauce"
    ],
    "Broth & Canned": [
      "beef broth", "chicken broth", "coconut milk", "diced tomatoes", "pumpkin puree",
      "vegetable broth"
    ],
    "Nuts & Seeds": [
      "almond", "cashew", "chia seeds", "flaxseed", "peanut", "pecan", "pine nuts",
      "pistachio", "pumpkin seeds", "sesame seeds", "sunflower seeds", "walnut"
    ],
    Spices: [
      "allspice", "bay leaves", "black pepper", "cajun seasoning", "cayenne", "chili powder",
      "cinnamon", "cloves", "coriander", "cumin", "curry powder", "garlic powder", "kosher salt",
      "nutmeg", "onion powder", "paprika", "red pepper flakes", "salt", "sea salt",
      "smoked paprika", "turmeric"
    ],
    "Nut Butters & Spreads": [
      "almond butter", "jam", "jelly", "maple syrup", "peanut butter", "sunflower butter"
    ]
  },
  Bakery: {
    Bread: ["bagel", "baguette", "bread", "brioche", "ciabatta", "English muffin", "pita", "sourdough"],
    "Wraps & Rolls": ["burger buns", "dinner rolls", "hot dog buns", "tortilla", "wraps"],
    Desserts: ["brownies", "cake", "cookies", "pie"]
  },
  Frozen: {
    Produce: ["frozen berries", "frozen broccoli", "frozen corn", "frozen peas", "frozen spinach"],
    Meals: ["frozen pizza", "frozen waffles", "ice cream"]
  },
  Deli: {
    Prepared: ["hummus", "guacamole", "prepared salad", "rotisserie chicken"],
    Meats: ["deli ham", "deli turkey", "pepperoni", "salami"]
  },
  Beverages: {
    Coffee: ["coffee", "coffee beans", "ground coffee"],
    Tea: ["black tea", "green tea", "herbal tea", "tea"],
    Other: ["apple juice", "orange juice", "sparkling water", "water"]
  },
  Household: {
    Paper: ["aluminum foil", "paper towels", "parchment paper", "toilet paper", "trash bags"],
    Cleaning: ["dish soap", "dishwasher detergent", "laundry detergent", "sponges", "surface cleaner"]
  }
};

function singularizeWord(word) {
  const lower = String(word || "").toLowerCase();
  if (!lower || singularExceptions.has(lower)) return lower;
  if (irregularSingulars[lower]) return irregularSingulars[lower];
  if (/(ss|us|is)$/.test(lower)) return lower;
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("oes") && lower.length > 4) return lower.slice(0, -2);
  if (/(ches|shes|xes|zes)$/.test(lower)) return lower.slice(0, -2);
  if (lower.endsWith("s") && lower.length > 3) return lower.slice(0, -1);
  return lower;
}

function reorderCommaName(value) {
  const parts = String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? `${parts.slice(1).join(" ")} ${parts[0]}` : parts[0] || "";
}

function titleCase(value) {
  return String(value || "").replace(/\b\w/g, (character) => character.toUpperCase());
}

function catalogEntries() {
  const entries = [];
  Object.entries(catalogGroups).forEach(([category, subcategories]) => {
    Object.entries(subcategories).forEach(([subcategory, names]) => {
      names.forEach((name) => entries.push({ name, category, subcategory }));
    });
  });
  return entries;
}

const catalogByCanonical = new Map();
catalogEntries().forEach((entry) => {
  const canonicalName = normalizeBaseName(entry.name).canonicalName;
  if (!catalogByCanonical.has(canonicalName)) catalogByCanonical.set(canonicalName, { ...entry, canonicalName });
});

function normalizeBaseName(rawName) {
  let value = reorderCommaName(rawName)
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[&/]/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[-–—]+/g, " ")
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const notes = [];
  notePhrasePatterns.forEach(({ phrase, test, replace }) => {
    if (test.test(value)) notes.push(phrase);
    value = value.replace(replace, " ");
  });
  value = value.replace(/\s+/g, " ").trim();
  const words = value.split(" ").filter(Boolean);
  if (words.length) words[words.length - 1] = singularizeWord(words[words.length - 1]);
  const normalizedName = words.join(" ");
  const canonicalName = synonymEntries[normalizedName] || normalizedName;
return { normalizedName, canonicalName, notes: [...new Set(notes)] };
}

// Reverse alias lookup (alias canonical name -> alias group key), memoized per
// aliases object. The aliases object can be mutated in place, so the cached map is
// also keyed on a cheap content signature; first-listed group wins, as before.
const reverseAliasCache = new WeakMap();
function reverseAliasMap(aliases) {
  if (!aliases || typeof aliases !== "object") return new Map();
  const signature = JSON.stringify(aliases);
  const cached = reverseAliasCache.get(aliases);
  if (cached && cached.signature === signature) return cached.map;
  const map = new Map();
  Object.entries(aliases).forEach(([key, values]) => {
    if (!Array.isArray(values)) return;
    values.forEach((alias) => {
      const canonical = normalizeBaseName(alias).canonicalName;
      if (!map.has(canonical)) map.set(canonical, key);
    });
  });
  reverseAliasCache.set(aliases, { signature, map });
  return map;
}

function normalizeGroceryItemName(rawName, options = {}) {
  const raw = String(rawName || "").trim();
  const base = normalizeBaseName(raw);
  const splitPreferences = options.splitPreferences || {};
  const aliases = options.aliases || {};
  const splitKey = base.normalizedName;
  let canonicalName = splitPreferences[splitKey] || base.canonicalName;
  if (!splitPreferences[splitKey]) {
    if (aliases[canonicalName]) {
      canonicalName = canonicalName;
    } else {
      const aliasKey = reverseAliasMap(aliases).get(canonicalName);
      if (aliasKey !== undefined) canonicalName = aliasKey;
    }
  }
  if (!splitPreferences[splitKey]) canonicalName = synonymEntries[canonicalName] || canonicalName;
  const catalog = catalogByCanonical.get(canonicalName);
return {
    rawName: raw,
    normalizedName: base.normalizedName,
    canonicalName,
    displayName: catalog?.name ? titleCase(catalog.name) : titleCase(canonicalName),
    notes: base.notes,
    category: catalog?.category || "Other",
    subcategory: catalog?.subcategory || "Other"
  };
}

function quantityNumber(value) {
  const text = String(value || "").trim();
  if (!text || text === "pinch") return null;
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function formatQuantity(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  const whole = Math.floor(value);
  const remainder = value - whole;
  const fractions = [
    ["1/8", 1 / 8], ["1/4", 1 / 4], ["1/3", 1 / 3], ["1/2", 1 / 2],
    ["2/3", 2 / 3], ["3/4", 3 / 4]
  ];
  const fraction = fractions.find(([, number]) => Math.abs(number - remainder) < 0.01)?.[0] || "";
  if (!fraction) return Math.abs(value - Math.round(value)) < 0.01
    ? String(Math.round(value))
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return [whole || "", fraction].filter(Boolean).join(" ");
}

// Unit spellings that mean the same thing, so "1 cup + 2 cups + 1 Cup" sums.
const unitAliases = {
  tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", tsps: "tsp",
  cup: "cup", cups: "cup", c: "cup",
  ounce: "oz", ounces: "oz", oz: "oz",
  pound: "lb", pounds: "lb", lb: "lb", lbs: "lb",
  gram: "g", grams: "g", g: "g", kilogram: "kg", kilograms: "kg", kg: "kg",
  milliliter: "ml", milliliters: "ml", ml: "ml", liter: "l", liters: "l", l: "l",
  pint: "pt", pints: "pt", pt: "pt", quart: "qt", quarts: "qt", qt: "qt",
  gallon: "gal", gallons: "gal", gal: "gal"
};

function groceryUnitKey(unit) {
  const raw = String(unit || "").trim().replace(/\.$/, "");
  if (raw === "T") return "tbsp";
  if (raw === "t") return "tsp";
  const lower = raw.toLowerCase().replace(/\s+/g, " ");
  if (!lower) return "";
  if (unitAliases[lower]) return unitAliases[lower];
  const words = lower.split(" ");
  words[words.length - 1] = singularizeWord(words[words.length - 1]);
  return words.join(" ");
}

function mergeGroceryRows(rows, options = {}) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const rawName = row.rawName || row.rawNames?.[0] || row.item || row.displayName || "";
    if (!rawName) return;
    const identity = normalizeGroceryItemName(rawName, options);
    const canonicalName = row.canonicalName || identity.canonicalName;
    if (!groups.has(canonicalName)) {
      groups.set(canonicalName, {
        canonicalName,
        displayName: row.displayName || identity.displayName,
        rawNames: new Set(),
        notes: new Set(),
        category: row.category || identity.category,
        subcategory: row.subcategory || identity.subcategory,
        sourceRecipeIds: new Set(),
        sourceRecipeNames: new Set(),
        quantities: new Map(),
        looseQuantities: [],
        manualValues: []
      });
    }
    const group = groups.get(canonicalName);
    (row.rawNames || [rawName]).filter(Boolean).forEach((name) => group.rawNames.add(name));
    [...identity.notes, ...(row.notes || []), row.prep].filter(Boolean).forEach((note) => group.notes.add(note));
    (row.sourceRecipeIds || [row.sourceRecipeId]).filter(Boolean).forEach((id) => group.sourceRecipeIds.add(id));
    [row.sourceRecipeName].filter(Boolean).forEach((name) => group.sourceRecipeNames.add(name));
    if (row.manualValue) group.manualValues.push(row.manualValue);
    const amount = quantityNumber(row.amount);
    const unit = String(row.unit || "").trim();
    if (amount !== null) {
      // Sum by normalized unit; display the first spelling seen for that unit.
      const unitKey = groceryUnitKey(unit);
      const existing = group.quantities.get(unitKey);
      group.quantities.set(unitKey, { label: existing ? existing.label : unit, amount: (existing?.amount || 0) + amount });
    }
    else if (row.quantity) group.looseQuantities.push(row.quantity);
  });
  return [...groups.values()].map((group) => {
    const quantities = [...group.quantities.values()]
      .map(({ label, amount }) => [formatQuantity(amount), label].filter(Boolean).join(" "))
      .filter(Boolean);
    const loose = [...new Set(group.looseQuantities.filter(Boolean))];
    const manualValues = [...new Set(group.manualValues)];
return {
      key: group.canonicalName,
      item: group.displayName,
      displayName: group.displayName,
      canonicalName: group.canonicalName,
      rawNames: [...group.rawNames],
      quantity: [...quantities, ...loose].join(" + "),
      notes: [...group.notes],
      category: group.category,
      subcategory: group.subcategory,
      sourceRecipeIds: [...group.sourceRecipeIds],
      sourceRecipeId: [...group.sourceRecipeIds][0] || "",
      sourceRecipeName: [...group.sourceRecipeNames][0] || "",
      manual: manualValues.length === 1 && group.rawNames.size === 1,
      manualValue: manualValues.length === 1 ? manualValues[0] : "",
      prep: ""
    };
  });
}

export {
  prepPhrases,
  synonymEntries as synonyms,
  catalogGroups,
  catalogEntries,
  singularizeWord,
  reorderCommaName,
  normalizeGroceryItemName,
  quantityNumber,
  formatQuantity,
  groceryUnitKey,
  mergeGroceryRows
};
