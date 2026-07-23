const { scanBookingFromEmailText } = require("../../booking-scan");
const {
  loadUserGmailTokens, saveUserGmailTokens, deleteUserGmailTokens,
  getUserId, getValidAccessToken, gFetch, headersMap, extractBody,
  htmlToText, cleanSnippet, loadMailSuggestions, saveMailSuggestions, runInboxSweep,
  loadSnoozes, saveSnoozes, findOrCreateSnoozedLabel, modifyWholeThread
} = require("./_gmail-shared");
const { loadMailAiRow, dismissPendingRecipe } = require("./_recipe-digest");

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

  // Recipes collected by the recipe-digest Mail AI features (NYT Cooking,
  // Bon Appétit) — the Meal Plan page's notification bell reads this list
  // directly instead of waiting for a digest email.
  if (action === "pendingRecipes") {
    const row = await loadMailAiRow(serviceKey, userId);
    return json(200, { recipes: row.recipesPending || [] });
  }

  if (action === "dismissRecipe") {
    const { url } = body;
    if (!url) return json(400, { error: "url required" });
    const recipes = await dismissPendingRecipe(serviceKey, userId, url);
    return json(200, { ok: true, recipes });
  }

  // Wake-time metadata for the client's Snoozed folder (the threads themselves
  // carry the "Snoozed" Gmail label; this adds the "until when" per thread).
  if (action === "listSnoozes") {
    return json(200, { snoozes: await loadSnoozes(serviceKey, userId) });
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

    // List CONVERSATIONS, not individual messages, so a multi-message chain is
    // one row (Gmail-style). Each thread is summarized from its latest message.
    const listRes = await gFetch(gToken, `/threads?${params}`);
    if (!listRes.ok) {
      const e = await listRes.json().catch(() => ({}));
      console.error("Gmail list failed:", listRes.status, JSON.stringify(e));
      return json(502, { error: e.error?.message || `Gmail list failed (${listRes.status}).` });
    }
    const listData = await listRes.json();

    // One cheap ids-only query flags which messages carry attachments (metadata
    // format can't tell us); a thread counts as having one if any message does.
    let attachmentIds = new Set();
    try {
      const ap = new URLSearchParams({ maxResults: "100", q: q ? `(${q}) has:attachment` : "has:attachment" });
      labelIds.forEach((l) => ap.append("labelIds", l));
      const ar = await gFetch(gToken, `/messages?${ap}`);
      if (ar.ok) attachmentIds = new Set((((await ar.json()).messages) || []).map((m) => m.id));
    } catch { /* indicator only — never block the list */ }

    const messages = (await Promise.all(
      (listData.threads || []).map(async (t) => {
        const r = await gFetch(gToken, `/threads/${t.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
        if (!r.ok) return null;
        const d = await r.json();
        const msgs = d.messages || [];
        if (!msgs.length) return null;
        const last = msgs[msgs.length - 1]; // most recent message drives the row
        const hdrs = headersMap(last.payload?.headers);
        return {
          id: last.id,
          threadId: t.id,
          count: msgs.length,
          snippet: cleanSnippet(t.snippet || last.snippet || ""),
          unread: msgs.some((m) => (m.labelIds || []).includes("UNREAD")),
          starred: msgs.some((m) => (m.labelIds || []).includes("STARRED")),
          hasAttachment: msgs.some((m) => attachmentIds.has(m.id)),
          from: hdrs.from || "",
          subject: hdrs.subject || "(no subject)",
          date: hdrs.date || "",
          internalDate: last.internalDate
        };
      })
    )).filter(Boolean);

    return json(200, { messages, nextPageToken: listData.nextPageToken || null });
  }

  if (action === "attachment") {
    // Streams one attachment through the function as base64. Capped well
    // under Netlify's ~6MB response limit — anything larger should be
    // opened in Gmail itself (the client handles that fallback).
    const { messageId, attachmentId } = body;
    if (!messageId || !attachmentId) return json(400, { error: "messageId and attachmentId required" });
    const r = await gFetch(gToken, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`);
    if (!r.ok) return json(502, { error: "Attachment fetch failed." });
    const data = await r.json();
    // Netlify sync responses cap at ~6MB; keep the JSON well under it
    if ((data.data || "").length > 5000000) {
      return json(413, { error: "Attachment too large to download here — open it in Gmail.", tooLarge: true });
    }
    return json(200, { data: data.data || "", size: data.size || 0 });
  }

  if (action === "checkInboxNow") {
    // The sweep runs in sweep-background (15-min limit) — AI newsletter
    // conversion can exceed this function's ~26s budget. Return current
    // suggestions immediately; the client's next refresh picks up new ones.
    try {
      const base = (process.env.URL || "").replace(/\/$/, "");
      const bgToken = (process.env.PUBSUB_VERIFICATION_TOKEN || "").trim();
      await fetch(`${base}/.netlify/functions/sweep-background?token=${encodeURIComponent(bgToken)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: tokens.email })
      });
      const data = await loadMailSuggestions(serviceKey, userId);
      return json(200, { started: true, scanned: 0, added: 0, suggestions: data.suggestions });
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
      // peek = background prefetch: reading ahead must never mark mail read
      const firstUnread = (thread.messages || []).find((m) => (m.labelIds || []).includes("UNREAD"));
      if (firstUnread && !body.peek) await gFetch(gToken, `/messages/${firstUnread.id}/modify`, "POST", { removeLabelIds: ["UNREAD"] });
      return json(200, { thread: normalizeThread(thread) });
    }

    const r = await gFetch(gToken, `/messages/${messageId}?format=full`);
    if (!r.ok) return json(502, { error: "Gmail message fetch failed." });
    return json(200, { message: normalizeMessage(await r.json()) });
  }

  if (action === "send") {
    const { to, subject, body: emailBody, html, inReplyTo, references, threadId, forwardFrom } = body;
    if (!to || (!emailBody && !html)) return json(400, { error: "to and body required" });

    // Forwarding: fetch the original message's attachments (regular + inline
    // cid images) up to a total cap; anything skipped is named in the message.
    let attachments = [];
    let skipped = [];
    if (forwardFrom) {
      const CAP_BYTES = 8 * 1024 * 1024;
      const msgRes = await gFetch(gToken, `/messages/${forwardFrom}?format=full`);
      if (msgRes.ok) {
        const msg = await msgRes.json();
        const parts = collectAttachmentParts(msg.payload);
        let used = 0;
        for (const p of parts) {
          if (used + (p.size || 0) > CAP_BYTES) { skipped.push(p.filename || "inline image"); continue; }
          const aRes = await gFetch(gToken, `/messages/${forwardFrom}/attachments/${p.attachmentId}`);
          if (!aRes.ok) { skipped.push(p.filename || "inline image"); continue; }
          const aData = await aRes.json();
          attachments.push({ ...p, data: aData.data });
          used += p.size || 0;
        }
      } else {
        skipped.push("(original message unavailable — no attachments included)");
      }
    }

    let finalBody = emailBody;
    let finalHtml = html;
    const namedSkips = skipped.filter((s) => s && !s.startsWith("("));
    if (skipped.length) {
      const note = namedSkips.length
        ? `Attachments not included (too large or unavailable): ${namedSkips.join(", ")}`
        : skipped[0];
      finalBody = `${emailBody || ""}\n\n[${note}]`;
      if (finalHtml) finalHtml += `<br><p style="color:#5f6368;font-size:12px">[${note}]</p>`;
    }

    const mimeOpts = { from: tokens.email, to, subject, body: finalBody, html: finalHtml, inReplyTo, references, attachments };

    let r;
    if (attachments.length) {
      // Attachment-bearing mail goes through the media upload endpoint, which
      // accepts far larger messages than the JSON raw field.
      r = await fetch("https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media", {
        method: "POST",
        headers: { Authorization: `Bearer ${gToken}`, "Content-Type": "message/rfc822" },
        body: buildMimeMessage(mimeOpts)
      });
    } else {
      const payload = { raw: buildRaw(mimeOpts) };
      if (threadId) payload.threadId = threadId;
      r = await gFetch(gToken, `/messages/send`, "POST", payload);
    }
    if (!r.ok) { const e = await r.json().catch(() => ({})); return json(502, { error: e.error?.message || "Send failed." }); }
    return json(200, { ok: true, attached: attachments.length, skipped: namedSkips });
  }

  if (action === "labels") {
    const r = await gFetch(gToken, "/labels");
    if (!r.ok) return json(502, { error: "Labels fetch failed." });
    const data = await r.json();
    return json(200, { labels: data.labels || [] });
  }

  if (action === "createLabel") {
    const name = String(body.name || "").trim();
    if (!name) return json(400, { error: "name required" });
    const r = await gFetch(gToken, "/labels", "POST", { name, labelListVisibility: "labelShow", messageListVisibility: "show" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(502, { error: data.error?.message || "Could not create folder." });
    return json(200, { label: data });
  }

  if (action === "renameLabel") {
    const name = String(body.name || "").trim();
    if (!body.labelId || !name) return json(400, { error: "labelId and name required" });
    const r = await gFetch(gToken, `/labels/${body.labelId}`, "PATCH", { name });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return json(502, { error: data.error?.message || "Could not rename folder." });
    return json(200, { label: data });
  }

  if (action === "deleteLabel") {
    if (!body.labelId) return json(400, { error: "labelId required" });
    const r = await gFetch(gToken, `/labels/${body.labelId}`, "DELETE");
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return json(502, { error: data.error?.message || "Could not delete folder." });
    }
    return json(200, { ok: true });
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

  if (action === "snooze") {
    // Emulated snooze (no native API): park under "Snoozed" out of the inbox
    // and record the wake time; the 15-min scheduler brings it back.
    const { threadId, wakeAt } = body;
    const wake = new Date(wakeAt || 0);
    if (!threadId || !(wake.getTime() > Date.now())) return json(400, { error: "threadId and a future wakeAt required" });
    const labelId = await findOrCreateSnoozedLabel(gToken);
    const threadRes = await gFetch(gToken, `/threads/${encodeURIComponent(threadId)}?format=minimal`);
    if (!threadRes.ok) return json(502, { error: "Thread fetch failed." });
    const thread = await threadRes.json();
    await Promise.all((thread.messages || []).map((m) =>
      gFetch(gToken, `/messages/${m.id}/modify`, "POST", { addLabelIds: labelId ? [labelId] : [], removeLabelIds: ["INBOX"] })
    ));
    const snoozes = (await loadSnoozes(serviceKey, userId)).filter((s) => s.threadId !== threadId);
    snoozes.push({ threadId, wakeAt: wake.toISOString(), snoozedAt: new Date().toISOString() });
    await saveSnoozes(serviceKey, userId, snoozes);
    return json(200, { ok: true, wakeAt: wake.toISOString() });
  }

  if (action === "unsnooze") {
    // Wake a snoozed thread now: back to the inbox, drop the Snoozed label and
    // the wake record. Also the reverse used by the "Undo" on a snooze.
    const { threadId } = body;
    if (!threadId) return json(400, { error: "threadId required" });
    const labelId = await findOrCreateSnoozedLabel(gToken);
    try { await modifyWholeThread(gToken, threadId, ["INBOX"], labelId ? [labelId] : []); }
    catch (e) { return json(502, { error: e.message || "Thread update failed." }); }
    const snoozes = (await loadSnoozes(serviceKey, userId)).filter((s) => s.threadId !== threadId);
    await saveSnoozes(serviceKey, userId, snoozes);
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
    references: hdrs.references || "",
    attachments: collectAttachmentParts(msg.payload)
  };
}

// Walks a message payload tree collecting every attachment part —
// both regular attachments and inline (cid-referenced) images.
function collectAttachmentParts(payload, out = []) {
  if (!payload) return out;
  if (payload.body?.attachmentId) {
    const h = headersMap(payload.headers || []);
    const contentId = (h["content-id"] || "").replace(/[<>]/g, "");
    out.push({
      attachmentId: payload.body.attachmentId,
      filename: payload.filename || "",
      mimeType: payload.mimeType || "application/octet-stream",
      size: payload.body.size || 0,
      contentId,
      inline: /inline/i.test(h["content-disposition"] || "") || (!!contentId && !payload.filename)
    });
  }
  (payload.parts || []).forEach((p) => collectAttachmentParts(p, out));
  return out;
}

// Builds a complete RFC 822 message. Structure adapts to content:
//   plain text only            → text/plain
//   + html                     → multipart/alternative
//   + inline (cid) images      → multipart/related wrapping the alternative
//   + regular attachments      → multipart/mixed wrapping everything
function buildMimeMessage({ from, to, subject, body, html, inReplyTo, references, attachments = [] }) {
  const CRLF = "\r\n";
  const bnd = (p) => `live-${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const b64Std = (b64url) => String(b64url || "").replace(/-/g, "+").replace(/_/g, "/");
  const wrap76 = (s) => s.replace(/(.{76})/g, `$1${CRLF}`);
  const safeName = (n) => String(n || "attachment").replace(/["\r\n]/g, "");

  const topHeaders = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, `MIME-Version: 1.0`];
  if (inReplyTo) topHeaders.push(`In-Reply-To: ${inReplyTo}`);
  if (references) topHeaders.push(`References: ${references}`);

  const attachmentPart = (a, disposition) => [
    `Content-Type: ${a.mimeType}; name="${safeName(a.filename)}"`,
    `Content-Transfer-Encoding: base64`,
    ...(a.contentId ? [`Content-ID: <${a.contentId}>`] : []),
    `Content-Disposition: ${disposition}; filename="${safeName(a.filename)}"`,
    "",
    wrap76(b64Std(a.data))
  ].join(CRLF);

  // Innermost block: the readable message
  let core;
  if (html) {
    const b = bnd("alt");
    core = {
      headers: [`Content-Type: multipart/alternative; boundary="${b}"`],
      body: [
        `--${b}`, `Content-Type: text/plain; charset=UTF-8`, "", body || "", "",
        `--${b}`, `Content-Type: text/html; charset=UTF-8`, "", html, "",
        `--${b}--`
      ].join(CRLF)
    };
  } else {
    core = { headers: [`Content-Type: text/plain; charset=UTF-8`], body: body || "" };
  }

  const inline = attachments.filter((a) => a.inline && a.contentId && a.data);
  const regular = attachments.filter((a) => !(a.inline && a.contentId) && a.data);

  if (inline.length) {
    const b = bnd("rel");
    core = {
      headers: [`Content-Type: multipart/related; boundary="${b}"`],
      body: [
        `--${b}`, ...core.headers, "", core.body, "",
        ...inline.flatMap((a) => [`--${b}`, attachmentPart(a, "inline"), ""]),
        `--${b}--`
      ].join(CRLF)
    };
  }

  if (regular.length) {
    const b = bnd("mix");
    core = {
      headers: [`Content-Type: multipart/mixed; boundary="${b}"`],
      body: [
        `--${b}`, ...core.headers, "", core.body, "",
        ...regular.flatMap((a) => [`--${b}`, attachmentPart(a, "attachment"), ""]),
        `--${b}--`
      ].join(CRLF)
    };
  }

  return [...topHeaders, ...core.headers, "", core.body].join(CRLF);
}

function buildRaw(opts) {
  return Buffer.from(buildMimeMessage(opts)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
