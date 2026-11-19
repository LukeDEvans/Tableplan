// song-recognizer.js — "what song is this?" (UTILITIES_MENU_DESIGN.md §7).
//
// One job behind a swappable layer: listen for a few seconds and return the song.
// Only an adapter knows a vendor (the Scores providers' pattern), so ShazamKit —
// the first adapter, free, with an Android version — can be replaced by AudD or
// ACRCloud later without touching the sheet or the history.
//
// Adapter: { id, available() → bool, recognize({ timeoutSeconds }) → raw result,
//            cancel() }. Raw result: { status: "match"|"nomatch"|"error", song?, error? }.

export const HISTORY_MAX = 100;

export function normalizeSong(raw, { now = () => new Date().toISOString() } = {}) {
  const s = raw && typeof raw === "object" ? raw : {};
  const str = (v, max = 300) => String(v ?? "").trim().slice(0, max);
  const url = (v) => (/^https:\/\//i.test(String(v || "")) ? String(v).slice(0, 600) : "");
  const title = str(s.title, 200);
  const artist = str(s.artist, 200);
  const at = s.at || now();
  return {
    id: str(s.id, 80) || `song-${Date.parse(at) || Date.now()}-${(title + artist).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24)}`,
    title, artist,
    album: str(s.album, 200),
    artworkUrl: url(s.artworkUrl),
    appleMusicId: str(s.appleMusicId, 40).replace(/[^0-9]/g, ""),
    appleMusicUrl: url(s.appleMusicUrl),
    webUrl: url(s.webUrl),
    isrc: str(s.isrc, 20).replace(/[^A-Za-z0-9]/g, "").toUpperCase(),
    genres: Array.isArray(s.genres) ? s.genres.map((g) => str(g, 40)).filter(Boolean).slice(0, 5) : [],
    at,
    savedToListen: Boolean(s.savedToListen),
  };
}

const songKey = (s) => (s.isrc || s.appleMusicId || `${s.title}|${s.artist}`.toLowerCase());

// Newest first; the same song again within 10 minutes isn't a new entry.
export function addToHistory(list, song, { max = HISTORY_MAX } = {}) {
  const items = Array.isArray(list) ? list : [];
  const recent = items.find((x) => songKey(x) === songKey(song) && Math.abs(Date.parse(song.at) - Date.parse(x.at)) < 10 * 60 * 1000);
  if (recent) return items;
  return [song, ...items].slice(0, max);
}

export function createSongRecognizer({ adapters = [] } = {}) {
  const pick = () => adapters.find((a) => {
    try { return a && a.available(); } catch { return false; }
  }) || null;
  let active = null;
  return {
    available: () => Boolean(pick()),
    adapterId: () => pick()?.id || null,
    async recognize({ timeoutSeconds = 12 } = {}) {
      const adapter = pick();
      if (!adapter) return { status: "error", error: "Song recognition isn't available on this device." };
      active = adapter;
      try {
        const raw = await adapter.recognize({ timeoutSeconds });
        if (raw?.status === "match" && raw.song) return { status: "match", song: normalizeSong({ ...raw.song, at: undefined }) };
        if (raw?.status === "nomatch") return { status: "nomatch" };
        if (raw?.status === "cancelled") return { status: "cancelled" };
        return { status: "error", error: raw?.error || "Couldn't listen just now." };
      } catch (e) {
        return { status: "error", error: e?.message || "Couldn't listen just now." };
      } finally { active = null; }
    },
    cancel() { try { active?.cancel?.(); } catch { /* ignore */ } },
  };
}

// The ShazamKit adapter, over the native SongRecognizer plugin (iPhone).
export function shazamKitAdapter(plugin) {
  return {
    id: "shazamkit",
    available: () => Boolean(plugin && typeof plugin.recognize === "function"),
    recognize: ({ timeoutSeconds }) => plugin.recognize({ timeoutSeconds }),
    cancel: () => plugin?.cancel?.(),
  };
}
