import { describe, it, expect } from "vitest";
import { logoPlan, fitWithin, logoObjectPath, logoVersion, logoPublicUrl } from "../view-logo.js";

describe("view logos", () => {
  it("downloads only when the version changed", () => {
    expect(logoPlan("", null)).toEqual({ action: "none" });
    expect(logoPlan("5", { v: "5", dataUrl: "data:image/png;base64,x" })).toEqual({ action: "cached", dataUrl: "data:image/png;base64,x" });
    expect(logoPlan("6", { v: "5", dataUrl: "data:image/png;base64,x" })).toEqual({ action: "fetch" });
  });
  it("keeps the logo's shape and never enlarges it", () => {
    expect(fitWithin(1023, 836, 640)).toEqual({ width: 640, height: 523 });
    expect(fitWithin(300, 100, 640)).toEqual({ width: 300, height: 100 });
  });
  it("stores each view in the user's own folder", () => {
    expect(logoObjectPath("u1", "household")).toBe("u1/logo-household.png");
    expect(() => logoObjectPath("u1", "../x")).toThrow();
    expect(logoPublicUrl("https://x.supabase.co/", "u1", "business", "9")).toBe("https://x.supabase.co/storage/v1/object/public/avatars/u1/logo-business.png?v=9");
  });
  it("reads one view's version from the metadata", () => {
    expect(logoVersion({ logo_v: { household: 12 } }, "household")).toBe("12");
    expect(logoVersion({}, "household")).toBe("");
  });
});
