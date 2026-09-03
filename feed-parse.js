// feed-parse.js — a PURE, network-free RSS 2.0 + Atom parser for article feeds
// (Phase 2A). Deterministic with respect to its input string; usable in Node
// (tests) and the browser (no DOMParser dependency — same tolerant regex technique
// the podcast parser uses). It ONLY parses: no fetching, no identity/dedup, no
// canonicalization, no lifecycle. `feed-ingest.js` normalizes these items into the
// canonical Article via publications.js.
//
// Output: { ok, format, feed:{title,description,link}, items:[…] } on success, or
// { ok:false, error } when the document is not a recognizable feed (an EMPTY feed
// is still ok:true with items:[] — an empty feed and a broken feed are different).

const entity = (str) => String(str || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

// Inner text of the first <tag>…</tag>, CDATA-aware, inline-tag-stripped, decoded.
function getText(xml, tag) {
  const t = tag.replace(":", "\\:");
  const m = new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${t}>`, "i").exec(xml);
  if (!m) return "";
  const inner = m[1].trim();
  if (inner.indexOf("<![CDATA[") !== -1) {
    return inner.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  }
  return entity(inner.replace(/<[^>]+>/g, "").trim());
}

// Value of `attr` on the first <tag …>. Optionally require another attr=value to
// match (used for Atom <link rel="alternate">).
function getAttr(xml, tag, attr, whereAttr, whereVal) {
  const t = tag.replace(":", "\\:");
  const re = new RegExp(`<${t}\\b[^>]*>`, "gi");
  let m;
  while ((m = re.exec(xml)) !== null) {
    const openTag = m[0];
    if (whereAttr) {
      const w = new RegExp(`\\b${whereAttr}=["']([^"']*)["']`, "i").exec(openTag);
      if (!w || w[1] !== whereVal) continue;
    }
    const a = new RegExp(`\\b${attr}=["']([^"']*)["']`, "i").exec(openTag);
    if (a) return entity(a[1].trim());
  }
  return "";
}

function guidOf(itemXml) {
  const m = /<guid(?:\s[^>]*)?>([\s\S]*?)<\/guid>/i.exec(itemXml);
  if (!m) return { guid: "", isPermalink: false };
  const openTag = /<guid(?:\s[^>]*)?>/i.exec(itemXml)[0];
  const perm = /isPermaLink=["']([^"']*)["']/i.exec(openTag);
  const raw = m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
  return { guid: entity(raw), isPermalink: perm ? perm[1] !== "false" : true };
}

// Best-effort item image: media:content/@url, media:thumbnail/@url, an <image>
// enclosure, or an <enclosure> with an image type. Metadata reference only.
function imageOf(itemXml) {
  return getAttr(itemXml, "media:content", "url")
    || getAttr(itemXml, "media:thumbnail", "url")
    || (/<enclosure\b[^>]*type=["']image\//i.test(itemXml) ? getAttr(itemXml, "enclosure", "url") : "")
    || "";
}

function parseRssItem(itemXml) {
  const g = guidOf(itemXml);
  return {
    guid: g.guid,
    guidIsPermalink: g.isPermalink,
    link: getText(itemXml, "link") || getAttr(itemXml, "atom:link", "href"),
    title: getText(itemXml, "title"),
    author: getText(itemXml, "dc:creator") || getText(itemXml, "author"),
    published: getText(itemXml, "pubDate") || getText(itemXml, "dc:date") || getText(itemXml, "published"),
    updated: getText(itemXml, "atom:updated") || getText(itemXml, "lastBuildDate") || "",
    description: getText(itemXml, "description") || getText(itemXml, "summary") || "",
    category: getText(itemXml, "category"),
    imageUrl: imageOf(itemXml),
  };
}

function parseAtomEntry(entryXml) {
  return {
    guid: getText(entryXml, "id"),
    guidIsPermalink: false, // Atom ids are URIs but not necessarily the article URL
    link: getAttr(entryXml, "link", "href", "rel", "alternate") || getAttr(entryXml, "link", "href"),
    title: getText(entryXml, "title"),
    author: getText(entryXml, "name"),
    published: getText(entryXml, "published") || getText(entryXml, "issued") || "",
    updated: getText(entryXml, "updated") || getText(entryXml, "modified") || "",
    description: getText(entryXml, "summary") || getText(entryXml, "content") || "",
    category: getAttr(entryXml, "category", "term"),
    imageUrl: "",
  };
}

const CAP = 100; // ingest what the feed exposes; feeds are not a historical DB (§31)

export function parseFeed(xml) {
  const text = String(xml || "");
  if (!text.trim()) return { ok: false, error: "empty input" };
  const isAtom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  try {
    if (isAtom) {
      const feed = {
        title: getText(text.replace(/<entry[\s\S]*?<\/entry>/gi, ""), "title"),
        description: getText(text, "subtitle"),
        link: getAttr(text, "link", "href", "rel", "alternate") || getAttr(text, "link", "href"),
      };
      const items = [];
      const re = /<entry[\s>]([\s\S]*?)<\/entry>/gi; let m;
      while ((m = re.exec(text)) !== null && items.length < CAP) items.push(parseAtomEntry(m[0]));
      return { ok: true, format: "atom", feed, items };
    }
    // RSS 2.0 (and RSS-like)
    const channel = /<channel[\s>]([\s\S]*?)<\/channel>/i.exec(text);
    if (!channel && !/<item[\s>]/i.test(text)) return { ok: false, error: "not a recognizable RSS/Atom feed" };
    const channelOnly = (channel ? channel[1] : text).replace(/<item[\s\S]*?<\/item>/gi, "");
    const feed = {
      title: getText(channelOnly, "title"),
      description: getText(channelOnly, "description"),
      link: getText(channelOnly, "link"),
    };
    const items = [];
    const re = /<item[\s>]([\s\S]*?)<\/item>/gi; let m;
    while ((m = re.exec(text)) !== null && items.length < CAP) items.push(parseRssItem(m[0]));
    return { ok: true, format: "rss", feed, items };
  } catch (e) {
    return { ok: false, error: `parse failed: ${e && e.message ? e.message : "unknown"}` };
  }
}
