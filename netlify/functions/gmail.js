const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed" });

  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const accessToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) return json(401, { error: "Not authenticated." });

  const userId = await getUserId(accessToken, serviceKey);
  if (!userId) return json(401, { error: "Invalid session." });

  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return json(400, { error: "Invalid JSON" }); }
  const { action } = body;

  if (action === "status") {
    const tokens = await loadUserGmailTokens(serviceKey, userId);
    return json(200, { connected: Boolean(tokens?.refreshToken), email: tokens?.email || null });
  }

  if (action === "disconnect") {
    await deleteUserGmailTokens(serviceKey, userId);
    return json(200, { ok: true });
  }

  const tokens = await loadUserGmailTokens(serviceKey, userId);
  if (!tokens?.refreshToken) return json(400, { error: "Gmail not connected." });

  const gToken = await getValidAccessToken(tokens, serviceKey, userId);
  if (!gToken) return json(503, { error: "Could not get Gmail access token." });

  if (action === "list") {
    const { labelIds = ["INBOX"], maxResults = 15, pageToken, q } = body;
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (pageToken) params.set("pageToken", pageToken);
    if (q) params.set("q", q);
    labelIds.forEach((l) => params.append("labelIds", l));

    const listRes = await gFetch(gToken, `/messages?${params}`);
    if (!listRes.ok) return json(502, { error: "Gmail list failed." });
    const listData = await listRes.json();

    const messages = (await Promise.all(
      (listData.messages || []).map(async (m) => {
        const r = await gFetch(gToken, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!r.ok) return null;
        const d = await r.json();
        const hdrs = headersMap(d.payload?.headers);
        return {
          id: d.id,
          threadId: d.threadId,
          snippet: cleanSnippet(d.snippet),
          unread: (d.labelIds || []).includes("UNREAD"),
          starred: (d.labelIds || []).includes("STARRED"),
          from: hdrs.from || "",
          subject: hdrs.subject || "(no subject)",
          date: hdrs.date || "",
          internalDate: d.internalDate
        };
      })
    )).filter(Boolean);

    return json(200, { messages, nextPageToken: listData.nextPageToken || null });
  }

  if (action === "get") {
    const { threadId, messageId } = body;
    if (!threadId && !messageId) return json(400, { error: "threadId or messageId required" });

    if (threadId) {
      const r = await gFetch(gToken, `/threads/${threadId}?format=full`);
      if (!r.ok) return json(502, { error: "Gmail thread fetch failed." });
      const thread = await r.json();
      const firstUnread = (thread.messages || []).find((m) => (m.labelIds || []).includes("UNREAD"));
      if (firstUnread) await gFetch(gToken, `/messages/${firstUnread.id}/modify`, "POST", { removeLabelIds: ["UNREAD"] });
      return json(200, { thread: normalizeThread(thread) });
    }

    const r = await gFetch(gToken, `/messages/${messageId}?format=full`);
    if (!r.ok) return json(502, { error: "Gmail message fetch failed." });
    return json(200, { message: normalizeMessage(await r.json()) });
  }

  if (action === "send") {
    const { to, subject, body: emailBody, inReplyTo, references, threadId } = body;
    if (!to || !emailBody) return json(400, { error: "to and body required" });
    const raw = buildRaw({ from: tokens.email, to, subject, body: emailBody, inReplyTo, references });
    const payload = { raw };
    if (threadId) payload.threadId = threadId;
    const r = await gFetch(gToken, `/messages/send`, "POST", payload);
    if (!r.ok) { const e = await r.json().catch(() => ({})); return json(502, { error: e.error?.message || "Send failed." }); }
    return json(200, { ok: true });
  }

  if (action === "labels") {
    const r = await gFetch(gToken, "/labels");
    if (!r.ok) return json(502, { error: "Labels fetch failed." });
    const data = await r.json();
    return json(200, { labels: data.labels || [] });
  }

  if (action === "move") {
    const { threadId, addLabelIds = [], removeLabelIds = [] } = body;
    if (!threadId) return json(400, { error: "threadId required" });
    const threadRes = await gFetch(gToken, `/threads/${threadId}?format=minimal`);
    if (!threadRes.ok) return json(502, { error: "Thread fetch failed." });
    const thread = await threadRes.json();
    await Promise.all((thread.messages || []).map((m) =>
      gFetch(gToken, `/messages/${m.id}/modify`, "POST", { addLabelIds, removeLabelIds })
    ));
    return json(200, { ok: true });
  }

  if (action === "draft") {
    const { emailContext, userInstruction } = body;
    if (!emailContext) return json(400, { error: "emailContext required" });
    const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    if (!anthropicKey) return json(503, { error: "ANTHROPIC_API_KEY not configured." });
    const draft = await claudeDraft(anthropicKey, emailContext, userInstruction || "", tokens.email);
    return json(200, { draft });
  }

  return json(400, { error: `Unknown action: ${action}` });
};

