// Jamendo provider — contemporary independent, Creative Commons music. Secondary
// and optional: the core Music architecture never depends on it. Jamendo's v3.0
// API requires a registered client_id on every request, so without one this
// adapter reports unavailable and contributes nothing (same graceful-scaffold
// pattern as the Jellyfin source). Register at https://developer.jamendo.com and
// put the client_id in state to light it up.
//
//   search: https://api.jamendo.com/v3.0/tracks/?client_id=…&search=…&format=json
//
// Jamendo is track-oriented (each result is directly playable), so its search
// returns CanonicalTrack items rather than expandable albums — the UI plays them
// straight, no getItem step.

import { CAP, makeCanonicalTrack, makeProviderRef, makeLicense } from "./music-streaming.js";

const BASE = "https://api.jamendo.com/v3.0";

async function defaultFetchJson(url, { signal } = {}) {
  const r = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`jamendo HTTP ${r.status}`);
  return r.json();
}

export function createJamendoProvider(config = {}, deps = {}) {
  const clientId = String(config.clientId || "");
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const configured = !!clientId;

  function trackToCanonical(t) {
    return makeCanonicalTrack({
      id: `jamendo:${t.id}`,
      title: t.name || "Untitled",
      artists: t.artist_name ? [{ name: t.artist_name, role: "artist" }] : [],
      album: t.album_name || null,
      durationMs: t.duration ? Math.round(Number(t.duration) * 1000) : null,
      artworkUrl: t.album_image || t.image || null,
      provider: "jamendo",
      providerRefs: [makeProviderRef({ provider: "jamendo", externalId: String(t.id), url: t.shareurl || null })],
      license: makeLicense({ url: t.license_ccurl || null, type: "cc" }),
      playable: t.audio ? { provider: "jamendo", url: t.audio, container: "mp3", mimeType: "audio/mpeg", streamable: true } : null,
    });
  }

  return {
    id: "jamendo",
    label: "Jamendo",
    configured,
    capabilities: new Set([CAP.SEARCH, CAP.PLAYABLE, CAP.ARTWORK, CAP.LICENSE, CAP.PAGINATION]),

    async isAvailable() { return configured; },

    async search(query, o = {}) {
      if (!configured) return [];
      const params = new URLSearchParams({
        client_id: clientId,
        format: "json",
        search: String(query),
        limit: String(Math.max(1, Math.min(200, o.limit || 25))),
        offset: String(((o.page || 1) - 1) * (o.limit || 25)),
        audioformat: "mp32",
        include: "musicinfo",
      });
      const data = await fetchJson(`${BASE}/tracks/?${params.toString()}`, { signal: o.signal });
      return ((data && data.results) || []).map(trackToCanonical);
    },

    async getPlayable(track) {
      if (track && track.playable && track.playable.url) return track.playable;
      throw new Error("jamendo track has no playable source");
    },
  };
}
