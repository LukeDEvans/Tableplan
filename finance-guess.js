// finance-guess.js — first guesses for categorizing (FINANCE_JOURNEY_AUDIT.md §5,
// decisions by Luke 2026-11-23). Pure: no state, no DOM.
//
// The rules, in Luke's words:
//   • Categorize item by item. A charge with a receipt is categorized per line;
//     "All one category" can mark the whole receipt instead.
//   • Changing one charge never changes another. A choice only shapes future
//     guesses; anything already approved stays as it is.
//   • A store you've used more than one category for (Trader Joe's: food and
//     booze) is "mixed": its charges are never filed on their own, only guessed.
//
// Memory lives in state.financeTxnRules (merchant key → { label: count }), which
// already syncs and merges per key. Item names and AI answers share that map
// under prefixes so no new synced key is needed:
//   "<merchant key>"   counts from hand-approved charges (as before)
//   "item:<item key>"  counts from hand-approved receipt lines
//   "ai:<merchant key>" { label: 1 } — the AI's guess for a merchant never seen

export const ITEM_PREFIX = "item:";
export const AI_PREFIX = "ai:";

export const isMemoryKey = (k) => typeof k === "string" && !k.startsWith(ITEM_PREFIX) && !k.startsWith(AI_PREFIX);

// What a set of counts says. mixed: more than one label was ever approved.
export function labelProfile(counts) {
  if (!counts || typeof counts !== "object") return null;
  let best = null, n = 0, total = 0, labels = 0;
  for (const [k, c] of Object.entries(counts)) {
    const v = Number(c) || 0;
    if (v <= 0) continue;
    labels++;
    total += v;
    if (v > n) { n = v; best = k; }
  }
  if (!best) return null;
  return { best, n, total, labels, mixed: labels > 1 };
}

// For a charge with no receipt, from the merchant's own history:
//   auto   file it without asking (consistent store, approved 2+ times, never anything else)
//   guess  a suggestion that waits for a tap (one approval so far, or a mixed store)
export function merchantDecision(counts) {
  const p = labelProfile(counts);
  if (!p) return { auto: null, guess: null, mixed: false };
  if (p.mixed) return { auto: null, guess: p.best, mixed: true };
  if (p.n >= 2) return { auto: p.best, guess: p.best, mixed: false };
  return { auto: null, guess: p.best, mixed: false };
}

