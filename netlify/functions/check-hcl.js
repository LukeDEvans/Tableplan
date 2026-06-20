const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(401, { error: "Not authenticated." });
  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return json(401, { error: "Invalid session." });

  const apiKey = (process.env.BIBLIOCOMMONS_API_KEY || "").trim();
  if (!apiKey) return json(200, { status: "unconfigured" });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }

  const { title, authors = [], libraryKey = "hclib" } = body;
  if (!title) return json(400, { error: "title required" });

  const q = [title, ...(Array.isArray(authors) ? authors.slice(0, 1) : [])].filter(Boolean).join(" ");
  const searchUrl = `https://api.bibliocommons.com/v2/libraries/${encodeURIComponent(libraryKey)}/bibs/search?q=${encodeURIComponent(q)}&api_key=${apiKey}&locale=en-US&limit=5&fields=briefInfo,availability`;

  let data;
  try {
    const res = await fetch(searchUrl);
    if (!res.ok) return json(200, { status: "error", detail: `BiblioCommons ${res.status}` });
    data = await res.json();
  } catch (e) {
    return json(200, { status: "error", detail: String(e) });
  }

  const bibs = data.bibs || [];
  if (!bibs.length) return json(200, { status: "not_found" });

  // Pick the best match: prefer title similarity
  const titleLower = title.toLowerCase();
  const bib = bibs.find(b => (b.briefInfo?.title || "").toLowerCase().includes(titleLower)) || bibs[0];
  const avail = bib.availability || {};

  return json(200, {
    status: "found",
    title: bib.briefInfo?.title || null,
    format: bib.briefInfo?.format || null,
    copiesAvailable: avail.copiesAvailable ?? 0,
    copiesOwned: avail.copiesOwned ?? 0,
    numberOfHolds: avail.numberOfHolds ?? 0,
    catalogUrl: `https://${libraryKey}.bibliocommons.com/v2/record/${bib.id}`,
  });
};

async function getUserId(accessToken, serviceKey) {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user.id || null;
  } catch { return null; }
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
