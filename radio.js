// Radio — a live-audio domain, provider-independent. Kept deliberately separate
// from Music: a Station is NOT a recording. The UI and the shared player talk to
// these normalized entities; provider specifics (MPR, Radio Browser, a user URL)
// stay inside the adapters (radio-provider-*.js). See RADIO.md.
//
//   Station  — a service/brand a listener picks ("YourClassical MPR"). Has one
//              or more Stream candidates (aac/mp3, quality/fallback).
//   Stream   — an actual playable live endpoint (url + codec/bitrate).
//   Program  — a recurring show (may air on multiple stations/providers).
//   Schedule — a program on a station at a time (structured, for future Calendar).
//   Episode  — an on-demand instance (bridges to the existing podcast system).
//
// Only Station/Stream carry reliable data in v1; Program/Schedule/Episode are
// first-class types with provider capabilities, mostly deferred (RADIO.md §data).

let _n = 0;
export function uid(p = "r") { _n += 1; return `${p}_${Date.now().toString(36)}${_n.toString(36)}${Math.random().toString(36).slice(2, 6)}`; }
const str = (v, d = "") => (v == null ? d : String(v));
const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const numOrNull = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Provider capabilities — a provider advertises the subset it supports.
export const RADIO_CAP = Object.freeze({
  LIST: "list",           // enumerate a fixed set of stations (curated catalog)
  SEARCH: "search",       // search stations by text
  BY_TAG: "byTag",
  BY_COUNTRY: "byCountry",
  NOW_PLAYING: "nowPlaying",
  SCHEDULE: "schedule",
  PROGRAMS: "programs",
});

// ── entities ──────────────────────────────────────────────────────────────────
const FORMAT_OF = (mime, url) => {
  const s = `${mime || ""} ${url || ""}`.toLowerCase();
  if (/aac|m4a|mp4/.test(s)) return "aac";
  if (/mpeg|mp3/.test(s)) return "mp3";
  if (/ogg|opus/.test(s)) return "ogg";
  if (/m3u8|hls/.test(s)) return "hls";
  return null;
};
export function makeRadioStream(p = {}) {
  const url = str(p.url);
  const format = str(p.format) || FORMAT_OF(p.mimeType, url);
  return {
    url,
    format,                                   // "aac" | "mp3" | "ogg" | "hls"
    mimeType: str(p.mimeType) || (format === "aac" ? "audio/aac" : format === "mp3" ? "audio/mpeg" : format === "ogg" ? "audio/ogg" : null),
    bitrateKbps: numOrNull(p.bitrateKbps),
    label: str(p.label) || null,              // "AAC 128k", "MP3 fallback"
    isHttps: /^https:/i.test(url),
  };
}
export function makeRadioProviderRef(p = {}) { return { provider: str(p.provider), externalId: str(p.externalId), url: str(p.url) || null }; }

export function makeStation(p = {}) {
  const providerId = str(p.providerId) || (p.providerRefs && p.providerRefs[0] && p.providerRefs[0].provider) || "";
  return {
    entity: "station",
    id: str(p.id) || (providerId ? `${providerId}:${str(p.slug) || uid("st")}` : uid("station")),
    providerId,
    name: str(p.name) || "Station",
    shortName: str(p.shortName) || null,
    description: str(p.description) || null,
    category: str(p.category) || null,        // "News" | "Music" | "Classical" | …
    programGroup: str(p.programGroup) || null, // e.g. "YourClassical" for its specialty streams
    tags: arr(p.tags).map(String),
    streams: arr(p.streams).map(makeRadioStream).filter((s) => s.url),
    homepage: str(p.homepage) || null,
    logoUrl: str(p.logoUrl) || null,
    location: p.location || null,             // { country, geo? } — for future location discovery
    providerRefs: arr(p.providerRefs).map(makeRadioProviderRef),
    userAdded: !!p.userAdded,                 // user-created stations coexist with provider ones
    metadataAt: p.metadataAt || null,         // freshness of provider-derived metadata
  };
}

