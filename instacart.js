// instacart.js — pure Instacart hand-off logic for the Shop (groceries) domain.
//
// Network-free and DOM-free so it is unit-testable and importable from both the
// client (groceries-ui.js) and the Netlify function (instacart-list.js re-validates
// the payload server-side). The only vendor call — Instacart Developer Platform
// "Create shopping list page" (POST /idp/v1/products/products_link) — lives in
// netlify/functions/instacart-list.js, which holds the API key (ARCHITECTURE §7).
//
// Order lifecycle is two DISTINCT states, never one:
//   sent_to_instacart — the list page was created and handed off (NOT purchased;
//                       Instacart gives no checkout confirmation at this tier).
//   delivered         — set manually by the user when the groceries arrive.

export const INSTACART_ORDER_STATUS = Object.freeze({
  SENT: "sent_to_instacart",
  DELIVERED: "delivered"
});

// Chains Instacart can fulfil for this household. Only used to SEED the per-store
// `instacartEnabled` flag the first time a store is normalized without one — after
// that the flag on the store record is the source of truth (editable in the store
// dialog), so the supported list is data, not logic.
export const INSTACART_DEFAULT_CHAINS = Object.freeze(["aldi", "costco", "cub foods", "cub"]);

// Hard cap on line items per page — keeps the request bounded (and mirrors the
// server-side cap in instacart-list.js).
export const INSTACART_MAX_LINE_ITEMS = 200;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function chainKey(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

// Seed value for a store that has never had the flag set.
export function defaultInstacartEnabled(store) {
  const names = [store?.chainName, store?.name].map(chainKey).filter(Boolean);
  return names.some((name) => INSTACART_DEFAULT_CHAINS.some((chain) => name === chain || name.startsWith(`${chain} `)));
}

// Normalizer for the stored flag: explicit booleans win; absent → seed from chain.
export function normalizeInstacartEnabled(store) {
  if (typeof store?.instacartEnabled === "boolean") return store.instacartEnabled;
  return defaultInstacartEnabled(store);
}

export function isInstacartStore(store) {
  return Boolean(store && store.id && store.instacartEnabled === true);
}

// Units Instacart understands for line_item_measurements (lower-case). Anything
// else is sent without a measurement (name + display_text only) rather than risk
// a rejected request.
const UNIT_ALIASES = {
  "": "each", ea: "each", each: "each", count: "each", ct: "each", x: "each",
  cup: "cup", cups: "cup", c: "cup",
  tbsp: "tablespoon", tablespoon: "tablespoon", tablespoons: "tablespoon", tbs: "tablespoon", tb: "tablespoon",
  tsp: "teaspoon", teaspoon: "teaspoon", teaspoons: "teaspoon",
  oz: "ounce", ounce: "ounce", ounces: "ounce",
  "fl oz": "fl oz", floz: "fl oz",
  lb: "pound", lbs: "pound", pound: "pound", pounds: "pound",
  g: "gram", gram: "gram", grams: "gram",
  kg: "kilogram", kilogram: "kilogram", kilograms: "kilogram",
  ml: "milliliter", milliliter: "milliliter", milliliters: "milliliter",
  l: "liter", liter: "liter", liters: "liter", litre: "liter",
  pt: "pint", pint: "pint", pints: "pint",
  qt: "quart", quart: "quart", quarts: "quart",
  gal: "gallon", gallon: "gallon", gallons: "gallon",
  pkg: "package", package: "package", packages: "package", pack: "package", packs: "package",
  can: "can", cans: "can",
  bunch: "bunch", bunches: "bunch",
  head: "head", heads: "head",
  clove: "clove", cloves: "clove",
  large: "large", medium: "medium", small: "small"
};

function parseAmount(text) {
  const value = clean(text);
  if (!value) return null;
  const mixed = value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = value.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[2]) ? Number(fraction[1]) / Number(fraction[2]) : null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// "2 cup + 1 lb + a pinch" → [{quantity:2,unit:"cup"},{quantity:1,unit:"pound"}].
// Unparseable parts are dropped (they still travel in display_text).
export function parseQuantityMeasurements(quantity) {
  return clean(quantity)
    .split(/\s*\+\s*/)
    .map((part) => {
      const match = part.match(/^(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*(.*)$/);
      if (!match) return null;
      const amount = parseAmount(match[1]);
      const unit = UNIT_ALIASES[clean(match[2]).toLowerCase().replace(/\.$/, "")];
      if (!(amount > 0) || !unit) return null;
      return { quantity: Math.round(amount * 1000) / 1000, unit };
    })
    .filter(Boolean);
}

// Grocery rows of ONE store section → Instacart line_items.
// Only rows still needed are sent: unchecked (not already on hand) and not
// swept into "bought". Rows are de-duplicated by key so an item can never be
// ordered twice from one page. Returns { lineItems, skipped } — `skipped` are
// rows that could not be expressed as a line item (no usable name) and must be
// surfaced to the user, never silently dropped; `itemKeys` are the sent rows' keys.
export function buildInstacartLineItems(rows) {
  const lineItems = [];
  const skipped = [];
  const itemKeys = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || row.checked || row.cleared) continue;
    const key = clean(row.key || row.canonicalName || row.item).toLowerCase();
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    const name = clean(row.displayName || row.item);
    if (!name) { skipped.push(clean(row.key) || "(unnamed item)"); continue; }
    if (lineItems.length >= INSTACART_MAX_LINE_ITEMS) { skipped.push(name); continue; }
    const quantity = clean(row.quantity);
    const item = { name, display_text: quantity ? `${name} (${quantity})` : name };
    const measurements = parseQuantityMeasurements(quantity);
    if (measurements.length) item.line_item_measurements = measurements;
    const upcs = (Array.isArray(row.upcs) ? row.upcs : []).map(clean).filter((upc) => /^\d{6,14}$/.test(upc));
    if (upcs.length) item.upcs = upcs;
    lineItems.push(item);
    if (clean(row.key)) itemKeys.push(clean(row.key));
  }
  return { lineItems, skipped, itemKeys };
}

