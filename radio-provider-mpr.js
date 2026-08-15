// Minnesota Public Radio (APMG) provider. MPR is a PROVIDER, not part of the
// core Radio architecture — this file is the only place that knows MPR's stream
// hosts. It's a CURATED CATALOG (not a live API): the station list is bundled
// data, so the Radio tab, stations and favourites work fully offline; only live
// playback needs the network.
//
// Streams use APMG's stable CDN (`*.stream.publicradio.org`). Each station
// carries multiple candidates (AAC primary, MP3 fallback where published) so the
// player can fall back across formats. Stream URLs are official/publicly-intended
// endpoints — NO webpage scraping.
//
// now-playing / schedule are declared capabilities but NOT implemented in v1:
// browsers can't read ICY metadata without a proxy (avoided) and there's no
// reliable public schedule API without scraping (forbidden). They degrade to
// null; a station stays playable regardless. See RADIO.md for the data-source
// limitations. Adding/removing a stream is a one-line edit to the tables below.

import { RADIO_CAP } from "./radio.js";

const CDN = "stream.publicradio.org";
// slug → { host file } ; url = https://{host}.stream.publicradio.org/{file}
const S = (host, file, format, label, bitrateKbps) => ({ url: `https://${host}.${CDN}/${file}`, format, label, bitrateKbps });
const aac = (host, file, kb = 128) => S(host, `${file}.aac`, "aac", `AAC ${kb}k`, kb);
const mp3 = (host, file, kb = 128) => S(host, `${file}.mp3`, "mp3", `MP3 ${kb}k`, kb);

// ── major services ────────────────────────────────────────────────────────────
const MAJOR = [
  { slug: "mprnews", name: "MPR News", shortName: "News", category: "News", description: "News and information from Minnesota Public Radio.", streams: [aac("nis", "nis"), mp3("nis", "nis")] },
  { slug: "the-current", name: "The Current", shortName: "The Current", category: "Music", description: "New, local and influential music from The Current.", streams: [aac("current", "current"), mp3("current", "current")] },
  { slug: "yourclassical", name: "YourClassical MPR", shortName: "YourClassical", category: "Classical", programGroup: "YourClassical", description: "Classical music all day from YourClassical MPR.", streams: [aac("cms", "cms"), mp3("cms", "cms")] },
  { slug: "radio-heartland", name: "Radio Heartland", shortName: "Heartland", category: "Music", description: "Acoustic, Americana and roots music.", streams: [aac("rh", "rh"), mp3("rh", "rh")] },
  { slug: "carbon-sound", name: "Carbon Sound", shortName: "Carbon", category: "Music", description: "Amplifying BIPOC artists and culture.", streams: [mp3("carbon", "carbon")] }, // best-effort host; degrades if unavailable
];

// ── YourClassical specialty streams (AAC, official CDN) ───────────────────────
const YC = [
  { slug: "yc-relax", name: "YourClassical Relax", shortName: "Relax", host: "relax", file: "relax", description: "Calm, soothing classical." },
  { slug: "yc-peaceful-piano", name: "YourClassical Peaceful Piano", shortName: "Peaceful Piano", host: "peacefulpiano", file: "peacefulpiano", description: "Solo piano to focus and unwind." },
  { slug: "yc-choral", name: "YourClassical Choral Stream", shortName: "Choral", host: "choral", file: "choral", description: "Choral and vocal works." },
  { slug: "yc-chamber", name: "YourClassical Chamber Music", shortName: "Chamber", host: "chambermusic", file: "chambermusic", description: "Intimate chamber repertoire." },
  { slug: "yc-concert-band", name: "YourClassical Concert Band", shortName: "Concert Band", host: "concertband", file: "concertband", description: "Wind ensemble and band music." },
  { slug: "yc-children", name: "YourClassical Children", shortName: "Children", host: "classicalkids", file: "classicalkids", description: "Classical music for kids." },
  { slug: "yc-sleep", name: "YourClassical Sleep", shortName: "Sleep", host: "lullabies", file: "lullabies", description: "Gentle music for sleep." },
  { slug: "yc-essentials", name: "YourClassical Essentials", shortName: "Essentials", host: "favorites", file: "favorites", description: "The classical essentials." },
  { slug: "yc-guitar", name: "YourClassical Guitar", shortName: "Guitar", host: "favorites", file: "guitar", description: "Classical guitar." },
  { slug: "yc-holiday", name: "YourClassical Holiday", shortName: "Holiday", host: "holiday", file: "holiday_yc", description: "Seasonal classical music." },
];

function buildCatalog() {
  const stations = MAJOR.map((m) => station(m.slug, m));
  for (const y of YC) {
    stations.push(station(y.slug, {
      name: y.name, shortName: y.shortName, category: "Classical", programGroup: "YourClassical",
      description: y.description, streams: [{ url: `https://${y.host}.${CDN}/${y.file}.aac`, format: "aac", label: "AAC" }],
    }));
  }
  return stations;
}
function station(slug, m) {
  return {
    id: `mpr:${slug}`, providerId: "mpr", slug,
    name: m.name, shortName: m.shortName, description: m.description,
    category: m.category, programGroup: m.programGroup || null,
    streams: m.streams,
    tags: ["mpr", ...(m.programGroup ? [m.programGroup.toLowerCase()] : []), ...(m.category ? [m.category.toLowerCase()] : [])],
    homepage: "https://www.mpr.org/",
    location: { country: "US", region: "Minnesota" },
    providerRefs: [{ provider: "mpr", externalId: slug }],
    metadataAt: null, // curated/static — no network fetch
  };
}

export function createMprProvider() {
  const catalog = buildCatalog();
  return {
    id: "mpr",
    label: "Minnesota Public Radio",
    capabilities: new Set([RADIO_CAP.LIST, RADIO_CAP.SEARCH, RADIO_CAP.NOW_PLAYING, RADIO_CAP.SCHEDULE]),

    async isAvailable() { return true; },       // catalog is bundled → always available (offline too)
    async listStations() { return catalog.slice(); },
    async getStation(id) { return catalog.find((s) => s.id === id || s.providerRefs[0].externalId === id) || null; },
    async search(query) {
      const q = String(query || "").toLowerCase().trim();
      if (!q) return [];
      return catalog.filter((s) => `${s.name} ${s.description} ${s.category} ${s.programGroup || ""} ${s.tags.join(" ")}`.toLowerCase().includes(q));
    },
    // Deferred — no browser-reachable metadata/schedule source without scraping.
    async nowPlaying() { return null; },
    async schedule() { return []; },
  };
}
