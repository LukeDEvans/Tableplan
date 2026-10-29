// "Music show" newsletters → Listen notifications (AMPLIFIER_DESIGN.md).
//
// NYT's The Amplifier is a playlist newsletter: an intro, then one short
// write-up per song, each with its own "Listen on Apple Music" link. Instead of
// the generic newsletter → article conversion, the inbox sweep parses it here
// (no AI: the layout is regular) into a show — the intro, then each song's
// write-up and its Apple Music catalog id — and saves it as a saved article
// carrying a `musicShow` record. The app lists it under the Listen bell and plays
// it as: intro → song 1's write-up → song 1 → song 2's write-up → song 2 → …
//
// Each song's Apple Music link is an NYT click-tracking redirect; it's followed
// (hosts allowlisted, a few hops, short timeouts) to the music.apple.com page,
// whose URL carries the song's id. A link that can't be resolved leaves the id
// empty and the app looks the song up by artist and title when it plays.
// Files prefixed with _ are not deployed as individual functions.

// One entry per supported newsletter. `key` is the Mail → Automation toggle in
// state.mailAiSettings (on by default: only an explicit false turns it off).
const MUSIC_SHOW_SOURCES = [
  {
    key: "amplifierToListen",
    name: "The Amplifier (NYT)",
    senderRe: /nytimes\.com/i,
    subjectRe: /^the amplifier\b/i,
    publication: "The Amplifier · NYT",
  },
];

function musicShowSourceFor(from, subject, mailAiSettings) {
  return MUSIC_SHOW_SOURCES.find((s) =>
    mailAiSettings?.[s.key] !== false && s.senderRe.test(from || "") && s.subjectRe.test(String(subject || "").trim())
  ) || null;
}

// ── HTML → text ──────────────────────────────────────────────────────────────

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…",
  eacute: "é", egrave: "è", aacute: "á", oacute: "ó", iacute: "í", uacute: "ú", ntilde: "ñ", uuml: "ü", ouml: "ö", auml: "ä",
};
function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp < 0x110000 ? String.fromCodePoint(cp) : m;
    }
    const v = NAMED_ENTITIES[e.toLowerCase()];
    return v == null ? m : v;
  });
}
function textOf(html) {
  return decodeEntities(String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    // Inline tags join their neighbours ("<span>edge </span><i>musically</i>?");
    // anything else separates words.
    .replace(/<\/?(span|a|b|i|em|strong|u|font|sup|sub)\b[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Every <h1>/<h2>/<h3>/<p> in document order. Newsletter markup is flat (no
// nested <p>), so a non-greedy match per element is enough.
function blocksOf(html) {
  const body = String(html || "")
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const out = [];
  const re = /<(h1|h2|h3|p)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) out.push({ tag: m[1].toLowerCase(), html: m[2], text: textOf(m[2]), at: m.index });
  return { body, blocks: out };
}

// Links in a block: [{ text, href }].
function linksOf(html) {
  const out = [];
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || "")))) out.push({ href: decodeEntities(m[1]), text: textOf(m[2]) });
  return out;
}