// Server-side re-validation of a client-supplied line_items array: keeps only the
// fields we send, caps size, and rejects nameless items. Never trusts the client.
export function sanitizeInstacartLineItems(items) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(items) ? items : []) {
    const name = clean(raw?.name).slice(0, 200);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const item = { name };
    const displayText = clean(raw?.display_text).slice(0, 300);
    if (displayText) item.display_text = displayText;
    const measurements = (Array.isArray(raw?.line_item_measurements) ? raw.line_item_measurements : [])
      .map((m) => ({ quantity: Number(m?.quantity), unit: clean(m?.unit).toLowerCase().slice(0, 40) }))
      .filter((m) => Number.isFinite(m.quantity) && m.quantity > 0 && m.unit)
      .slice(0, 5);
    if (measurements.length) item.line_item_measurements = measurements;
    const upcs = (Array.isArray(raw?.upcs) ? raw.upcs : []).map(clean).filter((upc) => /^\d{6,14}$/.test(upc)).slice(0, 10);
    if (upcs.length) item.upcs = upcs;
    out.push(item);
    if (out.length >= INSTACART_MAX_LINE_ITEMS) break;
  }
  return out;
}

// Vendor response → { url, unmatched }. The documented response carries
// `products_link_url`. Any per-item match information Instacart returns is
// collected into `unmatched` (names) so the caller can show it — never swallowed.
export function normalizeInstacartResponse(body, sentItems = []) {
  const url = clean(body?.products_link_url || body?.url);
  const unmatched = new Set();
  const collect = (list) => (Array.isArray(list) ? list : []).forEach((entry) => {
    const name = clean(typeof entry === "string" ? entry : (entry?.name || entry?.display_text));
    if (name) unmatched.add(name);
  });
  collect(body?.unmatched_line_items);
  collect(body?.unmatched_items);
  collect(body?.failed_line_items);
  (Array.isArray(body?.line_items) ? body.line_items : []).forEach((entry) => {
    if (entry && (entry.matched === false || entry.status === "unmatched" || entry.status === "not_found")) collect([entry]);
  });
  const sentNames = new Set((Array.isArray(sentItems) ? sentItems : []).map((i) => clean(i?.name).toLowerCase()));
  return {
    url: /^https:\/\//i.test(url) ? url : "",
    // Keep only names we actually sent when we can tell; otherwise report as-is.
    unmatched: [...unmatched].filter((name) => !sentNames.size || sentNames.has(name.toLowerCase()))
  };
}

// ── Order-state records ──────────────────────────────────────────────────────
// Stored in state.instacartOrders as a flat map keyed `${cycleKey}::${storeId}`
// (same keying + unionByKey merge as grocerySkippedStores / groceryCleared).

export function instacartOrderKey(cycleKey, storeId) {
  return `${clean(cycleKey)}::${clean(storeId)}`;
}

function normalizeOrder(order) {
  if (!order || typeof order !== "object") return null;
  const status = Object.values(INSTACART_ORDER_STATUS).includes(order.status) ? order.status : "";
  if (!status) return null;
  const strings = (list) => (Array.isArray(list) ? list : []).map(clean).filter(Boolean).slice(0, INSTACART_MAX_LINE_ITEMS);
  return {
    status,
    storeId: clean(order.storeId),
    url: /^https:\/\//i.test(clean(order.url)) ? clean(order.url) : "",
    sentAt: clean(order.sentAt),
    deliveredAt: status === INSTACART_ORDER_STATUS.DELIVERED ? clean(order.deliveredAt) : "",
    itemKeys: strings(order.itemKeys),
    itemCount: Number.isFinite(Number(order.itemCount)) ? Number(order.itemCount) : strings(order.itemKeys).length,
    unmatched: strings(order.unmatched),
    skipped: strings(order.skipped)
  };
}

export function normalizeInstacartOrders(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [key, order] of Object.entries(map)) {
    if (!key.includes("::")) continue;
    const normalized = normalizeOrder(order);
    if (normalized) out[key] = normalized;
  }
  return out;
}

export function createSentOrder({ storeId, url, itemKeys = [], unmatched = [], skipped = [], now = new Date() }) {
  return normalizeOrder({
    status: INSTACART_ORDER_STATUS.SENT,
    storeId,
    url,
    sentAt: new Date(now).toISOString(),
    itemKeys,
    itemCount: itemKeys.length,
    unmatched,
    skipped
  });
}

export function markOrderDelivered(order, now = new Date()) {
  const current = normalizeOrder(order);
  if (!current) return null;
  return { ...current, status: INSTACART_ORDER_STATUS.DELIVERED, deliveredAt: new Date(now).toISOString() };
}

// Undo "delivered" (mis-tap) — back to handed-off, delivery time cleared.
export function markOrderNotDelivered(order) {
  const current = normalizeOrder(order);
  if (!current) return null;
  return { ...current, status: INSTACART_ORDER_STATUS.SENT, deliveredAt: "" };
}
