import { describe, it, expect } from "vitest";
import { ACCOUNT_SCOPED_STORAGE_KEYS, clearLocalAccountState } from "../auth-account-reset.js";

// A minimal localStorage stand-in.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    removeItem: (k) => map.delete(k),
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    has: (k) => map.has(k),
    keys: () => [...map.keys()],
  };
}

describe("clearLocalAccountState — account-transition boundary", () => {
  it("removes every account-scoped key", () => {
    const seed = Object.fromEntries(ACCOUNT_SCOPED_STORAGE_KEYS.map((k) => [k, "A-data"]));
    const storage = makeStorage(seed);
    clearLocalAccountState(storage);
    for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) {
      expect(storage.has(key)).toBe(false);
    }
  });

  it("leaves device-neutral / other keys untouched", () => {
    // These are per-device, not per-account, and must survive a sign-out.
    const neutral = {
      "live_local_dev": "1",
      "live_push_subscribed": "1",
      "tableplan-playback-speed": "1.5",
      "cadence-view-mode": "page",
      "cadence-zoom": "1.2",
      "live_signed_out_explicitly": "2026-09-01T00:00:00Z", // set by sign-out; must persist
      "some-unrelated-key": "keep",
    };
    const storage = makeStorage({
      ...neutral,
      ...Object.fromEntries(ACCOUNT_SCOPED_STORAGE_KEYS.map((k) => [k, "x"])),
    });
    clearLocalAccountState(storage);
    for (const key of Object.keys(neutral)) {
      expect(storage.getItem(key)).toBe(neutral[key]);
    }
  });

  it("is idempotent and a no-op when keys are already absent", () => {
    const storage = makeStorage({ "some-unrelated-key": "keep" });
    clearLocalAccountState(storage);
    clearLocalAccountState(storage); // second run must not throw
    expect(storage.getItem("some-unrelated-key")).toBe("keep");
  });

  it("never throws on a missing, malformed, or throwing storage", () => {
    expect(() => clearLocalAccountState(undefined)).not.toThrow();
    expect(() => clearLocalAccountState(null)).not.toThrow();
    expect(() => clearLocalAccountState({})).not.toThrow(); // no removeItem
    const throwing = { removeItem: () => { throw new Error("private mode"); } };
    expect(() => clearLocalAccountState(throwing)).not.toThrow();
  });

  it("covers the mirror and travel-backup vectors that would re-seed a merge", () => {
    // These two specifically re-seed state after sign-out: the mirror boots the
    // next session's in-memory state, and the trip backup is restored by
    // applyStoredState. Both MUST be in the cleared set or the reload wouldn't
    // stop cross-account contamination.
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain("tableplan-state-v1");
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain("tableplan-trips-v1");
  });

  it("does not accidentally include device-neutral keys in the scoped list", () => {
    for (const neutral of ["live_local_dev", "live_push_subscribed", "tableplan-playback-speed", "cadence-view-mode"]) {
      expect(ACCOUNT_SCOPED_STORAGE_KEYS).not.toContain(neutral);
    }
  });
});