export function makeProgram(p = {}) {
  return {
    entity: "program",
    id: str(p.id) || uid("prog"),
    providerId: str(p.providerId) || null,
    name: str(p.name) || "Program",
    host: str(p.host) || null,
    description: str(p.description) || null,
    stationIds: arr(p.stationIds).map(String),  // a program may air on several stations
    feedUrl: str(p.feedUrl) || null,            // bridge to an existing podcast feed (on-demand)
    providerRefs: arr(p.providerRefs).map(makeRadioProviderRef),
  };
}
export function makeScheduleEntry(p = {}) {
  return {
    entity: "scheduleEntry",
    id: str(p.id) || uid("sch"),
    stationId: str(p.stationId) || null,
    programId: str(p.programId) || null,
    programName: str(p.programName) || null,
    start: p.start || null,                     // ISO
    end: p.end || null,
    providerId: str(p.providerId) || null,
    metadataAt: p.metadataAt || null,
  };
}

// ── stream selection + robustness ─────────────────────────────────────────────
// Ordered playable candidates for a station: HTTPS first (an HTTPS PWA can't
// play http streams — mixed content), then by preferred format, then bitrate.
// The player walks this list on failure (radio-provider-agnostic fallback).
export function streamCandidates(station, opts = {}) {
  const preferHttps = opts.preferHttps !== false;
  const order = opts.preferFormats || ["mp3", "aac", "ogg", "hls"];
  const rank = (s) => (preferHttps && !s.isHttps ? 100 : 0) + (order.indexOf(s.format) < 0 ? 20 : order.indexOf(s.format));
  return (station.streams || []).slice().sort((a, b) => rank(a) - rank(b) || (b.bitrateKbps || 0) - (a.bitrateKbps || 0));
}
export function pickStream(station, opts = {}) { return streamCandidates(station, opts)[0] || null; }

// ── provider registry (aggregated, isolated) ──────────────────────────────────
export function createRadioRegistry(providers = []) {
  const list = providers.filter(Boolean);
  const byId = new Map(list.map((p) => [p.id, p]));
  const has = (p, cap) => !!(p && p.capabilities && (p.capabilities.has ? p.capabilities.has(cap) : arr(p.capabilities).includes(cap)));
  return {
    all: () => list.slice(),
    get: (id) => byId.get(id) || null,
    withCapability: (cap) => list.filter((p) => has(p, cap)),
    /** Curated stations from every LIST-capable provider (isolated failures). */
    async listStations() {
      const out = [];
      await Promise.all(list.filter((p) => has(p, RADIO_CAP.LIST)).map(async (p) => {
        try { out.push(...arr(await p.listStations())); } catch { /* provider isolated */ }
      }));
      return out.map(makeStation);
    },
    /** Search across SEARCH-capable providers; returns { stations, providerStatuses }. */
    async search(query, opts = {}) {
      const q = str(query).trim();
      const targets = list.filter((p) => has(p, RADIO_CAP.SEARCH));
      if (!q) return { stations: [], providerStatuses: [] };
      const settled = await Promise.allSettled(targets.map(async (p) => ({ provider: p.id, stations: arr(await p.search(q, opts)) })));
      const stations = []; const providerStatuses = [];
      settled.forEach((r, i) => {
        if (r.status === "fulfilled") { stations.push(...r.value.stations); providerStatuses.push({ provider: targets[i].id, ok: true, count: r.value.stations.length }); }
        else providerStatuses.push({ provider: targets[i].id, ok: false, error: String(r.reason && r.reason.message || r.reason) });
      });
      return { stations: stations.map(makeStation), providerStatuses };
    },
    /** Best-effort now-playing (only if a provider supports it); null otherwise. */
    async nowPlaying(station) {
      const p = byId.get(station && station.providerId);
      if (!p || !has(p, RADIO_CAP.NOW_PLAYING) || typeof p.nowPlaying !== "function") return null;
      try { return await p.nowPlaying(station); } catch { return null; }
    },
  };
}
