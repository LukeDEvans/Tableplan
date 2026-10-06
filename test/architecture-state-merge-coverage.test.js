import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTING_STAMP_KEYS } from "../settings-sync.js";

// SYNC MERGE COVERAGE (INF-5). mergeStates() starts from `{ ...newer }`, so any
// STATE_SECTIONS key WITHOUT an explicit rule silently falls back to "newer side
// replaces the whole value" — which drops the other device's additions for any
// array/map of user data. This guard fails when a key is added to STATE_SECTIONS
// without either (a) an explicit merge rule in mergeStates, or (b) a deliberate,
// documented entry in MERGE_NEWER_WINS_KEYS below.

const root = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(root + "app.js", "utf8");

function stateSectionKeys() {
  const m = src.match(/const STATE_SECTIONS = \{([\s\S]*?)\n\};/);
  if (!m) throw new Error("STATE_SECTIONS not found in app.js");
  const body = m[1].replace(/\/\/.*$/gm, "");
  return [...body.matchAll(/"([A-Za-z0-9_]+)"/g)].map((x) => x[1]);
}

function mergeStatesBody() {
  const start = src.indexOf("function mergeStates(newer, older) {");
  const end = src.indexOf("\nfunction mergePlanWeeks", start);
  if (start < 0 || end < 0) throw new Error("mergeStates not found in app.js");
  return src.slice(start, end).replace(/\/\/.*$/gm, "");
}

// Keys that intentionally take the newer side's value wholesale. Each needs a
// reason; add here only when newer-wins is really the right semantics.
const MERGE_NEWER_WINS_KEYS = {
  // Scalars / preferences / versions — newest choice is the answer.
  // A reason starting "scalar preference" or "settings object" marks a user
  // setting: test/settings-sync.test.js then requires it in TRACKED_SETTINGS
  // (settings-sync.js), so it merges by its own stamp. Use those words for any
  // new setting.
  groceryCatalogVersion: "scalar version stamp",
  dailyDozenTagSeedVersion: "scalar version stamp",
  foodHealthVersion: "scalar version stamp",
  articleSortOrder: "scalar preference",
  podcastTierCount: "scalar preference",
  podcastPrioritySort: "scalar preference",
  podcastPlaylistWindow: "scalar preference",
  mediaQueueFallback: "scalar preference (what plays when the queue ends)",
  podcastRecentWindow: "scalar preference",
  podcastPlaylistIncludeArticles: "scalar preference",
  podcastSkipAds: "scalar preference",
  libraryKey: "scalar preference",
  themeMode: "scalar preference",
  locationSharingEnabled: "scalar preference",
  financeEmergencyMonths: "finance scalar (guardBootEmptyFinance protects boot-empty)",
  financeBirthYear: "finance scalar",
  financeAnnualIncome: "finance scalar",
  // Settings objects — one coherent config blob, newest wins as a unit.
  mailAiSettings: "settings object",
  aiSettings: "settings object",
  jellyfin: "settings object",
  mediaServices: "settings object",
  appleMusic: "settings object",
  financeAlertPrefs: "settings object",
  apiUsage: "usage counters; a per-device approximation is acceptable",
  // Ordered / authoritative lists where deletion + order matter and ids aren't
  // union-safe with today's permanent tombstones.
  mediaAllPinnedOrder: "ordered list — order is the data",
  activeCooking: "ephemeral in-progress cooking session",
  groceryBaseItems: "authoritative catalog list (normalizeGroceryBaseItems re-derives)",
  groceryDailyDozenTags: "seeded map re-derived at boot",
  dailyDozenCategories: "seeded config list",
  financeAccountLabels: "finance selection list (authoritative, deletions matter; boot-empty guarded)",
  financeAccountSubLabels: "finance selection map (authoritative; boot-empty guarded)",
  financeCashAccountIds: "finance account selection (authoritative; boot-empty guarded)",
  financeEmergencyAccountIds: "finance account selection (authoritative; boot-empty guarded)",
  financeRetirementAccountIds: "finance account selection (authoritative; boot-empty guarded)",
  // KNOWN GAPS — newer-wins today because union needs delete tracking that
  // doesn't exist yet. Tracked follow-ups; remove from here when fixed.
  nextStopItems: "FOLLOW-UP: needs recordDeletion('nextStopItems') on remove/purchase in groceries-ui.js before unionById",
  radioFavorites: "FOLLOW-UP: stable station ids + permanent tombstones would block re-favouriting; needs timestamped tombstones",
  radioFollowedPrograms: "FOLLOW-UP: same as radioFavorites",
  musicLibrary: "FOLLOW-UP: {favorites, playlists}; un-favourite needs tombstones in music-library model",
  aiNotes: "FOLLOW-UP: lists are cleared wholesale by the AI tool; union would resurrect cleared notes",
};

describe("mergeStates covers every synced key (INF-5)", () => {
  const keys = stateSectionKeys();
  const body = mergeStatesBody();
  // The per-section setting-stamp maps are merged by mergeTrackedSettings()
  // (settings-sync.js), which mergeStates must call.
  const stampKeys = new Set(Object.values(SETTING_STAMP_KEYS));
  const hasRule = (k) => body.includes(`"${k}"`) || new RegExp(`merged\\.${k}\\s*=`).test(body)
    || (stampKeys.has(k) && body.includes("mergeTrackedSettings(merged, newer, older)"));

  it("finds the section keys and the merge body", () => {
    expect(keys.length).toBeGreaterThan(100);
    expect(body.length).toBeGreaterThan(1000);
  });

  it("every STATE_SECTIONS key has an explicit merge rule or a documented newer-wins entry", () => {
    const missing = keys.filter((k) => !hasRule(k) && !(k in MERGE_NEWER_WINS_KEYS));
    expect(missing, `Add a merge rule in mergeStates() or a documented MERGE_NEWER_WINS_KEYS entry for: ${missing.join(", ")}`).toEqual([]);
  });

  it("the allowlist doesn't carry stale entries (key removed or now merged explicitly)", () => {
    const stale = Object.keys(MERGE_NEWER_WINS_KEYS).filter((k) => !keys.includes(k) || hasRule(k));
    expect(stale).toEqual([]);
  });

  it("the INF-5 additions are wired", () => {
    for (const k of ["planHiddenSources", "mailMoveMemory", "groceryChecklist", "radioUserStations"]) {
      expect(hasRule(k), k).toBe(true);
    }
  });
});
