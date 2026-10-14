import { describe, it, expect } from "vitest";
import { profileInitials, parseDob, birthdaySummary, avatarPlan, readCachedAvatar, writeCachedAvatar, avatarPublicUrl, loadAvatar } from "../profile.js";

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
}

describe("profile helpers", () => {
  it("initials", () => {
    expect(profileInitials("Luke Evans")).toBe("LE");
    expect(profileInitials("  luke ")).toBe("L");
    expect(profileInitials("Mary Jo Smith")).toBe("MJ");
    expect(profileInitials("")).toBe("");
  });

  it("parseDob rejects impossible dates", () => {
    expect(parseDob("1990-02-30")).toBeNull();
    expect(parseDob("nope")).toBeNull();
    expect(parseDob("1990-03-04")).toEqual({ y: 1990, mo: 3, d: 4 });
  });

  it("birthday summary: soon, today, tomorrow, far away", () => {
    const now = new Date(2026, 9, 13); // Oct 13 2026
    expect(birthdaySummary("1990-10-13", now)).toMatchObject({ detail: "Happy birthday — 36 today", age: 36, daysUntil: 0 });
    expect(birthdaySummary("1990-10-14", now).detail).toBe("Turns 36 tomorrow");
    expect(birthdaySummary("1990-11-02", now).detail).toBe("Turns 36 in 20 days");
    const far = birthdaySummary("1990-03-04", now);
    expect(far.dateLabel).toBe("March 4, 1990");
    expect(far.detail).toBe("36 years old");
    expect(far.age).toBe(36);
  });

  it("birthday summary crosses the year end", () => {
    const now = new Date(2026, 11, 20); // Dec 20
    expect(birthdaySummary("2000-01-05", now)).toMatchObject({ daysUntil: 16, detail: "Turns 27 in 16 days" });
  });

  it("Feb 29 birthdays land on Feb 28 in common years", () => {
    const now = new Date(2027, 1, 20);
    expect(birthdaySummary("2000-02-29", now)).toMatchObject({ daysUntil: 8, detail: "Turns 27 in 8 days" });
  });

  it("empty or invalid birthday gives null", () => {
    expect(birthdaySummary("")).toBeNull();
    expect(birthdaySummary(undefined)).toBeNull();
  });
});

describe("profile photo: download only when the version changes", () => {
  it("plans", () => {
    expect(avatarPlan("", null)).toEqual({ action: "none" });
    expect(avatarPlan(null, { v: "1", dataUrl: "data:image/jpeg;base64,x" })).toEqual({ action: "none" });
    expect(avatarPlan("2", { v: "1", dataUrl: "data:image/jpeg;base64,x" })).toEqual({ action: "fetch" });
    expect(avatarPlan("2", { v: "2", dataUrl: "data:image/jpeg;base64,x" })).toEqual({ action: "cached", dataUrl: "data:image/jpeg;base64,x" });
  });

  it("cache round-trip ignores non-image data", () => {
    const s = memStorage();
    writeCachedAvatar("u1", "5", "data:image/jpeg;base64,abc", s);
    expect(readCachedAvatar("u1", s)).toEqual({ v: "5", dataUrl: "data:image/jpeg;base64,abc" });
    s.setItem("live_avatar_u2", JSON.stringify({ v: "1", dataUrl: "javascript:alert(1)" }));
    expect(readCachedAvatar("u2", s)).toBeNull();
    writeCachedAvatar("u1", "", "", s);
    expect(readCachedAvatar("u1", s)).toBeNull();
  });

  it("public url is versioned", () => {
    expect(avatarPublicUrl("https://x.supabase.co/", "abc", "17")).toBe("https://x.supabase.co/storage/v1/object/public/avatars/abc/avatar.jpg?v=17");
  });

  it("loadAvatar never fetches when the device copy is current or there is no photo", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: false }; };
    const store = globalThis.localStorage;
    const s = memStorage();
    globalThis.localStorage = s;
    try {
      writeCachedAvatar("u1", "9", "data:image/jpeg;base64,abc");
      expect(await loadAvatar({ baseUrl: "https://x", userId: "u1", version: "9", fetchImpl })).toBe("data:image/jpeg;base64,abc");
      expect(await loadAvatar({ baseUrl: "https://x", userId: "u1", version: "", fetchImpl })).toBe("");
      expect(readCachedAvatar("u1")).toBeNull(); // photo removed elsewhere → copy dropped
      expect(calls).toBe(0);
      expect(await loadAvatar({ baseUrl: "https://x", userId: "u1", version: "10", fetchImpl })).toBe("");
      expect(calls).toBe(1);
    } finally {
      globalThis.localStorage = store;
    }
  });
});
