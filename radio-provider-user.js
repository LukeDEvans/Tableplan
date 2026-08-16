// User-added stations provider — a station a user pastes in (any stream URL)
// coexists with provider stations behind the SAME normalized contract, so the
// UI, playback, favourites and history treat it identically. No external data
// source; reads live from an injected store (state.radioUserStations), so adding
// one needs no registry rebuild. This is the "user-created station" extension
// point the Radio domain reserved (radio.js makeStation.userAdded).

import { RADIO_CAP } from "./radio.js";

export function createUserRadioProvider(deps = {}) {
  const getStations = typeof deps.getStations === "function" ? deps.getStations : () => [];
  const toStation = (u) => ({
    id: u.id,
    providerId: "user",
    slug: u.id,
    name: u.name || "My station",
    description: u.description || null,
    category: u.category || "My stations",
    tags: ["user", ...(u.category ? [String(u.category).toLowerCase()] : [])],
    streams: u.streamUrl ? [{ url: u.streamUrl }] : [],
    homepage: u.homepage || null,
    userAdded: true,
    providerRefs: [{ provider: "user", externalId: u.id }],
  });
  return {
    id: "user",
    label: "My stations",
    capabilities: new Set([RADIO_CAP.LIST, RADIO_CAP.SEARCH]),
    async isAvailable() { return true; },
    async listStations() { return (getStations() || []).map(toStation); },
    async search(query) {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return [];
      return (getStations() || []).map(toStation).filter((s) => `${s.name} ${s.category} ${s.tags.join(" ")}`.toLowerCase().includes(q));
    },
  };
}
