// Per-setting sync stamps — "the latest explicit choice wins" for every setting.
//
// WHY: mergeStates() decides "newer" from ONE timestamp for the whole state
// (stateUpdatedAt), which any edit anywhere advances (podcast progress, a usage
// counter, a checked grocery). So a device holding a STALE copy of a setting,
// but a newer stateUpdatedAt, won the merge and silently put the old value back
// — "I changed it and it didn't stick". The same thing undid a change whose
// upload was cut off (app closed before the debounced save), the moment another
// device had saved anything at all since.
//
// HOW: every tracked setting carries its own "last changed at" stamp, stored in
// the SAME section row as the setting (so a section-fragment merge sees both
// sides' stamps, and a household/personal scope swap carries them along).
// persist() stamps whatever changed since the last baseline — call sites don't
// opt in. mergeStates() then resolves each tracked setting by its own stamp, on
// top of the existing rules: where neither side has a stamp, behaviour is
// exactly what it was before.
//
// Pure and DOM-free (ARCHITECTURE §11) — unit-tested in test/settings-sync.test.js.

// Section → the state key (in that section) holding its { path: ISO time } map.
export const SETTING_STAMP_KEYS = Object.freeze({
  config: "configSettingStamps",
  media: "mediaSettingStamps",
  grocery: "grocerySettingStamps",
  recreate: "recreateSettingStamps",
  plan: "planSettingStamps",
});

// Section → { stateKey: mode }.
//   "value"  — the whole value is one setting (scalars, and lists/objects that
//              are only ever saved as a unit).
//   "fields" — a settings object whose top-level fields are independent choices
//              (toggling Mail AI feature A on one device and B on another must
//              keep both). Each field is stamped as "<stateKey>.<field>".
// Finance scalars are deliberately absent: adding finance keys needs a
// STATE_SCHEMA_VERSION bump (server-side finance-protection trigger).
export const TRACKED_SETTINGS = Object.freeze({
  config: Object.freeze({
    themeMode: "value",
    locationSharingEnabled: "value",
    appName: "value",
    emailPrefs: "value",
    travelHome: "value",
    weatherLocations: "value",
    jellyfin: "value",
    mediaServices: "value",
    mailAiSettings: "fields",
    mailReadingPrefs: "fields", // { blockRemoteImages } — Settings → Mail Reading
    aiSettings: "fields",
    appleMusic: "fields",
    financeAlertPrefs: "fields",
    weeklyEmailSettings: "fields",
  }),
  media: Object.freeze({
    articleSortOrder: "value",
    podcastTierCount: "value",
    podcastPrioritySort: "value",
    podcastPlaylistWindow: "value",
    podcastRecentWindow: "value",
    podcastPlaylistIncludeArticles: "value",
    podcastSkipAds: "value",
    mediaQueueFallback: "value",
    libraryKey: "value",
    articleSync: "fields",
  }),
  grocery: Object.freeze({
    groceryPricingSettings: "fields",
  }),
  recreate: Object.freeze({
    recreateHobbies: "fields",
  }),
  plan: Object.freeze({
    planMealPlanCalendars: "fields", // { calendarId: on } — "Show on Meal Plan" per calendar
  }),
});

const ABSENT = "\u0000absent";
const sig = (v) => (v === undefined ? ABSENT : JSON.stringify(v));
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const stampMs = (s) => { const ms = typeof s === "string" ? Date.parse(s) : NaN; return Number.isNaN(ms) ? -1 : ms; };
const splitPath = (path) => { const i = path.indexOf("."); return i < 0 ? [path, null] : [path.slice(0, i), path.slice(i + 1)]; };

// Which section a stamped path belongs to (null when the key isn't tracked).
export function sectionOfSettingPath(path) {
  const [key, field] = splitPath(String(path || ""));
  for (const [section, keys] of Object.entries(TRACKED_SETTINGS)) {
    const mode = keys[key];
    if (mode === "value" && field === null) return section;
    if (mode === "fields" && field) return section;
  }
  return null;
}

// { path: signature } for every tracked setting currently present in `source`,
// optionally limited to one section.
export function settingsSnapshot(source, onlySection = null) {
  const snap = {};
  for (const [section, keys] of Object.entries(TRACKED_SETTINGS)) {
    if (onlySection && section !== onlySection) continue;
    for (const [key, mode] of Object.entries(keys)) {
      const value = source?.[key];
      if (mode === "value") { snap[key] = sig(value); continue; }
      if (!isPlainObject(value)) continue;
      for (const field of Object.keys(value)) snap[`${key}.${field}`] = sig(value[field]);
    }
  }
  return snap;
}