// ── Item names ──────────────────────────────────────────────────────────────
const ITEM_NOISE = new Set(["oz", "fl", "lb", "lbs", "ct", "pk", "pack", "ea", "each", "the", "and", "of", "with", "g", "kg", "ml", "l", "qt", "gal"]);
// "TJ's Unexpected Cheddar 7 OZ" → "tj s unexpected cheddar". Sizes, prices and
// codes drop out so the same product matches across receipts and stores.
export function itemKey(name) {
  const words = String(name || "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/)
    .filter((w) => w.length >= 2 && !ITEM_NOISE.has(w));
  return words.slice(0, 4).join(" ");
}

// ── Built-in lists (suggestions only, never filed on their own) ─────────────
// Each maps text to a kind of category; the kind is found among the user's own
// categories by name, so nothing here is tied to one budget's ids.
const KIND_NAMES = {
  groceries: [/grocer/i, /^food$/i, /\bfood\b(?!.*out)/i],
  alcohol: [/booze/i, /alcohol/i, /liquor/i, /\bwine\b/i, /\bbeer\b/i],
  dining: [/eating out/i, /eat out/i, /dining/i, /restaurant/i, /takeout/i],
  gas: [/\bgas\b/i, /fuel/i, /transport/i, /\bcar\b/i, /auto/i],
  utilities: [/utilit/i],
  subscriptions: [/subscri/i, /stream/i, /entertain/i],
  housing: [/housing/i, /mortgage/i, /\brent\b/i],
};

const MERCHANT_KINDS = [
  [/\b(aldi|costco|trader joe|cub foods|lunds|byerly|whole foods|hy ?vee|kowalski|seward|wedge|co ?op|kroger|safeway|grocery)\b/i, "groceries"],
  [/\b(holiday ?station\w*|speedway|kwik ?trip|shell|bp|exxon|marathon|casey|sinclair|cenex|mobil|chevron)\b/i, "gas"],
  [/\b(netflix|spotify|hulu|disney|youtube|hbo|peacock|paramount|audible|apple ?com ?bill)\b/i, "subscriptions"],
  [/\b(xcel|centerpoint|comcast|xfinity|verizon|t ?mobile|at ?t|water|sewer)\b/i, "utilities"],
  [/\b(liquors?|wine|spirits|brew|brewing|brewery|brewpub|taproom)\b/i, "alcohol"],
  [/\b(starbucks|caribou|dunn bros|spyhouse|coffee|cafe|pizza|grill|kitchen|restaurant|taco|burger|sushi|doordash|grubhub|uber ?eats|chipotle|tst|sq)\b/i, "dining"],
  [/\b(mortgage|rent)\b/i, "housing"],
];

const ITEM_KINDS = [
  [/\b(wine|beer|ipa|lager|ale|stout|porter|pilsner|vodka|whiskey|whisky|bourbon|tequila|rum|gin|cider|hard seltzer|cabernet|cab sauv|pinot|chardonnay|merlot|sauvignon|riesling|prosecco|champagne|cava|malbec|zinfandel|moscato|sake|mezcal|brandy|liqueur|vermouth|sangria|rose wine)\b/i, "alcohol"],
];

// [{ key, name }] → the first category whose name fits the kind.
export function categoryForKind(kind, categories) {
  const tests = KIND_NAMES[kind];
  if (!tests) return null;
  const list = Array.isArray(categories) ? categories : [];
  for (const re of tests) {
    const hit = list.find((c) => re.test(String(c.name || "").split("·").pop().trim()));
    if (hit) return hit.key;
  }
  return null;
}

function kindFrom(text, table) {
  const s = String(text || "").replace(/[*#&]/g, " ");
  for (const [re, kind] of table) if (re.test(s)) return kind;
  return null;
}

// ── Guesses ─────────────────────────────────────────────────────────────────
// Each returns { label, source, mixed } or null. source:
//   "yours"   your own past choices    "common"  the built-in list
//   "ai"      the AI's guess           "receipt" the receipt reader's guess
const validIn = (categories) => {
  const keys = new Set((categories || []).map((c) => c.key));
  return (label) => Boolean(label) && (keys.has(label) || label === "income" || label === "mgmt" || !label.startsWith("cat:"));
};

// A charge with no receipt. merchantKey is financeMerchantKey(description).
export function guessForMerchant({ description, merchantKey, rules, categories }) {
  const ok = validIn(categories);
  const mine = merchantDecision(merchantKey ? rules?.[merchantKey] : null);
  if (mine.guess && ok(mine.guess)) return { label: mine.guess, source: "yours", mixed: mine.mixed };
  const ai = labelProfile(merchantKey ? rules?.[AI_PREFIX + merchantKey] : null);
  if (ai?.best && ok(ai.best)) return { label: ai.best, source: "ai", mixed: false };
  const kind = kindFrom(description, MERCHANT_KINDS);
  const common = kind && categoryForKind(kind, categories);
  if (common) return { label: common, source: "common", mixed: false };
  return null;
}

// One receipt line. readCategory is what the receipt reader assigned.
export function guessForLine({ name, readCategory, rules, categories }) {
  const ok = validIn(categories);
  const key = itemKey(name);
  const mine = labelProfile(key ? rules?.[ITEM_PREFIX + key] : null);
  if (mine?.best && ok(mine.best)) return { label: mine.best, source: "yours", mixed: mine.mixed };
  // The built-in list beats the reader only for drinks, the case it most often
  // gets wrong at a grocery store.
  const kind = kindFrom(name, ITEM_KINDS);
  const common = kind && categoryForKind(kind, categories);
  if (common) return { label: common, source: "common", mixed: false };
  if (readCategory && ok(readCategory)) return { label: readCategory, source: "receipt", mixed: false };
  return null;
}

// Add one approval to a counts map (returns a new object).
export function addCount(counts, label) {
  const out = { ...(counts && typeof counts === "object" ? counts : {}) };
  out[label] = (Number(out[label]) || 0) + 1;
  return out;
}

// Lines [{ price, label }] → a split for a charge of `charge` (positive dollars).
// Tax, fees and discounts are spread over the categories in proportion, so the
// portions always add up to the charge. Null when any priced line has no label.
// One category → [{ label, amount: charge }].
export function splitFromLines(lines, charge) {
  const total = Math.round((Number(charge) || 0) * 100) / 100;
  if (!(total > 0)) return null;
  const byLabel = new Map();
  let sum = 0;
  for (const l of lines || []) {
    const price = Number(l?.price) || 0;
    if (!(price > 0)) continue; // discounts are absorbed by scaling to the charge
    if (!l.label) return null;
    byLabel.set(l.label, (byLabel.get(l.label) || 0) + price);
    sum += price;
  }
  if (!byLabel.size || !(sum > 0)) return null;
  const scale = total / sum;
  const portions = [...byLabel.entries()].map(([label, amount]) => ({ label, amount: Math.round(amount * scale * 100) / 100 }));
  const drift = Math.round((total - portions.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
  if (drift) {
    const biggest = portions.reduce((a, b) => (b.amount > a.amount ? b : a));
    biggest.amount = Math.round((biggest.amount + drift) * 100) / 100;
  }
  return portions;
}

// ── Readable store names ────────────────────────────────────────────────────
// "TARGET T-2177 MPLS" → "Target", "SQ *DANGEROUS MAN BREW" → "Dangerous Man Brew",
// "TRADER JOE S #710" → "Trader Joe's". Only for display when you haven't renamed
// the store yourself; matching still uses the bank's own text.
const NAME_FIXES = [
  [/^amzn( mktp| digital)?\b.*|^amazon( com| mktp| prime)?\b.*/i, "Amazon"],
  [/^costco( whse| wholesale)?\b.*/i, "Costco"],
  [/^holiday ?station\w*\b.*/i, "Holiday"],
  [/^trader joe ?s\b.*/i, "Trader Joe's"],
  [/^wal-?mart\b.*|^wm supercenter\b.*/i, "Walmart"],
  [/^target\b.*/i, "Target"],
  [/^cub foods\b.*/i, "Cub Foods"],
  [/^aldi\b.*/i, "Aldi"],
  [/^kwik ?trip\b.*/i, "Kwik Trip"],
  [/^apple ?com ?bill\b.*/i, "Apple"],
  [/^netflix\b.*/i, "Netflix"],
  [/^spotify\b.*/i, "Spotify"],
  [/^xcel energy\b.*/i, "Xcel Energy"],
  [/^uber\s*\*?\s*eats\b.*/i, "Uber Eats"],
  [/^uber\b.*\btrip\b.*|^uber\s*\*\s*trip\b.*/i, "Uber"],
  [/^doordash\b.*/i, "DoorDash"],
  [/^lyft\b.*/i, "Lyft"],
  [/^venmo\b.*/i, "Venmo"],
];
const NAME_PREFIX = /^(?:(?:pos|debit|credit|card|ach|recurring|checkcard|visa)\s+)*(?:purchase\s+|payment\s+|pmt\s+)?(?:sq|tst|sp|py|pp|paypal|dd|in|ic|sumup|toast|clover)\s*\*\s*/i;
const NAME_PREFIX_WORDS = /^(?:(?:pos|debit|credit|card|ach|recurring|checkcard|visa|purchase|withdrawal|electronic|online)\s+)+/i;
const STATES = "al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy";
const KEEP_UPPER = new Set(["bp", "cvs", "ups", "usps", "ikea", "hbo", "atm", "llc", "us", "tj", "rei", "ymca", "mn", "dmv"]);

export function cleanMerchantName(description) {
  let s = String(description || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  s = s.replace(NAME_PREFIX, "").replace(NAME_PREFIX_WORDS, "")
    .replace(/\s+(?:pending|pend)$/i, "");                  // a trailing "PENDING" from the bank
  for (const [re, name] of NAME_FIXES) if (re.test(s)) return name;
  s = s
    .replace(/\*\s*(?=[a-z0-9]*\d)[a-z0-9]{5,}\b.*$/i, "")     // "*RV1IN47W3": an order code and what follows
    .replace(/\s+(?:#|no\.?\s*)?\d[\d-]*\b.*$/i, "")          // store numbers and everything after
    .replace(/\s+[a-z]-\d+\b.*$/i, "")                      // "T-2177 MPLS"
    .replace(new RegExp(`\\s+(?:mpls|minneapolis|st\\.? paul|saint paul|${STATES})$`, "i"), "")
    .replace(/[*#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return String(description || "").trim();
  // Title case only when the bank shouted; keep mixed case as written.
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().split(" ").map((w) => (KEEP_UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(" ");
    s = s.replace(/ S\b/g, "'s").replace(/\.Com\b/g, ".com");
  }
  return s;
}
