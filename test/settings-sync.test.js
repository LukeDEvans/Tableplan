import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SETTING_STAMP_KEYS, TRACKED_SETTINGS, settingsSnapshot, stampSettingChanges,
  mergeSettingStamps, mergeTrackedSettings, localSettingsAhead, sectionOfSettingPath,
} from "../settings-sync.js";

const T1 = "2026-10-06T10:00:00.000Z";
const T2 = "2026-10-06T11:00:00.000Z";
const T3 = "2026-10-06T12:00:00.000Z";

// What mergeStates() does today for a newer-wins key: `{ ...newer }`.
const baseMerge = (newer, older) => ({ ...newer });
const merge = (newer, older) => mergeTrackedSettings(baseMerge(newer, older), newer, older);

describe("stampSettingChanges", () => {
  it("stamps only what changed since the baseline, per field for settings objects", () => {
    const state = { themeMode: "auto", mailAiSettings: { vegOnly: true, nytLinks: true }, podcastSkipAds: false };
    const baseline = settingsSnapshot(state);
    state.themeMode = "dark";
    state.mailAiSettings.vegOnly = false;
    const { changed } = stampSettingChanges(state, baseline, T1);
    expect(changed.sort()).toEqual(["mailAiSettings.vegOnly", "themeMode"]);
    expect(state.configSettingStamps).toEqual({ themeMode: T1, "mailAiSettings.vegOnly": T1 });
    expect(state.mediaSettingStamps).toBeUndefined();
  });

  it("stamps nothing when nothing changed, and nothing on the first (baseline-less) call", () => {
    const state = { themeMode: "dark" };
    expect(stampSettingChanges(state, settingsSnapshot(state), T1).changed).toEqual([]);
    expect(stampSettingChanges(state, null, T1).changed).toEqual([]);
    expect(state.configSettingStamps).toBeUndefined();
  });

  it("stamps a removed field and a field added later", () => {
    const state = { aiSettings: { dailyBriefingEnabled: true } };
    let baseline = settingsSnapshot(state);
    delete state.aiSettings.dailyBriefingEnabled;
    state.aiSettings.assistantFinanceRead = true;
    ({ baseline } = stampSettingChanges(state, baseline, T1));
    expect(Object.keys(state.configSettingStamps).sort()).toEqual(["aiSettings.assistantFinanceRead", "aiSettings.dailyBriefingEnabled"]);
    expect(stampSettingChanges(state, baseline, T2).changed).toEqual([]);
  });

  it("a new stamp is always later than the one it replaces (slow local clock still wins)", () => {
    const state = { themeMode: "auto", configSettingStamps: { themeMode: T3 } };
    const baseline = settingsSnapshot(state);
    state.themeMode = "dark";
    stampSettingChanges(state, baseline, T1); // this device's clock is behind
    expect(Date.parse(state.configSettingStamps.themeMode)).toBeGreaterThan(Date.parse(T3));
  });

  it("routes each stamp to the section that owns the setting", () => {
    const state = { podcastSkipAds: false, groceryPricingSettings: { enabled: false }, recreateHobbies: { piano: true } };
    const baseline = settingsSnapshot(state);
    state.podcastSkipAds = true;
    state.groceryPricingSettings = { enabled: true };
    state.recreateHobbies.piano = false;
    stampSettingChanges(state, baseline, T1);
    expect(state.mediaSettingStamps).toEqual({ podcastSkipAds: T1 });
    expect(state.grocerySettingStamps).toEqual({ "groceryPricingSettings.enabled": T1 });
    expect(state.recreateSettingStamps).toEqual({ "recreateHobbies.piano": T1 });
  });
});

