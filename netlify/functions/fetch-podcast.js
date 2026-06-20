exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }

  const { url } = body;
  if (!url) return json(400, { error: "url required" });

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; LiveApp/1.0)",
        "Accept": "application/rss+xml, application/xml, text/xml, */*"
      }
    });
    if (!res.ok) return json(502, { error: `Feed returned ${res.status}` });
    const xml = await res.text();
    const parsed = parseRSS(xml);
    if (!parsed.title) return json(422, { error: "Could not parse RSS feed — check the URL is a valid RSS/Atom feed" });
    return json(200, parsed);
  } catch (e) {
    return json(500, { error: e.message || "Failed to fetch feed" });
  }
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
      title: getText(item, "title"),
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
  const cdataRe = new RegExp(`<${t}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${t}>`, "i");
  const textRe = new RegExp(`<${t}[^>]*>([^<]*)<\\/${t}>`, "i");
  const cm = cdataRe.exec(xml);
  if (cm) return cm[1].trim();
  const tm = textRe.exec(xml);
  return tm ? decodeEntities(tm[1].trim()) : "";
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
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
