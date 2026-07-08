const { scanBookingFromEmailText } = require("../../booking-scan");
const {
  loadUserGmailTokens, saveUserGmailTokens, deleteUserGmailTokens,
  getUserId, getValidAccessToken, gFetch, headersMap, extractBody,
  htmlToText, cleanSnippet, loadMailSuggestions, saveMailSuggestions, runInboxSweep
} = require("./_gmail-shared");

// Domains that send travel booking confirmations, used by listBookingEmails
const TRAVEL_SENDERS = [
  // Lodging
  "airbnb.com", "booking.com", "hotels.com", "expedia.com", "vrbo.com", "agoda.com",
  "priceline.com", "hostelworld.com", "marriott.com", "hilton.com", "hyatt.com", "ihg.com",
  // Airlines
  "delta.com", "united.com", "aa.com", "southwest.com", "jetblue.com", "alaskaair.com",
  "spirit.com", "flyfrontier.com", "hawaiianair.com", "britishairways.com", "lufthansa.com",
  "airfrance.com", "klm.com", "aerlingus.com", "ryanair.com", "easyjet.com",
  // Rental cars
  "hertz.com", "enterprise.com", "avis.com", "budget.com", "nationalcar.com", "alamo.com",
  "thrifty.com", "dollar.com", "turo.com", "sixt.com",
  // Rail / other
  "amtrak.com", "trainline.com"
];

function buildBookingSearchQuery(monthsBack) {
  const fromQ = TRAVEL_SENDERS.map((d) => `from:${d}`).join(" OR ");
  return `(${fromQ}) (confirmation OR confirmed OR reservation OR itinerary OR "e-ticket" OR booking) newer_than:${monthsBack}m`;
}

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

  if (action === "suggestions") {
    const data = await loadMailSuggestions(serviceKey, userId);
    return json(200, { suggestions: data.suggestions });
  }

  if (action === "resolveSuggestion") {
    const { suggestionId, status } = body;
    if (!suggestionId || !["approved", "dismissed"].includes(status)) {
      return json(400, { error: "suggestionId and status (approved|dismissed) required" });
    }
    const data = await loadMailSuggestions(serviceKey, userId);
    const s = data.suggestions.find((x) => x.id === suggestionId);
    if (s) {
      s.status = status;
      s.resolvedAt = new Date().toISOString();
      await saveMailSuggestions(serviceKey, userId, data);
    }
    return json(200, { ok: true });
  }

  const tokens = await loadUserGmailTokens(serviceKey, userId);
  if (!tokens?.refreshToken) return json(400, { error: "Gmail not connected." });

  const { token: gToken, invalidGrant } = await getValidAccessToken(tokens, serviceKey, userId);
  if (invalidGrant) return json(401, { error: "Gmail connection expired — please reconnect." });
  if (!gToken) return json(503, { error: "Could not get Gmail access token." });

  if (action === "list") {
    const { labelIds = ["INBOX"], maxResults = 15, pageToken, q } = body;
    const params = new URLSearchParams({ maxResults: String(maxResults) });
    if (pageToken) params.set("pageToken", pageToken);
    if (q) params.set("q", q);
    labelIds.forEach((l) => params.append("labelIds", l));

    const listRes = await gFetch(gToken, `/messages?${params}`);
    if (!listRes.ok) {
      const e = await listRes.json().catch(() => ({}));
      console.error("Gmail list failed:", listRes.status, JSON.stringify(e));
      return json(502, { error: e.error?.message || `Gmail list failed (${listRes.status}).` });
    }
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

  if (action === "checkInboxNow") {
    const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    try {
      const result = await runInboxSweep(tokens, serviceKey, userId, { anthropicKey });
      const data = await loadMailSuggestions(serviceKey, userId);
      return json(200, { ...result, suggestions: data.suggestions });
    } catch (e) {
      console.error("checkInboxNow failed:", e.message);
      return json(502, { error: e.message || "Inbox check failed." });
    }
  }

  if (action === "listBookingEmails") {
    const monthsBack = Math.min(Math.max(parseInt(body.monthsBack) || 6, 1), 24);
    const params = new URLSearchParams({ maxResults: "20", q: buildBookingSearchQuery(monthsBack) });
    const listRes = await gFetch(gToken, `/messages?${params}`);
    if (!listRes.ok) {
      const e = await listRes.json().catch(() => ({}));
      console.error("Booking email search failed:", listRes.status, JSON.stringify(e));
      return json(502, { error: e.error?.message || `Gmail search failed (${listRes.status}).` });
    }
    const listData = await listRes.json();
    const messages = (await Promise.all(
      (listData.messages || []).map(async (m) => {
        const r = await gFetch(gToken, `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!r.ok) return null;
        const d = await r.json();
        const hdrs = headersMap(d.payload?.headers);
        return {
          id: d.id,
          from: hdrs.from || "",
          subject: hdrs.subject || "(no subject)",
          date: hdrs.date || "",
          internalDate: d.internalDate,
          snippet: cleanSnippet(d.snippet)
        };
      })
    )).filter(Boolean);
    messages.sort((a, b) => Number(b.internalDate) - Number(a.internalDate));
    return json(200, { messages });
  }

  if (action === "scanBookingEmail") {
    const { messageId } = body;
    if (!messageId) return json(400, { error: "messageId required" });
    const anthropicKey = (process.env.ANTHROPIC_API_KEY || "").trim();
    if (!anthropicKey) return json(503, { error: "ANTHROPIC_API_KEY not configured." });
    const r = await gFetch(gToken, `/messages/${messageId}?format=full`);
    if (!r.ok) return json(502, { error: "Gmail message fetch failed." });
    const msg = await r.json();
    const hdrs = headersMap(msg.payload?.headers);
    const emailText = `Subject: ${hdrs.subject || ""}\nFrom: ${hdrs.from || ""}\nDate: ${hdrs.date || ""}\n\n${htmlToText(extractBody(msg.payload))}`;
    try {
      const booking = await scanBookingFromEmailText(emailText, { apiKey: anthropicKey });
      return json(200, { booking }); // booking is null when the email isn't a confirmation
    } catch (e) {
      console.error("Booking email scan failed:", e.message);
      return json(502, { error: e.message || "Scan failed." });
    }
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

// ─── Response shaping ─────────────────────────────────────────────────────────

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

function json(statusCode, body) {
  return { statusCode, headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body) };
}