describe("mergeTrackedSettings — the latest explicit choice wins", () => {
  it("THE BUG: a device with a stale setting but the newer whole-state copy no longer reverts it", () => {
    // Phone turned the setting off at T1. The laptop never saw that, but has been
    // saving other things since, so it is the `newer` side of the merge.
    const phoneRow = { podcastSkipAds: true, mediaSettingStamps: { podcastSkipAds: T1 } };
    const laptop = { podcastSkipAds: false };
    expect(baseMerge(laptop, phoneRow).podcastSkipAds).toBe(false); // old behaviour: reverted
    expect(merge(laptop, phoneRow).podcastSkipAds).toBe(true);      // now: the choice sticks
    expect(merge(laptop, phoneRow).mediaSettingStamps).toEqual({ podcastSkipAds: T1 });
  });

  it("the later stamp wins whichever side it is on", () => {
    const a = { themeMode: "dark", configSettingStamps: { themeMode: T2 } };
    const b = { themeMode: "light", configSettingStamps: { themeMode: T1 } };
    expect(merge(a, b).themeMode).toBe("dark");
    expect(merge(b, a).themeMode).toBe("dark");
    expect(merge(b, a).configSettingStamps.themeMode).toBe(T2);
  });

  it("independent fields of one settings object both survive", () => {
    const phone = { mailAiSettings: { vegOnly: false, nytLinks: true }, configSettingStamps: { "mailAiSettings.vegOnly": T1 } };
    const laptop = { mailAiSettings: { vegOnly: true, nytLinks: false }, configSettingStamps: { "mailAiSettings.nytLinks": T2 } };
    for (const m of [merge(phone, laptop), merge(laptop, phone)]) {
      expect(m.mailAiSettings).toEqual({ vegOnly: false, nytLinks: false });
    }
  });

  it("a removed field stays removed when the removal is the later choice", () => {
    const a = { aiSettings: {}, configSettingStamps: { "aiSettings.voice": T2 } };
    const b = { aiSettings: { voice: { default: { voiceId: "x" } } }, configSettingStamps: { "aiSettings.voice": T1 } };
    expect(merge(b, a).aiSettings).toEqual({});
  });

  it("can clear a string setting that 'non-empty wins' used to resurrect", () => {
    const cleared = { travelHome: "", configSettingStamps: { travelHome: T2 } };
    const old = { travelHome: "Minneapolis" };
    const m = mergeTrackedSettings({ travelHome: cleared.travelHome || old.travelHome || "" }, cleared, old);
    expect(m.travelHome).toBe("");
  });

  it("leaves the existing result alone when neither side has a stamp, or stamps are equal", () => {
    const a = { themeMode: "dark", mailAiSettings: { x: true } };
    const b = { themeMode: "light", mailAiSettings: { x: false } };
    expect(merge(a, b)).toEqual(a);
    const c = { themeMode: "dark", configSettingStamps: { themeMode: T1 } };
    const d = { themeMode: "light", configSettingStamps: { themeMode: T1 } };
    expect(merge(c, d).themeMode).toBe("dark");
  });

  it("ignores stamps for other sections' keys and untracked paths, but keeps unknown stamps", () => {
    const a = { themeMode: "dark", configSettingStamps: { somethingNew: T2 } };
    const b = { themeMode: "light", configSettingStamps: { podcastSkipAds: T3 } };
    const m = merge(a, b);
    expect(m.themeMode).toBe("dark");
    expect(m.configSettingStamps).toEqual({ somethingNew: T2, podcastSkipAds: T3 });
  });

  it("does nothing for a fragment that carries no stamp map (another section's merge)", () => {
    const a = { doTasks: [] };
    expect(merge(a, { doTasks: [1] })).toEqual({ doTasks: [] });
  });

  it("never mutates its inputs", () => {
    const newer = { mailAiSettings: { a: 1 }, configSettingStamps: { "mailAiSettings.a": T1 } };
    const older = { mailAiSettings: { a: 2 }, configSettingStamps: { "mailAiSettings.a": T2 } };
    const nCopy = JSON.stringify(newer), oCopy = JSON.stringify(older);
    expect(merge(newer, older).mailAiSettings).toEqual({ a: 2 });
    expect(JSON.stringify(newer)).toBe(nCopy);
    expect(JSON.stringify(older)).toBe(oCopy);
  });

  it("is convergent: both devices end on the same values and stamps", () => {
    const a = { themeMode: "dark", podcastSkipAds: true, configSettingStamps: { themeMode: T1 }, mediaSettingStamps: { podcastSkipAds: T3 } };
    const b = { themeMode: "light", podcastSkipAds: false, configSettingStamps: { themeMode: T2 }, mediaSettingStamps: {} };
    const ab = merge(a, b), ba = merge(b, a);
    for (const k of ["themeMode", "podcastSkipAds", "configSettingStamps", "mediaSettingStamps"]) expect(ab[k]).toEqual(ba[k]);
    expect(ab.themeMode).toBe("light");
    expect(ab.podcastSkipAds).toBe(true);
  });
});

