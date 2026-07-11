// Shared Gmail helpers used by gmail.js, gmail-webhook.js and gmail-watch-rearm.js.
// Files prefixed with _ are not deployed as individual functions.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const { scanBookingFromEmailText } = require("../../booking-scan");
const { claudeCall } = require("./_claude");
const { recipeSourceForSender, extractRecipes, appendPendingRecipes, aiTrashTestMode, findAiTrashLabelId, disposeProcessedEmail, enabledRecipeSources } = require("./_recipe-digest");
const { newsSourceForMessage, convertNewsEmailToArticle, saveArticleToMediaSection } = require("./_news-articles");

// ─── Token storage (Supabase tableplan_states, id = gmail_<userId>) ──────────

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

// All connected Gmail users: [{ userId, tokens }]
async function listGmailUsers(serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=like.gmail_*&select=id,state`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  const rows = await res.json().catch(() => []);
  return rows
    .filter((r) => r.id.startsWith("gmail_") && r.state?.refreshToken)
    .map((r) => ({ userId: r.id.slice("gmail_".length), tokens: r.state }));
}

// Find the user whose connected Gmail address matches (used by the Pub/Sub webhook,
// whose notifications only carry the email address).
async function findGmailUserByEmail(serviceKey, email) {
  if (!email) return null;
  const users = await listGmailUsers(serviceKey);
  return users.find((u) => (u.tokens.email || "").toLowerCase() === email.toLowerCase()) || null;
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

async function getValidAccessToken(tokens, serviceKey, userId) {
  if (tokens.accessToken && tokens.expiresAt > Date.now() + 60000) return { token: tokens.accessToken };

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return {};

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ refresh_token: tokens.refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" })
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    console.error("Gmail token refresh failed:", res.status, JSON.stringify(e));
    if (e.error === "invalid_grant") {
      // Refresh token expired or revoked — clear it so the app returns to the Connect view
      await deleteUserGmailTokens(serviceKey, userId);
      return { invalidGrant: true };
    }
    return {};
  }
  const data = await res.json();
  tokens.accessToken = data.access_token;
  tokens.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
  await saveUserGmailTokens(serviceKey, userId, tokens);
  return { token: data.access_token };
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

function htmlToText(html) {
  if (!html) return "";
  if (!/<[a-z][\s\S]*>/i.test(html)) return html;
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

// ─── Suggestions storage (Supabase tableplan_states, id = mailsugg_<userId>) ──

async function loadMailSuggestions(serviceKey, userId) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.mailsugg_${userId}&select=state`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  const rows = await res.json().catch(() => []);
  const state = rows[0]?.state || {};
  return {
    lastHistoryId: state.lastHistoryId || "",
    watchExpiration: state.watchExpiration || 0,
    processedIds: Array.isArray(state.processedIds) ? state.processedIds : [],
    retryIds: Array.isArray(state.retryIds) ? state.retryIds : [],
    suggestions: Array.isArray(state.suggestions) ? state.suggestions : []
  };
}

async function saveMailSuggestions(serviceKey, userId, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `mailsugg_${userId}`, state: data })
  });
}

// ─── AI triage ────────────────────────────────────────────────────────────────

