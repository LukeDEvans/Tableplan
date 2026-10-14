// food-restrictions.js — each household member's dietary restrictions and food
// allergies, plus the (deliberately conservative) check of a recipe's ingredients
// against them. Pure and DOM-free (ARCHITECTURE §11); tested in
// test/food-restrictions.test.js.
//
// Stored in the household `eat` section as `state.memberDiets`, keyed by the
// meal-plan member id (state.mealPlanConfig.members):
//   { "<memberId>": { diets: ["vegetarian"], allergies: ["peanuts"],
//                     other: "free text", updatedAt: "<ISO>" } }
// Each entry merges on its own updatedAt, so two people editing two different
// members on two devices keep both. Clearing everything is still an entry (empty
// lists, newer stamp), so a clear can't be undone by an older copy.
//
// Matching is a heads-up, never a block: it reads ingredient names for obvious
// words ("peanut", "shrimp", "flour"). It will miss hidden sources (a sauce that
// contains soy) — the UI says so.

export const DIET_OPTIONS = Object.freeze([
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "pescatarian", label: "Pescatarian" },
  { id: "gluten-free", label: "Gluten-free" },
  { id: "dairy-free", label: "Dairy-free" },
  { id: "no-pork", label: "No pork" },
]);

export const ALLERGEN_OPTIONS = Object.freeze([
  { id: "peanuts", label: "Peanuts" },
  { id: "tree-nuts", label: "Tree nuts" },
  { id: "milk", label: "Milk" },
  { id: "eggs", label: "Eggs" },
  { id: "fish", label: "Fish" },
  { id: "shellfish", label: "Shellfish" },
  { id: "wheat", label: "Wheat" },
  { id: "soy", label: "Soy" },
  { id: "sesame", label: "Sesame" },
]);

const DIET_IDS = new Set(DIET_OPTIONS.map((o) => o.id));
const ALLERGEN_IDS = new Set(ALLERGEN_OPTIONS.map((o) => o.id));
const LABELS = Object.fromEntries([...DIET_OPTIONS, ...ALLERGEN_OPTIONS].map((o) => [o.id, o.label]));