// Stamp every tracked setting whose value differs from `baseline` (the snapshot
// taken when values were last known-unchanged-by-the-user: after load, after a
// merge, after the previous persist). Mutates `state`'s stamp maps (copy-on-
// write) and returns the new baseline plus the changed paths. A stamp is always
// later than the one it replaces, so a device whose clock runs behind can still
// win with a real, newer choice.
export function stampSettingChanges(state, baseline, nowIso = new Date().toISOString()) {
  const current = settingsSnapshot(state);
  if (!baseline) return { baseline: current, changed: [] };
  const changed = [];
  for (const path of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
    if ((baseline[path] ?? ABSENT) !== (current[path] ?? ABSENT)) changed.push(path);
  }
  for (const path of changed) {
    const stampKey = SETTING_STAMP_KEYS[sectionOfSettingPath(path)];
    if (!stampKey) continue;
    const stamps = isPlainObject(state[stampKey]) ? state[stampKey] : {};
    const prevMs = stampMs(stamps[path]);
    const stamp = prevMs >= Date.parse(nowIso) ? new Date(prevMs + 1).toISOString() : nowIso;
    state[stampKey] = { ...stamps, [path]: stamp };
  }
  return { baseline: current, changed };
}

// Later-stamp-wins union of two stamp maps (unknown paths are kept, so a client
// tracking fewer settings never drops another client's stamps).
export function mergeSettingStamps(a, b) {
  const out = {};
  for (const src of [b, a]) {
    if (!isPlainObject(src)) continue;
    for (const [path, stamp] of Object.entries(src)) {
      if (stampMs(stamp) < 0) continue;
      if (!(path in out) || stampMs(stamp) > stampMs(out[path])) out[path] = stamp;
    }
  }
  return out;
}

function takeSetting(merged, side, path) {
  const [key, field] = splitPath(path);
  if (field === null) {
    if (side && key in side && side[key] !== undefined) merged[key] = side[key];
    return;
  }
  const from = side?.[key];
  if (!isPlainObject(from)) return; // that side has no such object — nothing to take
  const base = isPlainObject(merged[key]) ? { ...merged[key] } : {};
  if (field in from && from[field] !== undefined) base[field] = from[field];
  else delete base[field];
  merged[key] = base;
}

// Applied at the end of mergeStates(newer, older): `merged` already holds the
// result of the existing rules. For every tracked setting where the two sides'
// stamps differ, the side with the later stamp provides the value (a side with
// no stamp counts as never-set, so an unstamped default can't undo a real
// choice). Equal or absent stamps leave the existing result untouched. Mutates
// and returns `merged`; never mutates `newer`/`older`.
export function mergeTrackedSettings(merged, newer, older) {
  for (const [section, stampKey] of Object.entries(SETTING_STAMP_KEYS)) {
    const nStamps = isPlainObject(newer?.[stampKey]) ? newer[stampKey] : null;
    const oStamps = isPlainObject(older?.[stampKey]) ? older[stampKey] : null;
    if (!nStamps && !oStamps) continue; // not this fragment's section, or nothing stamped yet
    const stamps = mergeSettingStamps(nStamps, oStamps);
    for (const path of Object.keys(stamps)) {
      if (sectionOfSettingPath(path) !== section) continue;
      const nMs = stampMs(nStamps?.[path]);
      const oMs = stampMs(oStamps?.[path]);
      if (oMs > nMs) takeSetting(merged, older, path);
      else if (nMs > oMs) takeSetting(merged, newer, path);
    }
    merged[stampKey] = stamps;
  }
  return merged;
}

// True when `local` holds a tracked setting in `section` that was changed more
// recently than `remote`'s copy AND differs from it — i.e. the server row is
// behind and this section must be uploaded even if nothing else is unsaved.
export function localSettingsAhead(section, local, remote) {
  const stampKey = SETTING_STAMP_KEYS[section];
  if (!stampKey) return false;
  const lStamps = isPlainObject(local?.[stampKey]) ? local[stampKey] : {};
  const rStamps = isPlainObject(remote?.[stampKey]) ? remote[stampKey] : {};
  const lSnap = settingsSnapshot(local, section);
  const rSnap = settingsSnapshot(remote, section);
  for (const [path, stamp] of Object.entries(lStamps)) {
    if (sectionOfSettingPath(path) !== section) continue;
    if (stampMs(stamp) <= stampMs(rStamps[path])) continue;
    if ((lSnap[path] ?? ABSENT) !== (rSnap[path] ?? ABSENT)) return true;
  }
  return false;
}