async function triageEmail(anthropicKey, { subject, from, date, bodyText }) {
  const system = [
    "You triage incoming emails for a personal life-management app and suggest concrete in-app actions.",
    'Reply with ONLY valid JSON, no markdown: {"suggestions": [...]}',
    'Each suggestion: {"kind": "add_todo" | "add_booking", "title": "short imperative action", "details": "one line of context", "dueDate": "YYYY-MM-DD" or ""}',
    '"add_booking" is ONLY for confirmations of travel bookings (lodging, flights, rental cars, trains, ferries) worth saving to a trip planner.',
    '"add_todo" is ONLY for things the recipient personally must act on: bills to pay, RSVPs to answer, appointments to confirm or attend, forms or documents to submit or sign, expiring renewals, deliveries requiring action.',
    'Return {"suggestions": []} for marketing, newsletters, promotions, social notifications, receipts that need no action, FYI-only messages, and anything ambiguous.',
    "Be conservative: fewer, higher-confidence suggestions. Most emails deserve none."
  ].join("\n");
  const user = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${(bodyText || "").slice(0, 8000)}`;
  const text = await claudeCall(anthropicKey, { system, user, maxTokens: 512 });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return []; }
  return (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
    .filter((s) => ["add_todo", "add_booking"].includes(s.kind) && s.title)
    .slice(0, 3)
    .map((s) => ({
      kind: s.kind,
      title: String(s.title).slice(0, 140),
      details: String(s.details || "").slice(0, 200),
      dueDate: /^\d{4}-\d{2}-\d{2}$/.test(s.dueDate) ? s.dueDate : ""
    }));
}

// ─── History delta + inbox sweep ─────────────────────────────────────────────

// Returns { ids, historyId } of INBOX messages added since startHistoryId,
// or null when the checkpoint is too old (Gmail returns 404).
async function fetchHistoryDelta(gToken, startHistoryId) {
  const ids = new Set();
  let pageToken;
  let latest = String(startHistoryId);
  do {
    const params = new URLSearchParams({
      startHistoryId: String(startHistoryId),
      historyTypes: "messageAdded",
      labelId: "INBOX",
      maxResults: "100"
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await gFetch(gToken, `/history?${params}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Gmail history failed (${r.status})`);
    const data = await r.json();
    for (const h of data.history || []) {
      for (const m of h.messagesAdded || []) {
        if ((m.message?.labelIds || []).includes("INBOX")) ids.add(m.message.id);
      }
    }
    if (data.historyId) latest = data.historyId;
    pageToken = data.nextPageToken;
  } while (pageToken);
  return { ids: [...ids], historyId: latest };
}

// Fetch new inbox mail since the stored checkpoint, triage each message with
// Claude, and append pending suggestions. Shared by the Pub/Sub webhook, the
// daily re-arm catch-up, and the manual "check now" action.
async function runInboxSweep(tokens, serviceKey, userId, { anthropicKey } = {}) {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured.");
  const { token: gToken, invalidGrant } = await getValidAccessToken(tokens, serviceKey, userId);
  if (invalidGrant) throw new Error("Gmail connection expired — please reconnect.");
  if (!gToken) throw new Error("Could not get Gmail access token.");

  const sugg = await loadMailSuggestions(serviceKey, userId);
  let messageIds = [];
  let newHistoryId = "";

  if (sugg.lastHistoryId) {
    const delta = await fetchHistoryDelta(gToken, sugg.lastHistoryId);
    if (delta) {
      messageIds = delta.ids;
      newHistoryId = delta.historyId;
    }
  }
  if (!newHistoryId) {
    // First run, or the checkpoint expired: look at the last day of inbox mail
    const params = new URLSearchParams({ maxResults: "10", q: "in:inbox newer_than:1d" });
    const r = await gFetch(gToken, `/messages?${params}`);
    if (!r.ok) throw new Error(`Gmail list failed (${r.status})`);
    const data = await r.json();
    messageIds = (data.messages || []).map((m) => m.id);
    const profRes = await gFetch(gToken, "/profile");
    const prof = await profRes.json().catch(() => ({}));
    newHistoryId = String(prof.historyId || "");
  }

  // Messages that previously failed conversion re-enter the sweep here —
  // the history checkpoint has moved past them, so this is their only way back
  messageIds = [...new Set([...(sugg.retryIds || []), ...messageIds])];

  const processed = new Set(sugg.processedIds);
  const fresh = messageIds.filter((id) => !processed.has(id)).slice(0, 10);

  // Mail AI feature flags (config state section)
  const appCfg = await loadAppConfig(serviceKey);
  const mailAi = appCfg?.mailAiSettings || {};
  const testMode = aiTrashTestMode(mailAi);
  const aiTrashLabelId = (enabledRecipeSources(mailAi).length && testMode)
    ? await findAiTrashLabelId(gFetch, gToken)
    : null;

  // Messages are processed in parallel so the sweep stays within the Netlify
  // function time limit even at the 10-message cap. Each returns
  // { suggestions, retry? } — retry leaves the message unprocessed so the
  // next sweep tries again (e.g. a transient conversion failure).
  const perMessage = await Promise.all(fresh.map(async (messageId) => {
    const r = await gFetch(gToken, `/messages/${messageId}?format=full`);
    if (!r.ok) return { suggestions: [], retry: true };
    const msg = await r.json();
    const hdrs = headersMap(msg.payload?.headers);
    const fromSelf = tokens.email && (hdrs.from || "").toLowerCase().includes(tokens.email.toLowerCase());
    if (fromSelf) return { suggestions: [] };
    const rawBody = extractBody(msg.payload) || "";

    // Recipe digests: collect recipe links and file the email away right away
    // (the collection is persisted before disposal, so nothing can be lost)
    const recipeSource = recipeSourceForSender(hdrs.from, mailAi);
    if (recipeSource) {
      const recipes = await extractRecipes(rawBody, recipeSource);
      if (recipes.length) {
        await appendPendingRecipes(serviceKey, userId, recipes);
        await disposeProcessedEmail(gFetch, gToken, messageId, { testMode, aiTrashLabelId });
        console.log(`[recipe-digest] ${recipeSource.name}: collected ${recipes.length} link(s) from message ${messageId} (${testMode ? "AI trash" : "trash"})`);
        return { suggestions: [] };
      }
    }

    // News → listenable article (The Morning, The world in brief). The
    // article is saved into the media section BEFORE the email is filed away.
    const newsSource = newsSourceForMessage(hdrs.from, hdrs.subject, mailAi);
    if (newsSource) {
      try {
        const articleHtml = await convertNewsEmailToArticle(anthropicKey, newsSource, {
          subject: hdrs.subject || "", date: hdrs.date || "", html: rawBody
        });
        const article = {
          id: "news-" + messageId,
          url: null,
          title: hdrs.subject || newsSource.name,
          author: newsSource.publication,
          date: hdrs.date ? new Date(hdrs.date).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "",
          publication: "email",
          savedAt: new Date().toISOString(),
          text: articleHtml
        };
        await saveArticleToMediaSection(serviceKey, userId, article);
        await disposeProcessedEmail(gFetch, gToken, messageId, { testMode, aiTrashLabelId });
        console.log(`[news-article] ${newsSource.name}: saved "${article.title}" (${testMode ? "AI trash" : "trash"})`);
        return { suggestions: [] };
      } catch (e) {
        console.error(`[news-article] ${newsSource.name} failed — email left in place for retry:`, e.message);
        return { suggestions: [], retry: true };
      }
    }

    const bodyText = htmlToText(rawBody);
    const emailMeta = { subject: hdrs.subject || "(no subject)", from: hdrs.from || "", date: hdrs.date || "" };

    let ideas = [];
    try {
      ideas = await triageEmail(anthropicKey, { ...emailMeta, bodyText });
    } catch (e) {
      console.error("Triage failed for message", messageId, e.message);
      return { suggestions: [], retry: true };
    }

    const out = [];
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      const suggestion = {
        id: `sg_${messageId}_${i}`,
        messageId,
        kind: idea.kind,
        title: idea.title,
        details: idea.details,
        dueDate: idea.dueDate,
        emailSubject: emailMeta.subject,
        emailFrom: emailMeta.from,
        emailDate: emailMeta.date,
        status: "pending",
        createdAt: new Date().toISOString()
      };
      if (idea.kind === "add_booking") {
        try {
          const emailText = `Subject: ${emailMeta.subject}\nFrom: ${emailMeta.from}\nDate: ${emailMeta.date}\n\n${bodyText}`;
          const booking = await scanBookingFromEmailText(emailText, { apiKey: anthropicKey });
          if (!booking) continue; // triage was wrong — not actually a confirmation
          suggestion.booking = booking;
        } catch (e) {
          console.error("Booking extraction failed for message", messageId, e.message);
          continue;
        }
      }
      out.push(suggestion);
    }
    return { suggestions: out };
  }));
  const added = perMessage.flatMap((r) => r.suggestions);
  // Messages flagged retry stay out of processedIds so the next sweep retries them
  const processedNow = fresh.filter((_, i) => !perMessage[i].retry);

  const existingIds = new Set(sugg.suggestions.map((s) => s.id));
  const merged = [...added.filter((s) => !existingIds.has(s.id)), ...sugg.suggestions].slice(0, 100);
  await saveMailSuggestions(serviceKey, userId, {
    lastHistoryId: newHistoryId || sugg.lastHistoryId,
    watchExpiration: sugg.watchExpiration,
    processedIds: [...processedNow, ...sugg.processedIds].slice(0, 300),
    retryIds: fresh.filter((_, i) => perMessage[i].retry).slice(0, 20),
    suggestions: merged
  });

  return { scanned: fresh.length, added: added.length };
}

// App config (the "personal:config" state section — feature flags etc.)
async function loadAppConfig(serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.personal:config&select=state`, {
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
  });
  const rows = await res.json().catch(() => []);
  return rows[0]?.state || null;
}

// ─── Watch (Pub/Sub push subscription) ───────────────────────────────────────

async function armGmailWatch(gToken, topicName) {
  const r = await gFetch(gToken, "/watch", "POST", {
    topicName,
    labelIds: ["INBOX"],
    labelFilterBehavior: "INCLUDE", // current param name; labelFilterAction is the deprecated spelling
    labelFilterAction: "include"
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error?.message || `Gmail watch failed (${r.status})`);
  return data; // { historyId, expiration }
}

module.exports = {
  SUPABASE_URL,
  GMAIL_BASE,
  loadUserGmailTokens,
  saveUserGmailTokens,
  deleteUserGmailTokens,
  listGmailUsers,
  findGmailUserByEmail,
  getUserId,
  getValidAccessToken,
  gFetch,
  headersMap,
  extractBody,
  decodeB64,
  htmlToText,
  cleanSnippet,
  loadMailSuggestions,
  saveMailSuggestions,
  triageEmail,
  fetchHistoryDelta,
  runInboxSweep,
  armGmailWatch
};