// Words that signal each group. Matched as whole words (plurals allowed) in the
// ingredient's name, after the STRIP / SKIP rules below.
const WORDS = {
  peanuts: ["peanut", "peanut butter", "groundnut"],
  "tree-nuts": ["almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "macadamia", "brazil nut", "pine nut", "praline", "marzipan", "nutella"],
  milk: ["milk", "butter", "buttermilk", "cream", "cheese", "parmesan", "mozzarella", "cheddar", "ricotta", "feta", "yogurt", "yoghurt", "ghee", "whey", "casein", "half-and-half", "half and half", "sour cream", "creme fraiche", "crème fraîche", "mascarpone", "paneer"],
  eggs: ["egg", "egg yolk", "egg white", "mayonnaise", "mayo", "meringue", "aioli"],
  fish: ["fish", "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "anchovy", "anchovies", "sardine", "mackerel", "haddock", "snapper", "bass", "catfish", "fish sauce", "worcestershire"],
  shellfish: ["shrimp", "prawn", "crab", "lobster", "scallop", "clam", "mussel", "oyster", "crawfish", "crayfish", "langoustine"],
  wheat: ["wheat", "flour", "bread", "breadcrumb", "breadcrumbs", "panko", "pasta", "spaghetti", "noodle", "couscous", "bulgur", "farro", "semolina", "tortilla", "pita", "seitan", "cracker", "bun", "baguette", "orzo", "lasagna", "macaroni", "penne", "fettuccine", "linguine", "soy sauce"],
  soy: ["soy", "soy sauce", "soya", "tofu", "tempeh", "edamame", "miso", "tamari"],
  sesame: ["sesame", "tahini", "sesame oil"],
  meat: ["beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "sausage", "prosciutto", "pancetta", "salami", "pepperoni", "chorizo", "steak", "ground beef", "duck", "venison", "bison", "gelatin", "chicken broth", "chicken stock", "beef broth", "beef stock", "lard"],
  pork: ["pork", "bacon", "ham", "prosciutto", "pancetta", "salami", "pepperoni", "chorizo", "lard", "sausage"],
  honey: ["honey"],
  glutenGrains: ["barley", "rye", "malt"],
};

// Per group: phrases that contain a signal word but aren't that food (stripped
// before matching), and markers that clear the whole ingredient for the group.
const STRIP = {
  milk: ["peanut butter", "almond butter", "cashew butter", "nut butter", "sunflower butter", "seed butter", "apple butter", "cocoa butter", "shea butter", "butter lettuce", "butternut", "cream of tartar", "coconut milk", "coconut cream", "almond milk", "oat milk", "soy milk", "rice milk", "cashew milk"],
  eggs: ["eggplant"],
  "tree-nuts": ["nutmeg", "butternut"],
  wheat: ["rice flour", "almond flour", "coconut flour", "oat flour", "chickpea flour", "corn flour", "cornflour", "corn tortilla", "rice noodle", "rice paper", "buckwheat"],
  fish: ["fish-free"],
  meat: ["beyond meat", "impossible burger", "plant-based", "veggie burger", "vegetable broth", "vegetable stock"],
};
const SKIP = {
  milk: ["dairy-free", "dairy free", "vegan", "non-dairy", "plant-based"],
  eggs: ["egg-free", "egg free", "vegan"],
  wheat: ["gluten-free", "gluten free"],
  peanuts: ["peanut-free", "nut-free"],
  "tree-nuts": ["nut-free"],
  meat: ["vegan", "vegetarian", "meatless", "plant-based"],
  pork: ["turkey bacon", "turkey sausage", "chicken sausage", "beef bacon", "vegan", "vegetarian"],
};

// What each restriction rules out, as WORDS groups.
const RULES = {
  peanuts: ["peanuts"], "tree-nuts": ["tree-nuts"], milk: ["milk"], eggs: ["eggs"], fish: ["fish"],
  shellfish: ["shellfish"], wheat: ["wheat"], soy: ["soy"], sesame: ["sesame"],
  vegetarian: ["meat", "fish", "shellfish"],
  vegan: ["meat", "fish", "shellfish", "milk", "eggs", "honey"],
  pescatarian: ["meat"],
  "gluten-free": ["wheat", "glutenGrains"],
  "dairy-free": ["milk"],
  "no-pork": ["pork"],
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const GROUP_RE = Object.fromEntries(Object.entries(WORDS).map(([g, words]) => [
  g, new RegExp(`(^|[^a-z])(${words.map(escapeRe).join("|")})(e?s)?(?![a-z])`, "i"),
]));
const STRIP_RE = Object.fromEntries(Object.entries(STRIP).map(([g, p]) => [g, new RegExp(p.map(escapeRe).join("|"), "gi")]));

function cleanList(list, allowed) {
  return Array.isArray(list) ? [...new Set(list.map(String).filter((id) => allowed.has(id)))] : [];
}

export function normalizeDietEntry(entry) {
  return {
    diets: cleanList(entry?.diets, DIET_IDS),
    allergies: cleanList(entry?.allergies, ALLERGEN_IDS),
    other: String(entry?.other || "").trim().slice(0, 200),
    updatedAt: typeof entry?.updatedAt === "string" ? entry.updatedAt : "",
  };
}

export function normalizeMemberDiets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!id) continue;
    out[String(id)] = normalizeDietEntry(entry);
  }
  return out;
}

export function isEmptyDiet(entry) {
  return !entry || (!entry.diets?.length && !entry.allergies?.length && !entry.other);
}

// Union of both sides; where both have a member, the newer updatedAt wins.
export function mergeMemberDiets(a, b) {
  const x = normalizeMemberDiets(a), y = normalizeMemberDiets(b);
  const out = { ...y };
  for (const [id, entry] of Object.entries(x)) {
    const other = out[id];
    if (!other || String(entry.updatedAt) >= String(other.updatedAt)) out[id] = entry;
  }
  return out;
}

export function optionLabel(id) { return LABELS[id] || id; }

// "Vegetarian, gluten-free" / "Peanuts, shellfish" — for the profile row.
export function describeDiets(entry) { return (entry?.diets || []).map(optionLabel).join(", "); }
export function describeAllergies(entry) { return (entry?.allergies || []).map(optionLabel).join(", "); }

// Which restriction groups an ingredient name trips.
export function ingredientGroups(text) {
  const base = String(text || "").toLowerCase();
  return Object.keys(GROUP_RE).filter((g) => {
    if ((SKIP[g] || []).some((w) => base.includes(w))) return false;
    const t = ` ${STRIP_RE[g] ? base.replace(STRIP_RE[g], " ") : base} `;
    return GROUP_RE[g].test(t);
  });
}

// Everyone in the household whose restrictions a recipe may conflict with.
// ingredients: strings (names). members: [{ id, label }].
// → [{ memberId, label, kind: "allergy"|"diet", id, name, ingredients: [..] }]
export function findIngredientConflicts(ingredients, memberDiets, members) {
  const diets = normalizeMemberDiets(memberDiets);
  const names = (ingredients || []).map((i) => String(i || "").trim()).filter(Boolean);
  const groupsByIngredient = names.map((n) => ({ n, g: new Set(ingredientGroups(n)) }));
  const out = [];
  for (const m of members || []) {
    const entry = diets[m.id];
    if (!entry) continue;
    const checks = [...entry.allergies.map((id) => ["allergy", id]), ...entry.diets.map((id) => ["diet", id])];
    for (const [kind, id] of checks) {
      const groups = RULES[id] || [];
      const hits = groupsByIngredient.filter(({ g }) => groups.some((x) => g.has(x))).map(({ n }) => n);
      if (hits.length) out.push({ memberId: m.id, label: m.label, kind, id, name: optionLabel(id), ingredients: [...new Set(hits)] });
    }
  }
  return out;
}

// One line per member with anything set — for the assistant's context.
export function foodRestrictionsContext(memberDiets, members) {
  const diets = normalizeMemberDiets(memberDiets);
  const lines = [];
  for (const m of members || []) {
    const e = diets[m.id];
    if (isEmptyDiet(e)) continue;
    const parts = [];
    if (e.allergies.length) parts.push(`allergic to ${describeAllergies(e).toLowerCase()}`);
    if (e.diets.length) parts.push(describeDiets(e).toLowerCase());
    if (e.other) parts.push(`notes: ${e.other}`);
    lines.push(`${m.label}: ${parts.join("; ")}`);
  }
  return lines.length ? `FOOD RESTRICTIONS (respect these when suggesting meals or recipes): ${lines.join(" | ")}` : "";
}
