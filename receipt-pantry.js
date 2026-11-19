// receipt-pantry.js — PURE: a grocery receipt's items into Inventory (Luke,
// 2026-11-12: "receipts into the pantry").
//
// Each line becomes (or tops up) an Inventory item in the room its grocery
// category belongs in: Dairy / Deli / Produce → Refrigerator, Frozen → Freezer,
// everything else that's food → Pantry. Household goods and discounts are left
// out. An item already in Inventory (same name, any room) keeps its room and has
// its quantity added to when both are plain numbers.

export const PANTRY_ROOMS = { pantry: "ibox-default-pantry", fridge: "ibox-default-fridge", freezer: "ibox-default-freezer" };

const FRIDGE = /\b(dairy|deli|produce|meat|seafood|eggs?|refrigerated|cheese|milk|yogurt)\b/i;
const FREEZER = /\bfrozen\b/i;
const SKIP = /\b(household|cleaning|paper|personal care|health|beauty|pet|baby care|pharmacy|alcohol|tobacco|gift|bag fee|deposit)\b/i;

export function pantryRoomFor(category) {
  const c = String(category || "");
  if (SKIP.test(c)) return "";
  if (FREEZER.test(c)) return PANTRY_ROOMS.freezer;
  if (FRIDGE.test(c)) return PANTRY_ROOMS.fridge;
  return PANTRY_ROOMS.pantry;
}

const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const asNumber = (q) => (q != null && /^\s*\d+(\.\d+)?\s*$/.test(String(q)) ? Number(q) : null);

// Is this a grocery run? A store on the Shop's store list, or mostly food lines.
export function isGroceryReceipt(receipt) {
  const lines = (receipt?.lineItems || []).filter((l) => l?.normalizedName && Number(l.totalPrice) > 0);
  if (!lines.length) return false;
  if (receipt.storeId) return true;
  const food = lines.filter((l) => pantryRoomFor(l.category) !== "").length;
  return food / lines.length >= 0.6;
}

// → { items: the new Inventory list, added, updated, changed: [{ id, before }] }
// `changed` lets the caller undo: before = the item as it was (null when new).
export function receiptIntoPantry(receipt, items, { createId, roomsAvailable = null } = {}) {
  const list = (items || []).map((i) => ({ ...i }));
  const byName = new Map(list.map((i) => [key(i.name), i]));
  const changed = [];
  let added = 0, updated = 0;
  const when = receipt?.purchaseDate || "";
  const note = `Bought ${when}${receipt?.storeName ? ` at ${receipt.storeName}` : ""}`.trim();
  const seen = new Set();
  for (const line of receipt?.lineItems || []) {
    const name = String(line?.normalizedName || "").trim();
    if (!name || !(Number(line.totalPrice) > 0)) continue;
    let room = pantryRoomFor(line.category);
    if (!room) continue;
    if (roomsAvailable && !roomsAvailable.has(room)) room = roomsAvailable.has(PANTRY_ROOMS.pantry) ? PANTRY_ROOMS.pantry : null;
    const qty = Math.max(1, Math.round(Number(line.quantity) || 1));
    const k = key(name);
    const existing = byName.get(k);
    if (existing) {
      if (!seen.has(existing.id)) changed.push({ id: existing.id, before: { ...existing } });
      const n = asNumber(existing.quantity);
      existing.quantity = n != null ? String(n + qty) : String(qty);
      existing.notes = [note, ...String(existing.notes || "").split("\n").filter((l) => l && !/^Bought /.test(l))].join("\n");
      updated += seen.has(existing.id) ? 0 : 1;
      seen.add(existing.id);
    } else {
      const item = { id: createId("iitem"), name, boxId: room, quantity: String(qty), notes: note, trackWeekly: false, createdAt: new Date().toISOString() };
      list.push(item);
      byName.set(k, item);
      seen.add(item.id);
      changed.push({ id: item.id, before: null });
      added += 1;
    }
  }
  return { items: list, added, updated, changed };
}

// Undo: put changed items back as they were and drop the new ones.
export function undoPantry(items, changed) {
  const back = new Map((changed || []).map((c) => [c.id, c.before]));
  return (items || []).flatMap((i) => (back.has(i.id) ? (back.get(i.id) ? [back.get(i.id)] : []) : [i]));
}
