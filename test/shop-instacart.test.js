import { describe, it, expect } from "vitest";
import {
  INSTACART_ORDER_STATUS,
  defaultInstacartEnabled,
  normalizeInstacartEnabled,
  isInstacartStore,
  parseQuantityMeasurements,
  buildInstacartLineItems,
  sanitizeInstacartLineItems,
  normalizeInstacartResponse,
  instacartOrderKey,
  normalizeInstacartOrders,
  createSentOrder,
  markOrderDelivered,
  markOrderNotDelivered
} from "../instacart.js";
import { normalizeGroceryStores, normalizeGroceryItemLocations, partitionGroceryRowsByStore } from "../groceries-ui.js";
import { handler, instacartBaseUrl } from "../netlify/functions/instacart-list.mjs";

describe("store config: instacartEnabled flag", () => {
  it("seeds from supported chains only when the flag was never set", () => {
    expect(defaultInstacartEnabled({ name: "ALDI" })).toBe(true);
    expect(defaultInstacartEnabled({ name: "Costco Wholesale" })).toBe(true);
    expect(defaultInstacartEnabled({ name: "Costco" })).toBe(true);
    expect(defaultInstacartEnabled({ name: "Cub Foods - Uptown" })).toBe(true);
    expect(defaultInstacartEnabled({ name: "Target" })).toBe(false);
    expect(defaultInstacartEnabled({ name: "Whole Foods Market" })).toBe(false);
    expect(defaultInstacartEnabled({ name: "Trader Joe's" })).toBe(false);
    expect(defaultInstacartEnabled({ name: "Cubby's" })).toBe(false);
  });

  it("an explicit boolean on the store record always wins (data, not logic)", () => {
    expect(normalizeInstacartEnabled({ name: "Aldi", instacartEnabled: false })).toBe(false);
    expect(normalizeInstacartEnabled({ name: "Target", instacartEnabled: true })).toBe(true);
  });

  it("normalizeGroceryStores carries the flag and round-trips it", () => {
    const [aldi, target] = normalizeGroceryStores([{ id: "a", name: "Aldi" }, { id: "t", name: "Target" }]);
    expect(aldi.instacartEnabled).toBe(true);
    expect(target.instacartEnabled).toBe(false);
    const again = normalizeGroceryStores([{ ...aldi, instacartEnabled: false }]);
    expect(again[0].instacartEnabled).toBe(false);
    expect(isInstacartStore(aldi)).toBe(true);
    expect(isInstacartStore(target)).toBe(false);
    expect(isInstacartStore(null)).toBe(false);
  });
});

describe("one item, one store", () => {
  it("partitions every row into exactly one group; unknown/empty → Unassigned", () => {
    const rows = [{ key: "milk" }, { key: "eggs" }, { key: "bread" }, { key: "milk" }];
    const assign = { milk: "aldi", eggs: "gone", bread: "" };
    const groups = partitionGroceryRowsByStore(rows, ["aldi", "costco"], (r) => assign[r.key]);
    expect(groups.get("aldi").map((r) => r.key)).toEqual(["milk"]);
    expect(groups.get("costco")).toEqual([]);
    expect(groups.get("").map((r) => r.key)).toEqual(["eggs", "bread"]);
    const all = [...groups.values()].flat().map((r) => r.key);
    expect(new Set(all).size).toBe(all.length);
  });

  it("resolves each row once, even if the resolver is non-deterministic", () => {
    let n = 0;
    const groups = partitionGroceryRowsByStore([{ key: "x" }], ["a", "b"], () => (n++ ? "b" : "a"));
    expect(groups.get("a").length + groups.get("b").length).toBe(1);
    expect(n).toBe(1);
  });

  it("item locations hold one primary store and a de-duplicated rank", () => {
    const stores = [{ id: "a", name: "Aldi" }, { id: "c", name: "Costco" }];
    const locs = normalizeGroceryItemLocations({ milk: { storeId: "a", storeRank: ["c", "a", "c", "zz"] } }, stores);
    expect(locs.milk.storeId).toBe("a");
    expect(locs.milk.storeRank).toEqual(["a", "c"]);
  });
});