describe("mergeSettingStamps / localSettingsAhead", () => {
  it("unions stamps keeping the later one and dropping garbage", () => {
    expect(mergeSettingStamps({ a: T1, b: "nope" }, { a: T2, c: T1 })).toEqual({ a: T2, c: T1 });
    expect(mergeSettingStamps(null, undefined)).toEqual({});
  });

  it("flags a section whose server copy is behind a more recent local choice", () => {
    const local = { themeMode: "dark", configSettingStamps: { themeMode: T2 } };
    expect(localSettingsAhead("config", local, { themeMode: "light", configSettingStamps: { themeMode: T1 } })).toBe(true);
    expect(localSettingsAhead("config", local, { themeMode: "light" })).toBe(true);           // a stale client dropped the stamps
    expect(localSettingsAhead("config", local, { themeMode: "dark" })).toBe(false);           // same value — nothing to upload
    expect(localSettingsAhead("config", local, { themeMode: "light", configSettingStamps: { themeMode: T3 } })).toBe(false);
    expect(localSettingsAhead("do", local, {})).toBe(false);
  });
});

// ── Wiring guards: the module only helps if app.js actually uses it ───────────
describe("settings stamps are wired into app.js", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const src = readFileSync(root + "app.js", "utf8");
  const sections = (() => {
    const body = src.match(/const STATE_SECTIONS = \{([\s\S]*?)\n\};/)[1].replace(/\/\/.*$/gm, "");
    const out = {};
    for (const m of body.matchAll(/^\s*([a-z]+):\s*\[([^\]]*)\]/gm)) out[m[1]] = [...m[2].matchAll(/"([A-Za-z0-9_]+)"/g)].map((x) => x[1]);
    return out;
  })();
  const fnBody = (name) => {
    const start = src.indexOf(`function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    return src.slice(start, src.indexOf("\n}\n", start));
  };

  it("every tracked setting and its stamp map live in the section they are declared under", () => {
    for (const [section, keys] of Object.entries(TRACKED_SETTINGS)) {
      expect(sections[section], section).toContain(SETTING_STAMP_KEYS[section]);
      for (const key of Object.keys(keys)) expect(sections[section], `${section}.${key}`).toContain(key);
    }
    for (const [section, keys] of Object.entries(TRACKED_SETTINGS)) {
      for (const [key, mode] of Object.entries(keys)) {
        expect(sectionOfSettingPath(mode === "value" ? key : `${key}.x`)).toBe(section);
      }
    }
  });

  it("persist() and persistImmediately() stamp changed settings; mergeStates resolves them", () => {
    expect(fnBody("persist")).toContain("stampChangedSettings()");
    expect(fnBody("persistImmediately")).toContain("stampChangedSettings()");
    expect(fnBody("mergeStates")).toContain("mergeTrackedSettings(merged, newer, older)");
  });

  it("every cloud-merge path re-adopts the baseline (merged values are not user changes)", () => {
    for (const name of ["mergeRemoteSectionRow", "writeSectionWithMerge", "runHydrateStateFromSharedStorage", "setSectionScope"]) {
      expect(fnBody(name), name).toContain("adoptSettingsBaseline()");
    }
  });

  it("every documented scalar preference / settings object is tracked (or excluded on purpose)", () => {
    const cov = readFileSync(root + "test/architecture-state-merge-coverage.test.js", "utf8");
    const documented = [...cov.matchAll(/^\s*([A-Za-z0-9_]+):\s*"(scalar preference|settings object)[^"]*"/gm)].map((m) => m[1]);
    expect(documented.length).toBeGreaterThan(10);
    const tracked = new Set(Object.values(TRACKED_SETTINGS).flatMap((k) => Object.keys(k)));
    const untracked = documented.filter((k) => !tracked.has(k));
    expect(untracked, `Add to TRACKED_SETTINGS in settings-sync.js: ${untracked.join(", ")}`).toEqual([]);
  });
});
