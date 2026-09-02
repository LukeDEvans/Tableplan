import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_SCOPED_STORAGE_KEYS,
  ACCOUNT_SCOPED_STORAGE_KEY_PREFIXES,
  clearLocalAccountState,
  accountTransitionKind,
} from "../auth-account-reset.js";

// A minimal Web-Storage stand-in: supports removeItem + the length/key(i)
// enumeration API the prefix sweep relies on.
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    removeItem: (k) => map.delete(k),
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    has: (k) => map.has(k),
  };
}

// Keys that are per-DEVICE, not per-account, and must SURVIVE a sign-out. This
// list is the contract test's allowlist — anything localStorage-written in app.js
// must be either account-scoped (cleared) or explicitly listed here.
const DEVICE_NEUTRAL_KEYS = new Set([
  "cadence-view-mode", "cadence-zoom", "live-dev-sw", "live_local_dev",
  "live_push_subscribed", "live-playback-speed-v1", "live_signed_out_explicitly",
  "live_migrated_personal",
]);

describe("clearLocalAccountState — account-transition boundary", () => {
  it("removes every account-scoped exact key", () => {
    const seed = Object.fromEntries(ACCOUNT_SCOPED_STORAGE_KEYS.map((k) => [k, "A-data"]));
    const storage = makeStorage(seed);
    clearLocalAccountState(storage);
    for (const key of ACCOUNT_SCOPED_STORAGE_KEYS) expect(storage.has(key)).toBe(false);
  });

  it("sweeps dynamic prefix keys (e.g. briefing_ai_<date>)", () => {
    const storage = makeStorage({
      "briefing_ai_2026-09-01": "A's briefing",
      "briefing_ai_2026-08-31": "A's older briefing",
      "briefing_something_else": "not a briefing key", // does not match the exact prefix
      "unrelated": "keep",
    });
    clearLocalAccountState(storage);
    expect(storage.has("briefing_ai_2026-09-01")).toBe(false);
    expect(storage.has("briefing_ai_2026-08-31")).toBe(false);
    expect(storage.getItem("briefing_something_else")).toBe("not a briefing key");
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("leaves device-neutral keys untouched", () => {
    const neutral = Object.fromEntries([...DEVICE_NEUTRAL_KEYS].map((k) => [k, `keep-${k}`]));
    const storage = makeStorage({
      ...neutral,
      ...Object.fromEntries(ACCOUNT_SCOPED_STORAGE_KEYS.map((k) => [k, "x"])),
      "briefing_ai_2026-09-01": "clear-me",
    });
    clearLocalAccountState(storage);
    for (const key of DEVICE_NEUTRAL_KEYS) expect(storage.getItem(key)).toBe(`keep-${key}`);
  });

  it("is idempotent and a no-op when keys are already absent", () => {
    const storage = makeStorage({ "unrelated": "keep" });
    clearLocalAccountState(storage);
    clearLocalAccountState(storage);
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("never throws on a missing, malformed, or throwing storage", () => {
    expect(() => clearLocalAccountState(undefined)).not.toThrow();
    expect(() => clearLocalAccountState(null)).not.toThrow();
    expect(() => clearLocalAccountState({})).not.toThrow(); // no removeItem
    const throwing = { removeItem: () => { throw new Error("private mode"); }, get length() { return 0; }, key: () => null };
    expect(() => clearLocalAccountState(throwing)).not.toThrow();
  });

  it("covers the mirror + travel-backup vectors that re-seed a merge", () => {
    // These specifically re-seed state after sign-out (the mirror boots the next
    // session's in-memory state; the trip backup is restored by applyStoredState).
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain("tableplan-state-v1");
    expect(ACCOUNT_SCOPED_STORAGE_KEYS).toContain("tableplan-trips-v1");
  });

  it("does not include device-neutral keys in the scoped list", () => {
    for (const neutral of DEVICE_NEUTRAL_KEYS) {
      expect(ACCOUNT_SCOPED_STORAGE_KEYS).not.toContain(neutral);
    }
  });
});

describe("accountTransitionKind — multi-tab account isolation", () => {
  const sess = (id, email) => ({ access_token: "tok", user: { id, email } });

  it("no session, none established → none (never resets a signed-out boot)", () => {
    expect(accountTransitionKind(null, null)).toBe("none");
    expect(accountTransitionKind(null, {})).toBe("none");
    expect(accountTransitionKind(null, { access_token: "" })).toBe("none");
  });

  it("session appears with no account established → first (hydrate)", () => {
    expect(accountTransitionKind(null, sess("u-A"))).toBe("first");
  });

  it("same account, new token → refresh (no reload, no re-hydrate)", () => {
    expect(accountTransitionKind("u-A", sess("u-A"))).toBe("refresh");
  });

  it("DIFFERENT account now authenticated → changed (reset the boundary)", () => {
    expect(accountTransitionKind("u-A", sess("u-B"))).toBe("changed");
  });

  it("account signed out (possibly cross-tab) → signout (reset to gate)", () => {
    expect(accountTransitionKind("u-A", null)).toBe("signout");
    expect(accountTransitionKind("u-A", { access_token: "" })).toBe("signout");
  });

  it("falls back to email identity when id is absent", () => {
    expect(accountTransitionKind("a@x.com", sess(null, "a@x.com"))).toBe("refresh");
    expect(accountTransitionKind("a@x.com", sess(null, "b@x.com"))).toBe("changed");
  });

  it("SAFETY: an unidentifiable session never yields 'changed' (no spurious destructive reset)", () => {
    // A malformed/partial refresh event (session present, no user) must be treated
    // as a same-account refresh, never as a transition that clears local data.
    expect(accountTransitionKind("u-A", { access_token: "tok" })).toBe("refresh");
    expect(accountTransitionKind("u-A", { access_token: "tok", user: {} })).toBe("refresh");
  });

  it("full A→sign-out→B lifecycle classifies correctly", () => {
    // Tab holds A; another tab signs out → this tab sees signout; then B signs in.
    expect(accountTransitionKind("u-A", null)).toBe("signout");      // reset → reload
    expect(accountTransitionKind(null, sess("u-B"))).toBe("first");  // fresh boot hydrates B
    // Or B signs in directly with no intervening signout event (session swaps A→B):
    expect(accountTransitionKind("u-A", sess("u-B"))).toBe("changed"); // reset → reload → boots as B
  });
});

// CONTRACT TEST — the one that catches an unclassified NEW key. Scans app.js for
// every localStorage key and asserts each is either account-scoped (cleared) or
// explicitly device-neutral. A newly-added account key that nobody remembered to
// clear (the exact way briefing_ai_/live-music slipped past the first pass) fails
// here instead of leaking across accounts in production.
describe("localStorage key completeness (app.js)", () => {
  const appJs = readFileSync(fileURLToPath(new URL("../app.js", import.meta.url)), "utf8");

  // Resolve `const NAME = "value"` so identifier args (STORAGE_KEY, …) can be mapped.
  const constMap = new Map();
  for (const m of appJs.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    constMap.set(m[1], m[2] ?? m[3]);
  }

  // Collect each localStorage key: string literal, resolvable const, or the static
  // prefix of a template literal (marked isPrefix).
  const found = new Map(); // key/prefix -> isPrefix
  for (const m of appJs.matchAll(/localStorage\.(?:setItem|getItem|removeItem)\(\s*([^,)]+?)\s*[,)]/g)) {
    const arg = m[1].trim();
    if (/^["']/.test(arg)) {
      found.set(arg.slice(1, -1), false);
    } else if (arg.startsWith("`")) {
      const staticPrefix = arg.slice(1).split("${")[0];
      if (staticPrefix) found.set(staticPrefix, true);
    } else if (/^[A-Za-z_$][\w$]*$/.test(arg) && constMap.has(arg)) {
      found.set(constMap.get(arg), false);
    }
    // computed/other args are skipped — they can't be classified statically
  }

  const scopedExact = new Set(ACCOUNT_SCOPED_STORAGE_KEYS);
  const isClassified = (key, isPrefix) => {
    if (isPrefix) return ACCOUNT_SCOPED_STORAGE_KEY_PREFIXES.includes(key);
    return scopedExact.has(key)
      || ACCOUNT_SCOPED_STORAGE_KEY_PREFIXES.some((p) => key.startsWith(p))
      || DEVICE_NEUTRAL_KEYS.has(key);
  };

  it("discovered a meaningful set of keys (guards the scanner itself)", () => {
    expect(found.size).toBeGreaterThan(8);
    expect(found.has("tableplan-state-v1")).toBe(true); // sanity: the mirror was found
  });

  it("classifies every localStorage key as account-scoped or device-neutral", () => {
    const unclassified = [...found.entries()]
      .filter(([key, isPrefix]) => !isClassified(key, isPrefix))
      .map(([key, isPrefix]) => (isPrefix ? `${key}* (prefix)` : key));
    // If this fails, a new localStorage key was added: either add it to
    // ACCOUNT_SCOPED_STORAGE_KEYS / _PREFIXES (auth-account-reset.js) so sign-out
    // clears it, or to DEVICE_NEUTRAL_KEYS above if it is genuinely per-device.
    expect(unclassified).toEqual([]);
  });
});
