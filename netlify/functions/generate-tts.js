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

  // Check cache — if meta.json exists, audio was already generated
  const cached = await getStorageJson(serviceKey, `${articleId}/meta.json`);
  if (cached?.count) {
    const urls = Array.from({ length: cached.count }, (_, i) =>
      `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${articleId}/${i}.mp3`
    );
    return cors(json(200, { urls, cached: true }));
  }

  // Split text into ≤4800-char chunks at sentence boundaries
  const chunks = splitText(cleanText, 4800);

  const urls = [];
  for (let i = 0; i < chunks.length; i++) {
    const audioBase64 = await synthesize(ttsKey, chunks[i]);
    if (!audioBase64) return cors(json(500, { error: `TTS generation failed for chunk ${i}` }));
    const uploaded = await uploadToStorage(
      serviceKey,
      `${articleId}/${i}.mp3`,
      Buffer.from(audioBase64, "base64"),
      "audio/mpeg"
    );
    if (!uploaded) return cors(json(500, { error: `Storage upload failed for chunk ${i}` }));
    urls.push(`${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${articleId}/${i}.mp3`);
  }

  // Save metadata so future requests return cached URLs
  await uploadToStorage(
    serviceKey,
    `${articleId}/meta.json`,
    Buffer.from(JSON.stringify({ count: chunks.length, generatedAt: new Date().toISOString() })),
    "application/json"
  );

  return cors(json(200, { urls, cached: false }));
};

function splitText(text, maxLen) {
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let cutAt = maxLen;
    const sentenceEnd = remaining.lastIndexOf(". ", maxLen);
    if (sentenceEnd > maxLen * 0.5) cutAt = sentenceEnd + 2;
    chunks.push(remaining.slice(0, cutAt).trim());
    remaining = remaining.slice(cutAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function synthesize(apiKey, text) {
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: "en-US-Neural2-D" },
        audioConfig: { audioEncoding: "MP3" }
      })
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error("TTS API error:", res.status, JSON.stringify(err));
    return null;
  }
  const data = await res.json();
  return data.audioContent || null;
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
