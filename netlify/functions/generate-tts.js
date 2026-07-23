const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const BUCKET = "article-audio";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return cors(json(200, {}));
  if (event.httpMethod !== "POST") return cors(json(405, { error: "Method not allowed" }));

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const ttsKey = (process.env.GOOGLE_MAPS_API_KEY || process.env.Google_Maps || "").trim();
  if (!ttsKey) return cors(json(500, { error: "TTS API key not configured." }));

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return cors(json(401, { error: "Not authenticated." }));
  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return cors(json(401, { error: "Invalid session." }));

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return cors(json(400, { error: "Invalid JSON" })); }

  const { articleId, text } = body;
  if (!articleId || !text) return cors(json(400, { error: "articleId and text are required" }));

  const cleanText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!cleanText) return cors(json(400, { error: "No text content." }));

  // Bump when the generation format changes so older cached audio (which has
  // no word timings) is regenerated on next play instead of served stale.
  const FORMAT_VERSION = 2;

  // Check cache — reuse only if it was generated in the current format (i.e.
  // already carries per-word timings for on-screen highlighting).
  const cached = await getStorageJson(serviceKey, `${articleId}/meta.json`);
  if (cached?.count && cached.version === FORMAT_VERSION) {
    const urls = Array.from({ length: cached.count }, (_, i) =>
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${articleId}/${i}.mp3`
    );
    return cors(json(200, { urls, timings: cached.timings || null, cached: true }));
  }

  // One word per token; each is wrapped in an SSML <mark> so the API reports
  // the exact time it's spoken (used to highlight the word on screen).
  const words = cleanText.split(/\s+/).filter(Boolean);
  const chunks = buildSsmlChunks(words); // [{ startIndex, ssml }]

  const urls = [];
  const timings = new Array(words.length).fill(null); // per word: { c: chunkIndex, t: seconds }
  for (let i = 0; i < chunks.length; i++) {
    const result = await synthesize(ttsKey, chunks[i].ssml);
    if (!result?.audio) return cors(json(500, { error: `TTS generation failed for chunk ${i}` }));
    const uploaded = await uploadToStorage(
      serviceKey,
      `${articleId}/${i}.mp3`,
      Buffer.from(result.audio, "base64"),
      "audio/mpeg"
    );
    if (!uploaded) return cors(json(500, { error: `Storage upload failed for chunk ${i}` }));
    urls.push(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${articleId}/${i}.mp3`);
    for (const tp of result.timepoints || []) {
      const gi = parseInt(String(tp.markName).slice(1), 10); // "w123" -> 123 (global index)
      if (gi >= 0 && gi < timings.length) timings[gi] = { c: i, t: tp.timeSeconds || 0 };
    }
  }

  await uploadToStorage(
    serviceKey,
    `${articleId}/meta.json`,
    Buffer.from(JSON.stringify({ count: chunks.length, version: FORMAT_VERSION, timings, generatedAt: new Date().toISOString() })),
    "application/json"
  );

  return cors(json(200, { urls, timings, cached: false }));
};

function escapeSsml(w) {
  return w.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// Group words into chunks whose SSML stays under Google's ~5000-byte input
// limit. Each word carries an SSML <mark> with its GLOBAL index so timepoints
// map straight back to the word regardless of which chunk they came from.
function buildSsmlChunks(words, maxBytes = 4500) {
  const chunks = [];
  let cur = [], curStart = 0, curBytes = "<speak></speak>".length;
  for (let i = 0; i < words.length; i++) {
    const piece = `<mark name="w${i}"/>${escapeSsml(words[i])} `;
    const pieceBytes = Buffer.byteLength(piece, "utf8");
    if (cur.length && curBytes + pieceBytes > maxBytes) {
      chunks.push({ startIndex: curStart, ssml: `<speak>${cur.join("")}</speak>` });
      cur = []; curStart = i; curBytes = "<speak></speak>".length;
    }
    cur.push(piece); curBytes += pieceBytes;
  }
  if (cur.length) chunks.push({ startIndex: curStart, ssml: `<speak>${cur.join("")}</speak>` });
  return chunks;
}

async function synthesize(apiKey, ssml) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1beta1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { ssml },
        voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "MP3" },
        enableTimePointing: ["SSML_MARK"]
      })
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("TTS API error:", res.status, JSON.stringify(err));
    return null;
  }
  const data = await res.json();
  return data.audioContent ? { audio: data.audioContent, timepoints: data.timepoints || [] } : null;
}

async function getStorageJson(serviceKey, path) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function uploadToStorage(serviceKey, path, buffer, contentType) {
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "content-type": contentType,
        "cache-control": "31536000",
        "x-upsert": "true"
      },
      body: buffer
    });
    return res.ok;
  } catch { return false; }
}

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

function cors(response) {
  return { ...response, headers: { ...(response.headers || {}), "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, authorization" } };
}
