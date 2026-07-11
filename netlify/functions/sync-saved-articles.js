const { getUserIdFromToken, getUserGroupId, loadSection, updateSection } = require("./_state-sections.js");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));

  const userId = await getUserIdFromToken(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) return cors(json(404, { error: "User group not found." }));

  const mediaRow = await loadSection(serviceKey, groupId, "media").catch(() => null);
  const syncConfig = mediaRow?.state?.articleSync || {};
  const nytCookie = (syncConfig.nytCookie || "").trim();
  const economistCookie = (syncConfig.economistCookie || "").trim();

  if (!nytCookie && !economistCookie) {
    return cors(json(200, { ok: true, nytAdded: 0, economistAdded: 0, articles: [], message: "No cookies configured." }));
  }

  const fetched = [];
  let nytError = null;
  let economistError = null;

  if (nytCookie) {
    try {
      fetched.push(...(await fetchNYTSaved(nytCookie)));
    } catch (e) { nytError = e.message; }
  }

  if (economistCookie) {
    try {
      fetched.push(...(await fetchEconomistSaved(economistCookie)));
    } catch (e) { economistError = e.message; }
  }

  let nytAdded = 0;
  let economistAdded = 0;
  let newArticles = [];

  try {
    await updateSection(serviceKey, groupId, "media", (state) => {
      const existing = Array.isArray(state.savedArticles) ? state.savedArticles : [];
      const existingUrls = new Set(existing.map((a) => a.url));
      nytAdded = 0;
      economistAdded = 0;
      newArticles = [];
      for (const item of fetched) {
        if (existingUrls.has(item.url)) continue;
        existingUrls.add(item.url);
        newArticles.push({ ...item, savedAt: new Date().toISOString(), author: null, date: null, text: null });
        if (item.publication === "economist") economistAdded++; else nytAdded++;
      }
      return {
        ...state,
        savedArticles: [...existing, ...newArticles],
        articleSync: { ...(state.articleSync || {}), lastSyncedAt: new Date().toISOString() }
      };
    });
  } catch (err) {
    return cors(json(500, { error: "Could not save synced articles: " + err.message }));
  }

  return cors(json(200, { ok: true, nytAdded, economistAdded, articles: newArticles, nytError, economistError }));
};

async function fetchNYTSaved(nytsCookie) {
  const res = await fetch("https://www.nytimes.com/saved", {
    headers: {
      Cookie: `NYT-S=${nytsCookie}`,
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`NYT fetch failed: ${res.status}`);
  const html = await res.text();
  if (/\/login\?|"isLoggedIn"\s*:\s*false|data-testid="login-button"/i.test(html)) {
    throw new Error("NYT session expired — reconnect in Settings → Sync Settings.");
  }
  return parseNYTArticles(html);
}

async function fetchEconomistSaved(blaizetSession) {
  const res = await fetch("https://www.economist.com/for-you/bookmarks", {
    headers: {
      Cookie: `blaize_session=${blaizetSession}`,
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!res.ok) throw new Error(`Economist fetch failed: ${res.status}`);
  const html = await res.text();
  return parseEconomistArticles(html);
}

const NYT_URL_RE = /https?:\/\/(?:www\.)?nytimes\.com\/(\d{4}\/\d{2}\/\d{2}\/[^"'\s<>?#]+)/g;
const NYT_LANG_RE = /\/(?:es|zh|ar|fr|de)\//i;

function parseNYTArticles(html) {
  const articles = [];
  const seen = new Set();

  // NYT is a Next.js app — try __NEXT_DATA__ first (server-embedded JSON, no JS needed)
  const nextDataMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextDataMatch) {
    try {
      const root = JSON.parse(nextDataMatch[1]);
      extractNYTFromJson(root, seen, articles, 0);
    } catch { /* fall through */ }
  }

  // Fall back to plain-HTML li parsing (catches any server-rendered markup)
  if (articles.length === 0) {
    NYT_URL_RE.lastIndex = 0;
    const chunks = html.split("<li");
    for (const chunk of chunks) {
      const urlMatch = chunk.match(
        /href="(https?:\/\/(?:www\.)?nytimes\.com\/\d{4}\/\d{2}\/\d{2}\/[^"?#]+)(?:[?#][^"]*)?"[^>]*>/
      );
      if (!urlMatch) continue;
      const url = urlMatch[1].replace(/\/$/, "");
      if (seen.has(url) || NYT_LANG_RE.test(url)) continue;
      seen.add(url);
      const h3Match = chunk.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i);
      const title = h3Match ? h3Match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : url;
      const timeMatch = chunk.match(/<time[^>]*datetime="([^"]+)"/i);
      articles.push({ id: crypto.randomUUID(), url, title, publication: "nyt", date: timeMatch?.[1] || null });
    }
  }

  return articles;
}

function extractNYTFromJson(node, seen, articles, depth) {
  if (depth > 30 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) extractNYTFromJson(item, seen, articles, depth + 1);
    return;
  }
  // If this object looks like an article, capture it
  const rawUrl = node.url || node.canonicalUrl || node.shareUrl || "";
  if (typeof rawUrl === "string" && /nytimes\.com\/\d{4}\/\d{2}\/\d{2}\//.test(rawUrl)) {
    const url = rawUrl.split("?")[0].split("#")[0].replace(/\/$/, "");
    if (!seen.has(url) && !NYT_LANG_RE.test(url)) {
      seen.add(url);
      const headline = node.headline;
      const title =
        (typeof headline === "string" ? headline : headline?.default || headline?.main || "") ||
        node.title || node.name || url;
      const date = node.firstPublished || node.firstPublishedAt || node.publishedAt || null;
      articles.push({ id: crypto.randomUUID(), url, title: String(title), publication: "nyt", date });
    }
  }
  for (const val of Object.values(node)) {
    if (val && typeof val === "object") extractNYTFromJson(val, seen, articles, depth + 1);
  }
}

function parseEconomistArticles(html) {
  const articles = [];
  const seen = new Set();
  const ECON_SECTION =
    /economist\.com\/(asia|business|china|europe|finance|leaders|science|technology|culture|briefing|graphic|interactive|united-states|britain|international|middle-east|the-americas|obituary|special-report|the-world-ahead|1843)\/\d{4}/;
  const chunks = html.split("<li");
  for (const chunk of chunks) {
    const urlMatch = chunk.match(
      /href="(https?:\/\/(?:www\.)?economist\.com\/[a-z-]+\/\d{4}\/\d{2}\/\d{2}\/[^"?#]+)(?:[?#][^"]*)?"[^>]*>([^<]*)</
    );
    if (!urlMatch) continue;
    const url = urlMatch[1].replace(/\/$/, "");
    const linkText = urlMatch[2].trim();
    if (seen.has(url) || !ECON_SECTION.test(url)) continue;
    seen.add(url);

    const title = linkText || url;
    articles.push({ id: crypto.randomUUID(), url, title, publication: "economist", date: null });
  }
  return articles;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" },
    body: JSON.stringify(body)
  };
}

function cors(response) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, authorization"
    }
  };
}
