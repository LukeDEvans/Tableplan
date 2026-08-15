// Jellyfin music source — the second MusicSource behind the same contract the
// local source implements (music-library.js), so the provider, queue, panel and
// now-playing bar treat its tracks exactly like local ones. This is the
// "server" half of the hybrid design; adding it changes nothing downstream.
//
// Reachability is an infrastructure concern, not this module's: it talks to a
// configured Jellyfin base URL over HTTPS and reports isAvailable()=false when
// unconfigured or unreachable, so the library silently falls back to local.
//
//   createJellyfinSource({ url, apiKey, userId }, { fetchJson? })
//
// The HTTP client is injectable so this is unit-testable without a live server.

import { makeTrack } from "./music-library.js";

const numOrNull = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const trimSlash = (s) => String(s || "").replace(/\/+$/, "");

async function defaultFetchJson(u) {
  const r = await fetch(u, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`jellyfin HTTP ${r.status}`);
  return r.json();
}

export function createJellyfinSource(config = {}, deps = {}) {
  const url = trimSlash(config.url);
  const apiKey = String(config.apiKey || "");
  const userId = String(config.userId || "");
  const fetchJson = deps.fetchJson || defaultFetchJson;
  const configured = !!(url && apiKey);
  const key = () => `api_key=${encodeURIComponent(apiKey)}`;

  // Jellyfin RunTimeTicks are 100-ns units → ms.
  const ticksToMs = (t) => (t ? Math.round(Number(t) / 10000) : null);

  function mapItem(it) {
    const artist = it.AlbumArtist || (Array.isArray(it.Artists) ? it.Artists.join(", ") : "") || "";
    const hasPrimary = it.ImageTags && it.ImageTags.Primary;
    return makeTrack({
      id: `jf_${it.Id}`,
      sourceId: "jellyfin",
      title: it.Name || "Untitled",
      artist,
      album: it.Album || "",
      trackNo: numOrNull(it.IndexNumber),
      durationMs: ticksToMs(it.RunTimeTicks),
      // Server art is a URL, not bytes — the app uses it directly (no blob store).
      artworkRef: hasPrimary ? { kind: "url", url: `${url}/Items/${it.Id}/Images/Primary?maxWidth=240&${key()}` } : null,
      locator: { kind: "jellyfin", itemId: it.Id },
    });
  }

  return {
    id: "jellyfin",
    label: config.label || "Jellyfin",
    configured,

    async isAvailable() {
      if (!configured) return false;
      try { await fetchJson(`${url}/System/Info/Public`); return true; }
      catch { return false; }
    },

    async listTracks() {
      if (!configured) return [];
      const base = userId ? `${url}/Users/${encodeURIComponent(userId)}/Items` : `${url}/Items`;
      const q = [
        "IncludeItemTypes=Audio",
        "Recursive=true",
        "Fields=Album,AlbumArtist,Artists,RunTimeTicks,IndexNumber",
        "SortBy=AlbumArtist,Album,IndexNumber",
        "SortOrder=Ascending",
        key(),
      ].join("&");
      const data = await fetchJson(`${base}?${q}`);
      const items = (data && data.Items) || [];
      return items.map(mapItem);
    },

    // A direct, browser-playable stream URL for the <audio> element. The
    // `universal` endpoint lets Jellyfin transcode to something the browser can
    // play when the source codec isn't web-friendly.
    async resolvePlayable(track) {
      const itemId = track?.locator?.itemId;
      if (!itemId) throw new Error("jellyfin track has no itemId");
      const params = [
        userId ? `UserId=${encodeURIComponent(userId)}` : "",
        "DeviceId=live-pwa",
        "Container=mp3,aac,m4a,ogg,opus,webma,wav",
        "AudioCodec=aac",
        "MaxStreamingBitrate=320000",
        key(),
      ].filter(Boolean).join("&");
      return `${url}/Audio/${itemId}/universal?${params}`;
    },
  };
}
