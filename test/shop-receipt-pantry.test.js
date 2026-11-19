import { describe, it, expect } from "vitest";
import { pantryRoomFor, isGroceryReceipt, receiptIntoPantry, undoPantry, PANTRY_ROOMS } from "../receipt-pantry.js";

let n = 0;
const createId = (p) => `${p}-${++n}`;
const line = (normalizedName, category, totalPrice = 3, quantity = 1) => ({ normalizedName, category, totalPrice, quantity });

describe("receipt into the pantry", () => {
  it("rooms by grocery category; household goods left out", () => {
    expect(pantryRoomFor("Dairy")).toBe(PANTRY_ROOMS.fridge);
    expect(pantryRoomFor("Produce")).toBe(PANTRY_ROOMS.fridge);
    expect(pantryRoomFor("Frozen")).toBe(PANTRY_ROOMS.freezer);
    expect(pantryRoomFor("Dry Goods")).toBe(PANTRY_ROOMS.pantry);
    expect(pantryRoomFor("Household")).toBe("");
  });
  it("a grocery run: a Shop store, or mostly food", () => {
    expect(isGroceryReceipt({ storeId: "aldi", lineItems: [line("Milk", "Dairy")] })).toBe(true);
    expect(isGroceryReceipt({ lineItems: [line("Milk", "Dairy"), line("Bread", "Bakery"), line("Towels", "Household")] })).toBe(true);
    expect(isGroceryReceipt({ lineItems: [line("Towels", "Household"), line("Soap", "Household")] })).toBe(false);
  });
  it("adds new items to their rooms and tops up what's already there", () => {
    const items = [{ id: "i1", name: "Milk", boxId: PANTRY_ROOMS.fridge, quantity: "1", notes: "Bought 2026-11-01 at Aldi\nkeep 2" }, { id: "i2", name: "Rice", boxId: "ibox-x", quantity: "a bag", notes: null }];
    const r = receiptIntoPantry({ storeName: "Costco", purchaseDate: "2026-11-12", lineItems: [line("milk", "Dairy", 4, 2), line("Rice", "Dry Goods"), line("Frozen peas", "Frozen"), line("Paper towels", "Household"), line("Coupon", "Other", -2)] }, items, { createId });
    expect(r).toMatchObject({ added: 1, updated: 2 });
    const by = Object.fromEntries(r.items.map((i) => [i.name, i]));
    expect(by.Milk).toMatchObject({ quantity: "3", notes: "Bought 2026-11-12 at Costco\nkeep 2" });
    expect(by.Rice).toMatchObject({ boxId: "ibox-x", quantity: "1" }); // keeps its room; "a bag" isn't a number
    expect(by["Frozen peas"]).toMatchObject({ boxId: PANTRY_ROOMS.freezer, quantity: "1" });
    expect(by["Paper towels"]).toBeUndefined();
    // Undo puts it all back.
    expect(undoPantry(r.items, r.changed)).toEqual(items);
  });
  it("a room that's been turned off falls back to the Pantry", () => {
    const r = receiptIntoPantry({ lineItems: [line("Ice cream", "Frozen")] }, [], { createId, roomsAvailable: new Set([PANTRY_ROOMS.pantry]) });
    expect(r.items[0].boxId).toBe(PANTRY_ROOMS.pantry);
  });
});
