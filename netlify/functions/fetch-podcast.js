const { getUserIdFromToken } = require("./_state-sections.js");
const { safeFetch, statusForImportError } = require("./_import-fetch.js");

// RSS/Atom feeds declare a range of XML content types; allow the feed-specific
// ones on top of safeFetch's default text/markup list. (safeFetch only enforces
// the list when the server actually declares a type.)
const FEED_CONTENT_TYPES = [
  "application/rss+xml", "application/atom+xml", "application/xml",
  "text/xml", "application/xhtml+xml", "text/html", "text/plain",
  "application/octet-stream",
];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  // Require a signed-in user: this endpoint fetches an arbitrary user-supplied
  // URL server-side, so gating it to authenticated users keeps the SSRF surface
  // to the same risk model as the other import fetches (see _import-fetch.js).
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const accessToken = (event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "").trim();
  const userId = accessToken ? await getUserIdFromToken(accessToken, serviceKey) : null;
  if (!userId) return json(401, { error: "Not authenticated." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }

  const { url } = body;
  if (!url) return json(400, { error: "url required" });

  let result;
  try {
    // SSRF/resource-exhaustion protections live in safeFetch: scheme/port/host
    // allow-listing, DNS + blocked-IP checks on the initial host and every
    // redirect hop, a streamed size cap, and a total timeout.
    result = await safeFetch(url, {
      maxBytes: 5_000_000, // feeds with 50 episodes + show notes can be large
      accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      allowedContentTypes: FEED_CONTENT_TYPES,
    });
  } catch (e) {
    if (e && e.isImportFetchError) return json(statusForImportError(e), { error: e.message });
    return json(500, { error: e.message || "Failed to fetch feed" });
  }
  if (!result.ok) return json(502, { error: `Feed returned ${result.status}` });

  const parsed = parseRSS(result.body);
  if (!parsed.title) return json(422, { error: "Could not parse RSS feed — check the URL is a valid RSS/Atom feed" });
  return json(200, parsed);
};

function parseRSS(xml) {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channelXml = channelMatch ? channelMatch[1] : xml;
  const channelOnly = channelXml.replace(/<item[\s\S]*?<\/item>/gi, "");

  const title = getText(channelOnly, "title");
  const description = getText(channelOnly, "description") || getText(channelOnly, "itunes:subtitle");
  const itunesImg = getAttr(channelOnly, "itunes:image", "href");
  const imageBlockMatch = channelOnly.match(/<image[^>]*>([\s\S]*?)<\/image>/i);
  const art = itunesImg || (imageBlockMatch ? getText(imageBlockMatch[1], "url") : "");

  const episodes = [];
  const itemRe = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const item = m[1];
    const audioUrl = getAttr(item, "enclosure", "url");
    if (!audioUrl) continue;
    const guid = getText(item, "guid") || audioUrl;
    const chaptersUrl = getAttr(item, "podcast:chapters", "url") || "";
    episodes.push({
      id: guid,
      title: getText(item, "title") || getText(item, "itunes:title"),
      description: getText(item, "itunes:summary") || getText(item, "description"),
      pubDate: getText(item, "pubDate"),
      duration: parseDuration(getText(item, "itunes:duration")),
      audioUrl,
      art: getAttr(item, "itunes:image", "href") || "",
      chaptersUrl
    });
  }

  return { title, description, art, episodes: episodes.slice(0, 50) };
}

function getText(xml, tag) {
  const t = tag.replace(":", "\\:");
  // Grab the full inner content of the first matching tag (non-greedy), then
  // normalize it. Being tolerant here matters: real-world feeds (Rick Steves
  // among them) wrap titles in CDATA that may be preceded by whitespace, nest
  // inline markup inside the tag, or use hex entities — all of which the old
  // strict CDATA/`[^<]*` patterns dropped on the floor, yielding empty titles.
  const re = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, "i");
  const m = re.exec(xml);
  if (!m) return "";
  let inner = m[1].trim();
  // Unwrap any CDATA section(s); their contents are literal, so no decoding.
  if (inner.indexOf("<![CDATA[") !== -1) {
    return inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  }
  // Plain text: strip stray inline tags, then decode entities.
  return decodeEntities(inner.replace(/<[^>]+>/g, "").trim());
}

function getAttr(xml, tag, attr) {
  const t = tag.replace(":", "\\:");
  const re = new RegExp(`<${t}[^>]*\\s${attr}=["']([^"']*)["'][^>]*>`, "i");
  const m = re.exec(xml);
  return m ? m[1].trim() : "";
}

function parseDuration(str) {
  if (!str) return 0;
  const parts = str.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return Number(str) || 0;
}

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

// Exposed for tests (feed content-type allow-list + parser).
module.exports.FEED_CONTENT_TYPES = FEED_CONTENT_TYPES;
module.exports.parseRSS = parseRSS;