// "1. Violent Femmes: “Blister in the Sun”" → { n, artist, title }.
const SONG_HEADING_RE = /^(\d{1,2})\.\s*(.+?):\s*[“"‘'](.+?)[”"’']\s*$/;
function parseSongHeading(text) {
  const m = SONG_HEADING_RE.exec(String(text || "").trim());
  if (!m) return null;
  return { n: Number(m[1]), artist: m[2].trim(), title: m[3].trim() };
}

// The hero photo: the first NYT news image (not the header, play button, rules,
// footer or the author's headshot).
function heroImageOf(body) {
  const re = /<img\b[^>]*src=["'](https:\/\/static01\.nyt\.com\/images\/[^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(body))) {
    const src = m[1];
    if (/Amplifier-Play|Newsletters?-|Footer|Thumb|headshot|email-images/i.test(src)) continue;
    return src;
  }
  return "";
}

const LISTEN_LINE_RE = /^(▶\s*)?listen on\b/i;
const PLAYLIST_END_RE = /amplifier playlist|track list/i;

// The newsletter → { title, author, durationText, image, intro: [para], songs }.
// Returns null when it doesn't look like a playlist issue (fewer than 2 songs),
// so the caller falls back to the ordinary newsletter conversion.
function parseMusicShow(html) {
  const { body, blocks } = blocksOf(html);
  const h1 = blocks.find((b) => b.tag === "h1");
  const title = h1 ? h1.text : "";
  const start = h1 ? blocks.indexOf(h1) + 1 : 0;

  let author = "";
  let durationText = "";
  const intro = [];
  const songs = [];
  let phase = "head"; // head → intro → songs → done
  let song = null;

  for (let i = start; i < blocks.length && phase !== "done"; i++) {
    const b = blocks[i];
    if (!b.text) continue;
    if ((b.tag === "h2" || b.tag === "h3") && PLAYLIST_END_RE.test(b.text)) { phase = "done"; break; }

    const heading = b.tag === "h3" ? parseSongHeading(b.text) : null;
    if (heading) {
      song = { ...heading, writeup: [], appleUrl: "", spotifyUrl: "", youtubeUrl: "" };
      songs.push(song);
      phase = "songs";
      continue;
    }

    if (phase === "head") {
      const by = /^By\s+(.+)$/i.exec(b.text);
      if (by && b.tag === "p") { author = by[1].trim(); continue; }
      const dur = /^(\d+)\s+songs?,?\s*(.*)$/i.exec(b.text);
      if (dur && b.tag === "p") { durationText = b.text.replace(/,\s*/, " · "); continue; }
      if (b.tag === "h2") { phase = "intro"; intro.push(b.text); continue; } // "Dear listeners,"
      continue;
    }

    if (phase === "intro") {
      if (b.tag === "h3") { phase = "between"; continue; } // "Listen along while you read."
      if (b.tag === "p") intro.push(b.text);
      continue;
    }

    if (phase === "between") continue; // anything between the intro and song 1

    if (phase === "songs" && song) {
      if (b.tag !== "p") continue;
      if (LISTEN_LINE_RE.test(b.text)) {
        for (const l of linksOf(b.html)) {
          if (/apple music/i.test(l.text)) song.appleUrl = l.href;
          else if (/spotify/i.test(l.text)) song.spotifyUrl = l.href;
          else if (/youtube/i.test(l.text)) song.youtubeUrl = l.href;
        }
        continue;
      }
      song.writeup.push(b.text);
    }
  }

  // Number order, no duplicates (a heading repeated in a footer, say).
  const seen = new Set();
  const ordered = songs
    .filter((s) => !seen.has(s.n) && seen.add(s.n))
    .sort((a, b) => a.n - b.n);
  if (ordered.length < 2) return null;
  return { title, author, durationText, image: heroImageOf(body), intro, songs: ordered };
}

// ── Apple Music links ────────────────────────────────────────────────────────

const APPLE_HOSTS = /^(music\.apple\.com|geo\.music\.apple\.com|itunes\.apple\.com)$/i;
// Hosts a song link may pass through on its way to Apple Music. Nothing else is
// ever fetched (the newsletter is untrusted input).
const HOP_HOSTS = /^(nl\.nytimes\.com|[a-z0-9-]+\.nytimes\.com|nytimes\.com|apple\.co|music\.apple\.com|geo\.music\.apple\.com|itunes\.apple\.com)$/i;

// A song's catalog id from an Apple Music URL: the album page's ?i=<id>, or
// /song/<slug>/<id>. null for anything else (an album or playlist link).
function appleSongIdFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!APPLE_HOSTS.test(u.hostname)) return null;
  const i = u.searchParams.get("i");
  if (i && /^\d{4,}$/.test(i)) return i;
  const song = /\/song\/(?:[^/]+\/)?(\d{4,})(?:\/|$)/.exec(u.pathname);
  return song ? song[1] : null;
}

