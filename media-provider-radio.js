// Radio media provider — folds the EXISTING radio search (the radio registry's
// aggregated station search) into universal search, so Discover finds live
// stations too. It does NOT re-implement radio playback: results carry the
// original station on `source`, and the app's Play bridge hands it to
// playRadioStation (the proven engine). Native (in-app) playback is the
// capability; the search fn is injected → pure and unit-testable. DOM-free.

import { makeMediaItem, MEDIA_KIND } from "./media-model.js";
import { MEDIA_CAP } from "./media-provider.js";

const str = (v, d = "") => (v == null ? d : String(v));

// A station → canonical RADIO item. `source` keeps the whole station so the play
// bridge can hand it straight to playRadioStation.
function mapStation(st) {
  if (!st || !st.id) return null;
  const subtitle = str(st.subtitle) || [st.genre, st.country].filter(Boolean).map(String).join(" · ") || "Live radio";
  return makeMediaItem({
    kind: MEDIA_KIND.RADIO,
    id: `rad_${st.id}`,
    title: str(st.name) || str(st.title) || "Station",
    subtitle,
    artworkUrl: str(st.logoUrl) || str(st.favicon) || str(st.art),
    providerRefs: [{ providerId: "radio", externalId: str(st.id) }],
    meta: { live: true },
    source: st,
    userState: { progress: { kind: "live" } }, // live → never a Continue candidate
  });
}

/**
 * @param config { search?: (query, opts) => Promise<station[]> }
 *   — inject the radio registry's aggregated search (its `.stations`).
 */
export function createRadioMediaProvider(config = {}) {
  const search = typeof config.search === "function" ? config.search : null;
  return {
    id: "radio",
    label: config.label || "Radio",
    kind: "radio",
    capabilities: new Set([MEDIA_CAP.SEARCH, MEDIA_CAP.METADATA, MEDIA_CAP.ARTWORK, MEDIA_CAP.NATIVE_PLAYBACK, MEDIA_CAP.LIVE]),
    configured: !!search,
    async isAvailable() { return !!search; },
    async search(query, opts = {}) {
      const q = str(query).trim();
      if (!q || !search) return [];
      const stations = await search(q, opts);
      return (Array.isArray(stations) ? stations : []).map(mapStation).filter(Boolean);
    },
  };
}
