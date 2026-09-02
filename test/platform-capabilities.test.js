import { describe, it, expect } from "vitest";
import { PLATFORM_CAPABILITIES, capabilityById, describeCapabilities } from "../platform-capabilities.js";

describe("platform capabilities catalog", () => {
  it("every entry has the required shape", () => {
    for (const c of PLATFORM_CAPABILITIES) {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.label).toBe("string");
      expect(typeof c.module).toBe("string");
      expect(Array.isArray(c.consumers)).toBe(true);
      expect(c.consumers.length).toBeGreaterThan(0);
      expect(["stable", "emerging", "planned"]).toContain(c.status);
    }
  });

  it("ids are unique", () => {
    const ids = PLATFORM_CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("capabilityById resolves and misses cleanly", () => {
    expect(capabilityById("sync").label).toBe("Cross-device sync");
    expect(capabilityById("nope")).toBe(null);
  });

  it("the established platform mechanisms are catalogued", () => {
    const ids = new Set(PLATFORM_CAPABILITIES.map((c) => c.id));
    for (const must of ["persistence", "sync", "account-boundary", "provenance", "import", "providers", "media-playback"]) {
      expect(ids.has(must)).toBe(true);
    }
  });

  it("describeCapabilities marks planned ones unavailable by default", () => {
    const d = describeCapabilities();
    expect(d.find((c) => c.id === "sync").available).toBe(true);
    expect(d.find((c) => c.id === "search").available).toBe(false); // planned
  });

  it("describeCapabilities honors an explicit availability map", () => {
    const d = describeCapabilities({ search: true, sync: false });
    expect(d.find((c) => c.id === "search").available).toBe(true);
    expect(d.find((c) => c.id === "sync").available).toBe(false);
  });
});