// Follow an NYT tracking link to the Apple Music page. Manual redirects (so each
// hop's host is checked), at most `maxHops`, each with a short timeout; a 200
// page is searched for a music.apple.com URL (some trackers use a meta refresh).
// Resolves { id, url } or { id: null, url: <last url> } — never throws.
async function resolveAppleMusicLink(startUrl, { fetchImpl = fetch, maxHops = 5, timeoutMs = 5000 } = {}) {
  let url = String(startUrl || "");
  for (let hop = 0; hop <= maxHops; hop++) {
    const id = appleSongIdFromUrl(url);
    if (id) return { id, url };
    let host;
    try { host = new URL(url).hostname; } catch { return { id: null, url }; }
    if (!HOP_HOSTS.test(host)) return { id: null, url };
    let res;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      res = await fetchImpl(url, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } });
    } catch {
      clearTimeout(timer);
      return { id: null, url };
    }
    clearTimeout(timer);
    const status = res.status || 0;
    if (status >= 300 && status < 400) {
      const loc = res.headers && typeof res.headers.get === "function" ? res.headers.get("location") : null;
      if (!loc) return { id: null, url };
      try { url = new URL(loc, url).toString(); } catch { return { id: null, url }; }
      continue;
    }
    if (status >= 200 && status < 300 && !APPLE_HOSTS.test(host)) {
      let text = "";
      try { text = String(await res.text()).slice(0, 200000); } catch { return { id: null, url }; }
      const found = /https?:\/\/(?:geo\.)?music\.apple\.com\/[^"'\s<>)]+/i.exec(decodeEntities(text));
      if (!found) return { id: null, url };
      url = found[0];
      continue;
    }
    return { id: null, url };
  }
  return { id: null, url };
}

// Resolve every song's link in parallel (a dozen at most). Adds appleMusicId and
// appleMusicUrl to each song; a failure just leaves them empty.
async function resolveShowSongs(show, opts = {}) {
  const songs = (show && show.songs) || [];
  await Promise.all(songs.map(async (s) => {
    s.appleMusicId = null;
    s.appleMusicUrl = "";
    if (!s.appleUrl) return;
    const r = await resolveAppleMusicLink(s.appleUrl, opts);
    s.appleMusicId = r.id || null;
    if (r.id && r.url && APPLE_HOSTS.test(safeHost(r.url))) s.appleMusicUrl = r.url;
  }));
  return show;
}
function safeHost(u) { try { return new URL(u).hostname; } catch { return ""; } }

// ── The saved article ────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// The article record saved into the user's personal media section. `text` is
// the whole show as an ordinary article (so any client that doesn't know about
// shows still reads it); `musicShow` is what the Listen bell plays.
function musicShowArticle(show, source, { messageId, subject, date }) {
  const when = date && !isNaN(new Date(date)) ? new Date(date) : new Date();
  const songs = show.songs.map((s) => ({
    n: s.n,
    artist: s.artist,
    title: s.title,
    text: s.writeup.join("\n\n"),
    appleMusicId: s.appleMusicId || null,
    appleMusicUrl: s.appleMusicUrl || "",
  }));
  const parts = [];
  for (const p of show.intro) parts.push(`<p>${escapeHtml(p)}</p>`);
  for (const s of songs) {
    parts.push(`<h2>${escapeHtml(`${s.n}. ${s.artist}: “${s.title}”`)}</h2>`);
    for (const p of s.text.split("\n\n").filter(Boolean)) parts.push(`<p>${escapeHtml(p)}</p>`);
    if (s.appleMusicUrl) parts.push(`<p><a href="${escapeHtml(s.appleMusicUrl)}" target="_blank" rel="noopener noreferrer">Listen on Apple Music</a></p>`);
  }
  return {
    // Not news-<id>: an issue the article conversion already saved keeps its own
    // record (and read state); the show is a separate item.
    id: "show-" + messageId,
    url: null,
    title: show.title || subject || source.name,
    author: source.publication,
    date: when.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    publication: "email",
    savedAt: when.toISOString(),
    text: parts.join("\n"),
    musicShow: {
      v: 1,
      source: source.key,
      title: show.title || subject || source.name,
      author: show.author || "",
      durationText: show.durationText || "",
      image: show.image || "",
      intro: show.intro.join("\n\n"),
      songs,
    },
  };
}

module.exports = {
  MUSIC_SHOW_SOURCES,
  musicShowSourceFor,
  parseMusicShow,
  parseSongHeading,
  appleSongIdFromUrl,
  resolveAppleMusicLink,
  resolveShowSongs,
  musicShowArticle,
  decodeEntities,
  textOf,
};
