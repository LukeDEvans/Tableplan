import { describe, it, expect } from "vitest";
import { storeReturnDays, addDays, upcomingReturns, returnReminderInstances } from "../receipt-returns.js";

describe("return windows", () => {
  it("knows common stores' usual windows, not every store", () => {
    expect(storeReturnDays("Target")).toBe(90);
    expect(storeReturnDays("AMAZON MKTPL")).toBe(30);
    expect(storeReturnDays("Trader Joe's")).toBe(0);
    expect(addDays("2026-11-10", 90)).toBe("2027-02-08");
  });
  it("lists returns closing in the next 45 days and warranties still in force", () => {
    const today = new Date(2026, 10, 12);
    const u = upcomingReturns([
      { id: "a", merchant: "Target", returnBy: "2026-11-14" },
      { id: "b", merchant: "Old", returnBy: "2026-11-01" },
      { id: "c", merchant: "Far", returnBy: "2027-03-01" },
      { id: "d", merchant: "TV", warrantyUntil: "2027-11-01" },
    ], today);
    expect(u.returns).toEqual([{ id: "a", store: "Target", date: "2026-11-14", daysLeft: 2 }]);
    expect(u.warranties.map((w) => w.id)).toEqual(["d"]);
  });
  it("reminds 3 days before at 9 am; one already inside that window reminds soon; a closed window not at all", () => {
    const now = new Date(2026, 10, 12, 12, 0).getTime();
    const [far] = returnReminderInstances([{ id: "a", merchant: "Target", returnBy: "2026-11-30" }], now);
    expect(new Date(far.fireAt)).toEqual(new Date(2026, 10, 27, 9, 0));
    const [soon] = returnReminderInstances([{ id: "b", returnBy: "2026-11-13" }], now);
    expect(soon.fireAt - now).toBe(15 * 60000);
    expect(returnReminderInstances([{ id: "c", returnBy: "2026-11-10" }], now)).toEqual([]);
  });
});