describe("line items", () => {
  it("parses measurements from the list's quantity string", () => {
    expect(parseQuantityMeasurements("2 cups + 1 lb")).toEqual([{ quantity: 2, unit: "cup" }, { quantity: 1, unit: "pound" }]);
    expect(parseQuantityMeasurements("1 1/2 tbsp")).toEqual([{ quantity: 1.5, unit: "tablespoon" }]);
    expect(parseQuantityMeasurements("3")).toEqual([{ quantity: 3, unit: "each" }]);
    expect(parseQuantityMeasurements("a pinch")).toEqual([]);
    expect(parseQuantityMeasurements("2 splorks")).toEqual([]);
  });

  it("sends only unchecked, un-bought rows, once each, and reports nameless rows", () => {
    const { lineItems, skipped, itemKeys } = buildInstacartLineItems([
      { key: "milk", displayName: "Milk", quantity: "1 gal" },
      { key: "eggs", displayName: "Eggs", quantity: "12", checked: true },
      { key: "flour", displayName: "Flour", cleared: true },
      { key: "milk", displayName: "Milk", quantity: "1 gal" },
      { key: "mystery", displayName: "", item: "" },
      { key: "salt", item: "Salt", upcs: ["012345678905", "bad"] }
    ]);
    expect(lineItems).toEqual([
      { name: "Milk", display_text: "Milk (1 gal)", line_item_measurements: [{ quantity: 1, unit: "gallon" }] },
      { name: "Salt", display_text: "Salt", upcs: ["012345678905"] }
    ]);
    expect(itemKeys).toEqual(["milk", "salt"]);
    expect(skipped).toEqual(["mystery"]);
  });

  it("server sanitizer strips unknown fields, dedupes, and drops nameless items", () => {
    const out = sanitizeInstacartLineItems([
      { name: " Milk ", display_text: "Milk", evil: "x", line_item_measurements: [{ quantity: -1, unit: "cup" }, { quantity: 2, unit: "Cup" }] },
      { name: "milk" },
      { name: "" },
      "junk"
    ]);
    expect(out).toEqual([{ name: "Milk", display_text: "Milk", line_item_measurements: [{ quantity: 2, unit: "cup" }] }]);
  });
});

describe("vendor response", () => {
  it("extracts the link and never swallows reported match failures", () => {
    const sent = [{ name: "Milk" }, { name: "Zatar" }];
    expect(normalizeInstacartResponse({ products_link_url: "https://www.instacart.com/store/shopping_lists/1" }, sent))
      .toEqual({ url: "https://www.instacart.com/store/shopping_lists/1", unmatched: [] });
    expect(normalizeInstacartResponse({ products_link_url: "https://x", unmatched_line_items: [{ name: "Zatar" }] }, sent).unmatched).toEqual(["Zatar"]);
    expect(normalizeInstacartResponse({ products_link_url: "https://x", line_items: [{ name: "Milk", matched: true }, { name: "Zatar", matched: false }] }, sent).unmatched).toEqual(["Zatar"]);
    expect(normalizeInstacartResponse({ products_link_url: "javascript:alert(1)" }).url).toBe("");
  });
});

describe("order states", () => {
  it("sent_to_instacart and delivered are distinct, reversible states", () => {
    const now = new Date("2026-09-28T12:00:00Z");
    const sent = createSentOrder({ storeId: "a", url: "https://x", itemKeys: ["milk"], unmatched: ["zatar"], now });
    expect(sent.status).toBe(INSTACART_ORDER_STATUS.SENT);
    expect(sent.status).toBe("sent_to_instacart");
    expect(sent.deliveredAt).toBe("");
    const delivered = markOrderDelivered(sent, new Date("2026-09-29T09:00:00Z"));
    expect(delivered.status).toBe("delivered");
    expect(delivered.deliveredAt).toBe("2026-09-29T09:00:00.000Z");
    expect(delivered.sentAt).toBe(sent.sentAt);
    const undone = markOrderNotDelivered(delivered);
    expect(undone.status).toBe("sent_to_instacart");
    expect(undone.deliveredAt).toBe("");
  });

  it("normalizes the stored map and drops garbage", () => {
    const key = instacartOrderKey("2026-10-02", "a");
    expect(key).toBe("2026-10-02::a");
    const out = normalizeInstacartOrders({
      [key]: { status: "delivered", url: "https://x", deliveredAt: "t", itemKeys: ["m"] },
      "no-sep": { status: "delivered" },
      "c::b": { status: "purchased" }
    });
    expect(Object.keys(out)).toEqual([key]);
    expect(out[key].itemCount).toBe(1);
    expect(normalizeInstacartOrders(null)).toEqual({});
  });
});

