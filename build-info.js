// Which build this device is running (ISSUES.md P1, 2026-10-06): the commit and
// build time are stamped in by vite.config.mjs, and the same stamp is published as
// /version.json, so an open web app can tell when a newer deploy is live.
// Pure apart from the build-time constant; no Supabase, no state.

/* global __LIVE_BUILD__ */
export const BUILD = normalizeBuild(typeof __LIVE_BUILD__ !== "undefined" ? __LIVE_BUILD__ : null);

// How often an open web app checks /version.json, at most.
export const VERSION_CHECK_MIN_MS = 30 * 60 * 1000;

export function normalizeBuild(raw) {
  const commit = String(raw?.commit || "").trim().slice(0, 40);
  const builtAt = Date.parse(raw?.builtAt || "") ? new Date(raw.builtAt).toISOString() : "";
  return { commit: commit || "dev", builtAt };
}

// "520dd9f · Oct 26, 10:12 PM", or "local dev" for an unstamped build.
export function formatBuild(build, locale) {
  const b = normalizeBuild(build);
  if (b.commit === "dev" && !b.builtAt) return "local dev";
  const short = b.commit.slice(0, 7);
  if (!b.builtAt) return short;
  const when = new Date(b.builtAt).toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `${short} · ${when}`;
}

// True when the published build is a different, later build than the running one.
// An unstamped running build (local dev) never asks to reload.
export function isNewerBuild(published, running) {
  const p = normalizeBuild(published);
  const r = normalizeBuild(running);
  if (r.commit === "dev" || p.commit === "dev" || !p.builtAt || !r.builtAt) return false;
  if (p.commit === r.commit) return false;
  return Date.parse(p.builtAt) > Date.parse(r.builtAt);
}

export function versionCheckDue(lastCheckedAt, now = Date.now(), minMs = VERSION_CHECK_MIN_MS) {
  return !lastCheckedAt || now - lastCheckedAt >= minMs;
}
