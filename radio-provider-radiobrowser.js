// Radio Browser provider — the general internet-radio discovery source
// (radio-browser.info): free, no key, CORS-enabled, community directory. This is
// the second provider, present to prove the Radio architecture is provider-
// independent; the v1 UI uses it only for on-demand search (it does NOT dump a
// giant global directory into the Radio home). Injectable fetch for tests.
//
//   search: {base}/json/stations/search?name=…&hidebroken=true&order=votes
//   by tag: {base}/json/stations/bytag/{tag}
//
// Maps Radio Browser's `url_resolved` (+ codec/bitrate) into normalized Station/
// Stream. Failures are isolated by the registry.

import { RADIO_CAP } from "./radio.js";

const DEFAULT_BASE = "https://de1.api.radio-browser.info";

async function defaultFetchJson(url, { signal } = {}) {
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`radio-browser HTTP ${r.status}`);
  return r.json();
}

function toStation(s) {
  const url = s.url_resolved || s.url || "";
  const codec = String(s.codec || "").toLowerCase();
  const format = /aac/.test(codec) ? "aac" : /mp3|mpeg/.test(codec) ? "mp3" : /ogg|vorbis|opus/.test(codec) ? "ogg" : /hls/.test(codec) ? "hls" : null;
  return {
    id: `radiobrowser:${s.stationuuid}`,
    providerId: "radiobrowser",
    slug: s.stationuuid,
    name: s.name || "Station",
    description: [s.country, s.language].filter(Boolean).join(" · ") || null,
    category: (s.tags || "").split(",")[0] || null,
    tags: String(s.tags || "").split(",").map((t) => t.trim()).filter(Boolean),
    streams: url ? [{ url, format, mimeType: format === "aac" ? "audio/aac" : format === "mp3" ? "audio/mpeg" : null, bitrateKbps: Number(s.bitrate) || null, label: (codec || "stream").toUpperCase() }] : [],
    homepage: s.homepage || null,
    logoUrl: s.favicon || null,
    location: { country: s.countrycode || s.country || null },
    providerRefs: [{ provider: "radiobrowser", externalId: s.stationuuid }],
    metadataAt: new Date().toISOString(),
  };
}

export function createRadioBrowserProvider(config = {}, deps = {}) {
  const base = String(config.base || DEFAULT_BASE).replace(/\/+$/, "");
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const q = (params) => new URLSearchParams({ hidebroken: "true", limit: "40", order: "votes", reverse: "true", ...params }).toString();

  return {
    id: "radiobrowser",
    label: "Radio Browser",
    capabilities: new Set([RADIO_CAP.SEARCH, RADIO_CAP.BY_TAG, RADIO_CAP.BY_COUNTRY]),

    async isAvailable() { return true; }, // failures surface per-request via the registry

    async search(query, o = {}) {
      const data = await fetchJson(`${base}/json/stations/search?${q({ name: String(query), limit: String(o.limit || 25) })}`, { signal: o.signal });
      return (Array.isArray(data) ? data : []).map(toStation).filter((s) => s.streams.length);
    },
    async byTag(tag, o = {}) {
      const data = await fetchJson(`${base}/json/stations/bytag/${encodeURIComponent(String(tag))}?${q({ limit: String(o.limit || 25) })}`, { signal: o.signal });
      return (Array.isArray(data) ? data : []).map(toStation).filter((s) => s.streams.length);
    },
    async byCountry(code, o = {}) {
      const data = await fetchJson(`${base}/json/stations/bycountrycodeexact/${encodeURIComponent(String(code))}?${q({ limit: String(o.limit || 25) })}`, { signal: o.signal });
      return (Array.isArray(data) ? data : []).map(toStation).filter((s) => s.streams.length);
    },
  };
}
