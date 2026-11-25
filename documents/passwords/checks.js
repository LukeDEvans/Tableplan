// Needs attention (PASSWORDS_DESIGN.md §5; leak check on, Luke 2026-11-21).
//
// - REUSED: the same password on logins for different sites.
// - WEAK: generator.js isWeak.
// - LEAKED: the password appears in Have I Been Pwned's Pwned Passwords list. Only the
//   first 5 characters of the password's SHA-1 hash leave the device (k-anonymity);
//   the matching against the returned suffixes happens here. "Add-Padding" makes
//   every answer about the same size, so a watcher can't tell which prefix matched.
//   HIBP's range API is free, keyless and allows browser calls (CORS); called
//   straight from the device so the prefix doesn't pass through our servers either.
// - CHECK: the import found two passwords for one login (transfer.js CHECK_TAG).
//
// leakStatus results are cached in the Safe's locked store by the caller, keyed by
// the full hash (which only ever lives on this device, encrypted).

import { isWeak } from "./generator.js";
import { siteKey } from "./site.js";
import { CHECK_TAG } from "./transfer.js";

export const HIBP_RANGE = "https://api.pwnedpasswords.com/range/";
export const LEAK_RECHECK_MS = 7 * 24 * 3600 * 1000;

export async function sha1Hex(text) {
  const d = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

// → number of times seen (0 = not found). Throws on network trouble.
export async function pwnedCount(password, { fetchImpl = fetch } = {}) {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5), suffix = hash.slice(5);
  const res = await fetchImpl(HIBP_RANGE + prefix, { headers: { "Add-Padding": "true" }, credentials: "omit", referrerPolicy: "no-referrer" });
  if (!res.ok) throw new Error(`leak check: ${res.status}`);
  for (const line of (await res.text()).split("\n")) {
    const [s, n] = line.trim().split(":");
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}

// logins: [{ id, kind, sites, password, tags }]; leaks: Map(id → count) from the cache.
// → Map(id → [reason]) for those that need attention; reasons: "reused" | "weak" | "leaked" | "check"
export function attention(logins, leaks = new Map()) {
  const out = new Map();
  const add = (id, r) => { if (!out.has(id)) out.set(id, []); if (!out.get(id).includes(r)) out.get(id).push(r); };
  const byPw = new Map();
  for (const l of logins) {
    if (l.kind === "note" || !l.password) continue;
    if (!byPw.has(l.password)) byPw.set(l.password, []);
    byPw.get(l.password).push(l);
  }
  for (const group of byPw.values()) {
    const sites = new Set(group.map((l) => (l.sites || []).map(siteKey).find(Boolean) || `id:${l.id}`));
    if (sites.size > 1) for (const l of group) add(l.id, "reused");
  }
  for (const l of logins) {
    if (l.kind === "note") continue;
    if (l.password && isWeak(l.password)) add(l.id, "weak");
    if ((leaks.get(l.id) || 0) > 0) add(l.id, "leaked");
    if ((l.tags || []).includes(CHECK_TAG)) add(l.id, "check");
  }
  return out;
}

export const REASON_LABEL = Object.freeze({
  reused: "Used on other sites",
  weak: "Weak",
  leaked: "Found in a data breach",
  check: "Two passwords found on import",
});