// ─── Token management ─────────────────────────────────────────────────────────

async function getValidAccessToken(tokens, serviceKey, userId) {
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: tokens.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" })
  });
  if (!res.ok) return null;
  const data = await res.json();
  tokens.accessToken = data.access_token;
  tokens.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  await saveUserGmailTokens(serviceKey, userId, tokens);
  return data.access_token;
}

// ─── Gmail API helpers ────────────────────────────────────────────────────────

function gFetch(token, path, method = "GET", body) {
  const opts = { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  return fetch(`${GMAIL_BASE}${path}`, opts);
}

function headersMap(headers = []) {
  return Object.fromEntries(headers.map((h) => [h.name.toLowerCase(), h.value]));
}

function normalizeThread(thread) {
  return { id: thread.id, messages: (thread.messages || []).map(normalizeMessage) };
}

function normalizeMessage(msg) {
  const hdrs = headersMap(msg.payload?.headers);
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: hdrs.from || "",
    to: hdrs.to || "",
    subject: hdrs.subject || "(no subject)",
    date: hdrs.date || "",
    internalDate: msg.internalDate,
    snippet: cleanSnippet(msg.snippet),
    unread: (msg.labelIds || []).includes("UNREAD"),
    body: extractBody(msg.payload),
    messageId: hdrs["message-id"] || "",
    references: hdrs.references || ""
  };
}

function extractBody(payload) {
  if (!payload) return "";
  if (payload.body?.data) {
    if (payload.mimeType === "text/plain" || payload.mimeType === "text/html") return decodeB64(payload.body.data);
  }
  if (payload.parts) {
    const html = payload.parts.find((p) => p.mimeType === "text/html");
    if (html?.body?.data) return decodeB64(html.body.data);
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain?.body?.data) return decodeB64(plain.body.data);
    for (const part of payload.parts) { const t = extractBody(part); if (t) return t; }
  }
  return "";
}

function decodeB64(encoded) {
  return Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

function buildRaw({ from, to, subject, body, inReplyTo, references }) {
  const lines = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `Content-Type: text/plain; charset=UTF-8`, `MIME-Version: 1.0`];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push("", body);
  return Buffer.from(lines.join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ─── AI draft ─────────────────────────────────────────────────────────────────

async function claudeDraft(apiKey, emailContext, instruction, myEmail) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: `You are an email assistant for ${myEmail}. Write a reply that is concise, warm, and natural. Return ONLY the reply body text — start with a greeting like "Hi [name]," and do not include a subject line or meta-commentary.`,
      messages: [{ role: "user", content: `Email thread to reply to:\n\n${emailContext}${instruction ? `\n\nInstructions: ${instruction}` : ""}` }]
    })
  });
  if (!res.ok) throw new Error("Claude draft failed");
  const data = await res.json();
  return data.content?.[0]?.text || "";
}

// ─── Supabase helpers ─────────────────────────────────────────────────────────

async function loadUserGmailTokens(serviceKey, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.gmail_${userId}&select=state`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  const rows = await res.json().catch(() => []);
  return rows[0]?.state || null;
}

async function saveUserGmailTokens(serviceKey, userId, tokens) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `gmail_${userId}`, state: tokens })
  });
}

async function deleteUserGmailTokens(serviceKey, userId) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.gmail_${userId}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` }
  });
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

function cleanSnippet(raw) {
  if (!raw) return "";
  return raw
    .replace(/&(zwnj|zwj|lrm|rlm|shy|#8203|#8204|#8205|#xfeff|#x200[bcdef]);/gi, "")
    .replace(/[​‌‍‎‏﻿­]/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