describe("instacart-list function", () => {
  const env = { INSTACART_API_KEY: "sk-test", SUPABASE_SERVICE_ROLE_KEY: "svc" };
  const event = (body, headers = { authorization: "Bearer user-jwt" }) => ({ httpMethod: "POST", headers, body: JSON.stringify(body) });
  function fakeFetch(vendor) {
    const calls = [];
    const fn = async (url, init = {}) => {
      calls.push({ url, init });
      if (url.includes("/auth/v1/user")) return { ok: init.headers.authorization === "Bearer user-jwt", json: async () => ({ id: "u1" }) };
      return { ok: vendor.status < 400, status: vendor.status, json: async () => vendor.body };
    };
    fn.calls = calls;
    return fn;
  }

  it("uses dev by default and prod only when INSTACART_ENV=production", () => {
    expect(instacartBaseUrl({})).toBe("https://connect.dev.instacart.tools");
    expect(instacartBaseUrl({ INSTACART_ENV: "production" })).toBe("https://connect.instacart.com");
    expect(instacartBaseUrl({ INSTACART_API_BASE_URL: "https://example.test/" })).toBe("https://example.test");
  });

  it("rejects unauthenticated callers before touching Instacart", async () => {
    const fetch = fakeFetch({ status: 200, body: {} });
    const res = await handler(event({ lineItems: [{ name: "Milk" }] }, {}), {}, { fetch, env });
    expect(res.statusCode).toBe(401);
    expect(fetch.calls.length).toBe(0);
  });

  it("503s without a key and never calls the vendor", async () => {
    const fetch = fakeFetch({ status: 200, body: {} });
    const res = await handler(event({ lineItems: [{ name: "Milk" }] }), {}, { fetch, env: { SUPABASE_SERVICE_ROLE_KEY: "svc" } });
    expect(res.statusCode).toBe(503);
    expect(fetch.calls.some((c) => c.url.includes("instacart"))).toBe(false);
  });

  it("makes exactly one vendor call with the key server-side and returns the link", async () => {
    const fetch = fakeFetch({ status: 200, body: { products_link_url: "https://www.instacart.com/store/shopping_lists/9" } });
    const res = await handler(event({ title: "Aldi", lineItems: [{ name: "Milk", secret: "x" }] }), {}, { fetch, env });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.url).toBe("https://www.instacart.com/store/shopping_lists/9");
    expect(body.unmatched).toEqual([]);
    const vendorCalls = fetch.calls.filter((c) => c.url.includes("instacart"));
    expect(vendorCalls).toHaveLength(1);
    expect(vendorCalls[0].url).toBe("https://connect.dev.instacart.tools/idp/v1/products/products_link");
    expect(vendorCalls[0].init.headers.authorization).toBe("Bearer sk-test");
    const sent = JSON.parse(vendorCalls[0].init.body);
    expect(sent).toEqual({ title: "Aldi", link_type: "shopping_list", line_items: [{ name: "Milk" }] });
    expect(res.body).not.toContain("sk-test");
  });

  it("surfaces vendor errors with any unmatched items instead of swallowing them", async () => {
    const fetch = fakeFetch({ status: 400, body: { error: { message: "bad items" }, unmatched_line_items: [{ name: "Zatar" }] } });
    const res = await handler(event({ lineItems: [{ name: "Zatar" }] }), {}, { fetch, env });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body)).toEqual({ error: "bad items", unmatched: ["Zatar"] });
  });

  it("400s on an empty list", async () => {
    const fetch = fakeFetch({ status: 200, body: {} });
    const res = await handler(event({ lineItems: [{ name: "  " }] }), {}, { fetch, env });
    expect(res.statusCode).toBe(400);
  });
});
