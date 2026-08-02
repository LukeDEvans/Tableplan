// Shared Gmail helpers used by gmail.js, gmail-webhook.js and gmail-watch-rearm.js.
// Files prefixed with _ are not deployed as individual functions.
const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

// Sweep guardrails (added after the 2026-07-30 storm). A sweep files inbox mail,
// which makes Gmail emit a new push notification → another sweep; combined with
// aggressive Pub/Sub retries this snowballed until the Supabase pool was pinned.
// These cap how often a user can be swept and stop two sweeps overlapping.
const SWEEP_MIN_INTERVAL_MS = 30_000;   // at most one sweep per user per 30s
const SWEEP_STALE_MS = 5 * 60_000;      // an in-progress lock older than this is treated as dead
const { scanBookingFromEmailText } = require("../../booking-scan");
const { claudeCall } = require("./_claude");
const { recipeSourceForSender, extractRecipes, handleExtractedRecipes, aiTrashTestMode, findAiTrashLabelId, disposeProcessedEmail, enabledRecipeSources } = require("./_recipe-digest");
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
  // Maintain the email→userId index so the webhook can look this user up
  // directly instead of scanning every gmail_ row on every notification.
  if (tokens?.email) { try { await saveGmailEmailIndex(serviceKey, tokens.email, userId); } catch { /* best effort */ } }
}

// email → { userId } index (id = gmailidx_<lowercased-email>), so a Pub/Sub
// notification (which only carries the address) resolves to a user with a
// single keyed read instead of a full-table scan.
async function saveGmailEmailIndex(serviceKey, email, userId) {
  const key = String(email || "").toLowerCase();
  if (!key) return;
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `gmailidx_${key}`, state: { userId, email: key } })
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
// whose notifications only carry the email address). Fast path: the email index
// (one keyed read). Fallback: a full scan, but only when the index misses — and
// it backfills the index so the next lookup is direct. The old unconditional
// full scan on every notification was the engine of the 2026-07-30 storm.
async function findGmailUserByEmail(serviceKey, email) {
  if (!email) return null;
  const key = email.toLowerCase();
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.gmailidx_${encodeURIComponent(key)}&select=state`, {
      headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" }
    });
    const rows = await res.json().catch(() => []);
    const userId = rows[0]?.state?.userId;
    if (userId) {
      const tokens = await loadUserGmailTokens(serviceKey, userId);
      if (tokens?.refreshToken && (tokens.email || "").toLowerCase() === key) return { userId, tokens };
    }
  } catch { /* fall through to scan */ }
  const users = await listGmailUsers(serviceKey);
  const match = users.find((u) => (u.tokens.email || "").toLowerCase() === key) || null;
  if (match) { try { await saveGmailEmailIndex(serviceKey, match.tokens.email, match.userId); } catch { /* best effort */ } }
  return match;
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

// Bundle many GET sub-requests into ONE HTTP call to Gmail's batch endpoint.
// `paths` are the same GMAIL_BASE-relative paths gFetch takes (e.g.
// "/threads/ID?format=metadata"). Returns an array aligned to `paths`: each
// entry is the parsed JSON body, or null if that sub-request failed/couldn't be
// matched. This turns a 50-row inbox page (50 round trips) into a single one.
// Gmail caps a batch at 100 sub-requests, so we chunk; on any transport-level
// failure we fall back to individual gFetch calls so a bad batch never blanks
// the list.
async function gBatchGet(token, paths) {
  if (!paths.length) return [];
  const CHUNK = 100;
  if (paths.length > CHUNK) {
    const out = [];
    for (let i = 0; i < paths.length; i += CHUNK) {
      out.push(...await gBatchGet(token, paths.slice(i, i + CHUNK)));
    }
    return out;
  }

  const boundary = "batch_" + Math.random().toString(36).slice(2);
  const body = paths.map((p, i) =>
    `--${boundary}\r\n` +
    `Content-Type: application/http\r\n` +
    `Content-ID: <item-${i}>\r\n\r\n` +
    `GET /gmail/v1/users/me${p}\r\n`
  ).join("") + `--${boundary}--`;

  // Slower, correct path: fetch each sub-request on its own. This is the
  // pre-batch behaviour, used as a safety net whenever the batch can't be
  // trusted (transport error, or a 200 whose body we couldn't parse).
  const fetchIndividually = () => Promise.all(paths.map(async (p) => {
    try { const r = await gFetch(token, p); return r.ok ? await r.json() : null; }
    catch { return null; }
  }));

  let res = null;
  try {
    res = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/mixed; boundary=${boundary}` },
      body
    });
  } catch { res = null; }

  if (!res || !res.ok) return fetchIndividually();

  const text = await res.text();
  const ctMatch = (res.headers.get("content-type") || "").match(/boundary=([^;]+)/);
  const respBoundary = ctMatch ? ctMatch[1].trim().replace(/^"|"$/g, "") : null;
  if (!respBoundary) return fetchIndividually();

  const out = new Array(paths.length).fill(null);
  for (const part of text.split(`--${respBoundary}`)) {
    if (!part.trim() || part.trim() === "--") continue;
    // Gmail echoes each request's Content-ID back prefixed with "response-",
    // which is how we realign responses to request order.
    const idMatch = part.match(/Content-ID:\s*<?(?:response-)?item-(\d+)>?/i);
    const idx = idMatch ? Number(idMatch[1]) : -1;
    if (idx < 0 || idx >= out.length) continue;
    // The sub-response is HTTP headers, a blank line, then the JSON body; no
    // braces appear before the body, so first "{" … last "}" is the payload.
    const start = part.indexOf("{");
    const end = part.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try { out[idx] = JSON.parse(part.slice(start, end + 1)); } catch { /* leave null */ }
  }

  // Fail safe: if we parsed NOTHING out of a non-empty batch, the response
  // format wasn't what we expected — fall back rather than return an empty
  // inbox. (A batch where every sub-request legitimately 404s is rare and would
  // just re-fail individually, i.e. no worse.)
  if (out.every((x) => x === null)) return fetchIndividually();
  return out;
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
    attempts: (state.attempts && typeof state.attempts === "object" && !Array.isArray(state.attempts)) ? state.attempts : {},
    suggestions: Array.isArray(state.suggestions) ? state.suggestions : [],
    lastSweepAt: state.lastSweepAt || 0,      // when the last sweep finished (debounce)
    sweepStartedAt: state.sweepStartedAt || 0 // in-progress lock; 0 = no sweep running
  };
}

// Returns true on success. The sweep's concurrency lock and checkpoint both
// rely on this write landing, so callers check the result and fail closed.
async function saveMailSuggestions(serviceKey, userId, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `mailsugg_${userId}`, state: data, updated_at: new Date().toISOString() })
  });
  // A silently-failing checkpoint write is exactly what let the sweep reprocess
  // (and re-spend on) the same emails — surface it loudly.
  if (!res.ok) console.error(`[sweep] checkpoint save failed ${res.status} for ${userId}`);
  return res.ok;
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

// ─── Email receipt extraction (mailAiSettings.receiptExtract, default on) ────
// Order-confirmation emails get itemized by Claude, each item assigned one of
// the household's budget categories, and the result stored per household in
// the service-only row finreceipts_<groupId>. The Finance page matches
// receipts to bank transactions by total+date and prefills the split editor.
const RECEIPT_HINT_RE = /receipt|your order|order confirm|order #|purchase confirmation|thanks for (your |shopping)|e-receipt|order has (shipped|been placed)/i;

async function loadReceiptContext(serviceKey, userId, mailAi) {
  if (mailAi.receiptExtract === false) return null;
  try {
    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" };
    const gRes = await fetch(`${SUPABASE_URL}/rest/v1/live_group_members?user_id=eq.${encodeURIComponent(userId)}&select=group_id&limit=1`, { headers });
    if (!gRes.ok) return null;
    const groupId = (await gRes.json())[0]?.group_id;
    if (!groupId) return null;
    const fRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(groupId + ":finance")}&select=state`, { headers });
    const rows = fRes.ok ? await fRes.json() : [];
    const groups = rows[0]?.state?.financeBudgetGroups || [];
    const categories = groups.flatMap((g) => (g.categories || []).map((c) => ({ key: `cat:${g.id}:${c.id}`, name: `${g.label} · ${c.name}` })));
    return categories.length ? { groupId, categories } : null;
  } catch { return null; }
}

async function extractReceipt(anthropicKey, { subject, from, date, bodyText, categories }) {
  const system = [
    "You extract purchase receipts / order confirmations from emails for a household budget app.",
    'Reply with ONLY valid JSON, no markdown: {"receipt": {...}} or {"receipt": null}.',
    "Return null unless the email contains an itemized purchase with a charged total.",
    'Receipt shape: {"merchant": "...", "date": "YYYY-MM-DD", "total": 12.34, "items": [{"name": "...", "price": 1.23, "category": "<key>" or null}]}',
    "total = the amount actually charged (after tax, shipping, discounts).",
    "Assign each item the best-fitting budget category key from this list; use null when unsure:",
    categories.map((c) => `${c.key} = ${c.name}`).join("\n")
  ].join("\n");
  const user = `Subject: ${subject}\nFrom: ${from}\nDate: ${date}\n\n${(bodyText || "").slice(0, 9000)}`;
  const text = await claudeCall(anthropicKey, { system, user, maxTokens: 1500 });
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let parsed;
  try { parsed = JSON.parse(m[0]); } catch { return null; }
  const r = parsed.receipt;
  if (!r || !Number(r.total)) return null;
  const validKeys = new Set(categories.map((c) => c.key));
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 60).map((it) => ({
    name: String(it.name || "").slice(0, 80),
    price: Math.round((Number(it.price) || 0) * 100) / 100,
    category: validKeys.has(it.category) ? it.category : ""
  }));
  // Portions = per-category item sums; uncategorized items plus the
  // tax/shipping remainder form one unlabeled portion for the user to assign.
  const byCat = {};
  let assigned = 0;
  for (const it of items) {
    if (!it.category || !it.price) continue;
    byCat[it.category] = Math.round(((byCat[it.category] || 0) + it.price) * 100) / 100;
    assigned += it.price;
  }
  const portions = Object.entries(byCat).map(([label, amount]) => ({ label, amount }));
  const remainder = Math.round((Number(r.total) - assigned) * 100) / 100;
  if (remainder > 0.02) portions.push({ label: "", amount: remainder });
  return {
    merchant: String(r.merchant || "").slice(0, 60),
    date: /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : "",
    total: Math.round(Number(r.total) * 100) / 100,
    items,
    portions,
    at: new Date().toISOString()
  };
}

async function saveFinanceReceipts(serviceKey, groupId, newReceipts) {
  const { updateRawRow } = require("./_state-sections.js");
  await updateRawRow(serviceKey, `finreceipts_${groupId}`, (s) => {
    const existing = s.receipts || [];
    const seen = new Set(existing.map((r) => r.id));
    return { receipts: [...newReceipts.filter((r) => !seen.has(r.id)), ...existing].slice(0, 40) };
  });
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

  const sugg = await loadMailSuggestions(serviceKey, userId);

  // ── Concurrency + debounce guard (prevents the 2026-07-30 self-amplifying
  //    sweep→notification→sweep storm). Cheap, and runs before any Gmail/AI work. ──
  const nowMs = Date.now();
  const startedMs = sugg.sweepStartedAt ? new Date(sugg.sweepStartedAt).getTime() : 0;
  const lastMs = sugg.lastSweepAt ? new Date(sugg.lastSweepAt).getTime() : 0;
  if (startedMs && nowMs - startedMs < SWEEP_STALE_MS) return { scanned: 0, added: 0, skipped: "in-progress" };
  if (lastMs && nowMs - lastMs < SWEEP_MIN_INTERVAL_MS) return { scanned: 0, added: 0, skipped: "debounced" };
  // Claim the slot up front so concurrent invocations back off. Fail closed if
  // the write doesn't land — never pile sweeps onto a struggling database.
  sugg.sweepStartedAt = new Date(nowMs).toISOString();
  if (!(await saveMailSuggestions(serviceKey, userId, sugg))) return { scanned: 0, added: 0, skipped: "store-unavailable" };

  const { token: gToken, invalidGrant } = await getValidAccessToken(tokens, serviceKey, userId);
  if (invalidGrant) throw new Error("Gmail connection expired — please reconnect.");
  if (!gToken) throw new Error("Could not get Gmail access token.");

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

  // Bounded retries: count each attempt, and give up on a message once it has
  // been tried MAX_MSG_ATTEMPTS times. This is the hard stop against a
  // conversion that keeps failing (or a sweep that dies before checkpointing)
  // reconverting the same email forever and burning tokens on every trigger.
  const MAX_MSG_ATTEMPTS = 2;
  const attempts = { ...sugg.attempts };
  for (const id of fresh) attempts[id] = (attempts[id] || 0) + 1;
  const giveUp = new Set(fresh.filter((id) => attempts[id] > MAX_MSG_ATTEMPTS));

  // Mail AI feature flags (config state section)
  const appCfg = await loadAppConfig(serviceKey, userId);
  const mailAi = appCfg?.mailAiSettings || {};
  const testMode = aiTrashTestMode(mailAi);
  const autoDeleteSimplefin = mailAi.autoDeleteSimplefin === true;
  const aiTrashLabelId = ((enabledRecipeSources(mailAi).length || autoDeleteSimplefin) && testMode)
    ? await findAiTrashLabelId(gFetch, gToken)
    : null;
  const receiptCtx = anthropicKey ? await loadReceiptContext(serviceKey, userId, mailAi) : null;

  // Messages are processed in parallel so the sweep stays within the Netlify
  // function time limit even at the 10-message cap. Each returns
  // { suggestions, retry? } — retry leaves the message unprocessed so the
  // next sweep tries again (e.g. a transient conversion failure).
  const perMessage = await Promise.all(fresh.map(async (messageId) => {
    // Exhausted its retries — give up (mark processed) without any Claude work.
    if (giveUp.has(messageId)) { console.warn(`[sweep] giving up on ${messageId} after ${MAX_MSG_ATTEMPTS} attempts`); return { suggestions: [] }; }
    const r = await gFetch(gToken, `/messages/${messageId}?format=full`);
    if (!r.ok) {
      // 404/410 → the message was deleted; retrying forever would pin a dead
      // ID in the queue. Treat it as processed so it ages out. Other errors
      // (auth, rate limit, 5xx) are transient and do warrant a retry.
      const gone = r.status === 404 || r.status === 410;
      return { suggestions: [], retry: !gone };
    }
    const msg = await r.json();
    const hdrs = headersMap(msg.payload?.headers);
    const fromSelf = tokens.email && (hdrs.from || "").toLowerCase().includes(tokens.email.toLowerCase());
    if (fromSelf) return { suggestions: [] };

    // Opt-in: auto-delete SimpleFIN Bridge's "Transaction data accessed from
    // new IP" alerts, which fire on every account sync. Matched narrowly (this
    // sender + this subject) so no other SimpleFIN mail is ever touched.
    if (autoDeleteSimplefin &&
        /(^|[<@.])simplefin\.org\b/i.test(hdrs.from || "") &&
        /transaction data accessed/i.test(hdrs.subject || "")) {
      const filed = await disposeProcessedEmail(gFetch, gToken, messageId, { testMode, aiTrashLabelId });
      if (!filed) return { suggestions: [], retry: true }; // e.g. AI-trash label missing — try again next sweep
      console.log(`[simplefin-autodelete] disposed ${messageId} (${testMode ? "AI trash" : "trash"})`);
      return { suggestions: [] };
    }

    const rawBody = extractBody(msg.payload) || "";

    // Recipe digests: collect recipe links and file the email away right away
    // (the collection is persisted before disposal, so nothing can be lost)
    const recipeSource = recipeSourceForSender(hdrs.from, mailAi);
    if (recipeSource) {
      try {
        const recipes = await extractRecipes(rawBody, recipeSource);
        if (recipes.length) {
          const result = await handleExtractedRecipes(serviceKey, userId, mailAi, anthropicKey, recipes);
          await disposeProcessedEmail(gFetch, gToken, messageId, { testMode, aiTrashLabelId });
          console.log(`[recipe-digest] ${recipeSource.name}: queued ${result.queued}, filtered ${result.filtered}, health ${result.health} from message ${messageId} (${testMode ? "AI trash" : "trash"})`);
          return { suggestions: [] };
        }
      } catch (e) {
        console.error(`[recipe-digest] ${recipeSource.name} failed — email left in place for retry:`, e.message);
        return { suggestions: [], retry: true };
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
          // Recorded at the email's arrival time so it sorts by when it
          // actually showed up, not when the sweep converted it.
          savedAt: (hdrs.date && !isNaN(new Date(hdrs.date)) ? new Date(hdrs.date) : new Date()).toISOString(),
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

    // Triage only the NEW text of the message: replies quote the whole
    // thread, and triaging the quoted part re-suggests old action items
    // (e.g. an RSVP request re-flagged on every follow-up).
    const bodyText = stripQuotedReply(htmlToText(rawBody));
    const emailMeta = { subject: hdrs.subject || "(no subject)", from: hdrs.from || "", date: hdrs.date || "" };

    let receipt = null;
    if (receiptCtx && RECEIPT_HINT_RE.test(`${emailMeta.subject} ${emailMeta.from}`)) {
      try {
        receipt = await extractReceipt(anthropicKey, { ...emailMeta, bodyText, categories: receiptCtx.categories });
        if (receipt) {
          receipt.id = messageId;
          console.log(`[receipt] extracted ${receipt.merchant || "?"} $${receipt.total} (${receipt.items.length} items)`);
        }
      } catch (e) {
        console.error("[receipt] extraction failed:", e.message);
      }
    }

    let ideas = [];
    try {
      ideas = await triageEmail(anthropicKey, { ...emailMeta, bodyText });
    } catch (e) {
      console.error("Triage failed for message", messageId, e.message);
      return { suggestions: [], retry: true, receipt };
    }

    const out = [];
    for (let i = 0; i < ideas.length; i++) {
      const idea = ideas[i];
      const suggestion = {
        id: `sg_${messageId}_${i}`,
        messageId,
        threadId: msg.threadId || "",
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
    return { suggestions: out, receipt };
  }));
  const added = perMessage.flatMap((r) => r.suggestions);
  const receipts = perMessage.map((r) => r.receipt).filter(Boolean);
  if (receipts.length && receiptCtx) {
    try { await saveFinanceReceipts(serviceKey, receiptCtx.groupId, receipts); }
    catch (e) { console.error("[receipt] save failed:", e.message); }
  }
  // Messages flagged retry stay out of processedIds so the next sweep retries them
  const processedNow = fresh.filter((_, i) => !perMessage[i].retry);

  const existingIds = new Set(sugg.suggestions.map((s) => s.id));
  // Thread-level dedupe: one suggestion of a given kind per email thread,
  // counting resolved ones too — dismissing an RSVP nag means follow-ups in
  // that thread never re-raise it. Same-title dedupe catches thread repeats
  // recorded before suggestions carried a threadId.
  const normTitle = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const isDuplicate = (s) => sugg.suggestions.some((e) =>
    (s.threadId && e.threadId && e.threadId === s.threadId && e.kind === s.kind) ||
    (e.kind === s.kind && normTitle(e.title) === normTitle(s.title))
  );
  const merged = [...added.filter((s) => !existingIds.has(s.id) && !isDuplicate(s)), ...sugg.suggestions].slice(0, 100);
  const nextRetry = fresh.filter((_, i) => perMessage[i].retry && !giveUp.has(fresh[i])).slice(0, 20);
  // Keep attempt counts only for messages still in the retry queue, so the map
  // can't grow without bound.
  const nextAttempts = {};
  for (const id of nextRetry) nextAttempts[id] = attempts[id];
  await saveMailSuggestions(serviceKey, userId, {
    lastHistoryId: newHistoryId || sugg.lastHistoryId,
    watchExpiration: sugg.watchExpiration,
    processedIds: [...processedNow, ...sugg.processedIds].slice(0, 300),
    retryIds: nextRetry,
    attempts: nextAttempts,
    suggestions: merged,
    lastSweepAt: new Date().toISOString(), // debounce stamp
    sweepStartedAt: 0                       // release the in-progress lock
  });

  return { scanned: fresh.length, added: added.length };
}

// App config (the user's "<groupId>:config" state section — feature flags etc.)
async function loadAppConfig(serviceKey, userId) {
  const { getUserGroupId, loadSection } = require("./_state-sections.js");
  const groupId = await getUserGroupId(serviceKey, userId);
  if (!groupId) return null;
  const row = await loadSection(serviceKey, groupId, "config").catch(() => null);
  return row?.state || null;
}

// Cuts a plain-text email body at the first quoted-reply marker, leaving only
// what the sender newly wrote. Conservative: unrecognized formats pass whole.
function stripQuotedReply(text) {
  const t = String(text || "");
  const markers = [
    /\r?\nOn [^\r\n]{1,140} wrote:\s*\r?\n/, // Gmail/Apple "On Tue, Jul 15, 2026… <x> wrote:"
    /\r?\n-{2,}\s*Original Message\s*-{2,}/i, // Outlook classic
    /\r?\nFrom:\s[^\r\n]{1,200}\r?\n(Sent|Date):\s/i, // Outlook top-quote header
    /\r?\n>{1}\s?[^\r\n]*\r?\n(>{1}\s?[^\r\n]*\r?\n){3,}/ // long ">"-quoted run
  ];
  let cut = t.length;
  for (const re of markers) {
    const m = re.exec(t);
    if (m && m.index < cut) cut = m.index;
  }
  return t.slice(0, cut);
}

// ─── Snooze (emulated — the Gmail API has no native snooze) ──────────────────
// Snoozing removes INBOX and parks the thread under a user "Snoozed" label,
// recording a wake time in row mailsnooze_<userId>. processDueSnoozes (run by
// the every-15-min scheduled function) returns due threads to the inbox,
// marked unread so they surface, and drops the record.

async function loadSnoozes(serviceKey, userId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.mailsnooze_${userId}&select=state`,
    { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json" } }
  );
  if (!res.ok) return [];
  const rows = await res.json();
  return Array.isArray(rows[0]?.state?.snoozes) ? rows[0].state.snoozes : [];
}

async function saveSnoozes(serviceKey, userId, snoozes) {
  await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify({ id: `mailsnooze_${userId}`, state: { snoozes }, updated_at: new Date().toISOString() })
  });
}

async function findOrCreateSnoozedLabel(gToken) {
  const r = await gFetch(gToken, "/labels");
  if (r.ok) {
    const data = await r.json();
    const hit = (data.labels || []).find((l) => l.type === "user" && (l.name || "").toLowerCase() === "snoozed");
    if (hit) return hit.id;
  }
  const c = await gFetch(gToken, "/labels", "POST", { name: "Snoozed", labelListVisibility: "labelShow", messageListVisibility: "show" });
  const made = await c.json().catch(() => ({}));
  return c.ok ? made.id : null;
}

async function modifyWholeThread(gToken, threadId, addLabelIds, removeLabelIds) {
  // Atomic thread-level modify — one request for every message in the thread,
  // so a wake/unsnooze can't partially apply (which used to strand a thread
  // half in/out of the inbox).
  const r = await gFetch(gToken, `/threads/${encodeURIComponent(threadId)}/modify`, "POST", { addLabelIds, removeLabelIds });
  if (!r.ok) throw new Error(`Thread modify failed (${r.status})`);
}

async function processDueSnoozes(serviceKey) {
  const users = await listGmailUsers(serviceKey);
  for (const { userId, tokens } of users) {
    try {
      const snoozes = await loadSnoozes(serviceKey, userId);
      const now = Date.now();
      const due = snoozes.filter((s) => new Date(s.wakeAt).getTime() <= now);
      if (!due.length) continue;
      const { token: gToken } = await getValidAccessToken(tokens, serviceKey, userId);
      if (!gToken) continue;
      const labelId = await findOrCreateSnoozedLabel(gToken);
      const remaining = [...snoozes];
      for (const s of due) {
        try {
          await modifyWholeThread(gToken, s.threadId, ["INBOX", "UNREAD"], labelId ? [labelId] : []);
          const i = remaining.findIndex((x) => x.threadId === s.threadId && x.wakeAt === s.wakeAt);
          if (i !== -1) remaining.splice(i, 1);
          console.log(`[snooze] woke thread ${s.threadId} for ${tokens.email}`);
        } catch (e) {
          // Leave the record in place: the next run retries the wake.
          console.error(`[snooze] wake failed for ${s.threadId}: ${e.message}`);
        }
      }
      if (remaining.length !== snoozes.length) await saveSnoozes(serviceKey, userId, remaining);
    } catch (e) {
      console.error(`[snooze] ${tokens?.email || userId}: ${e.message}`);
    }
  }
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
  gBatchGet,
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
  armGmailWatch,
  loadAppConfig,
  loadSnoozes,
  saveSnoozes,
  findOrCreateSnoozedLabel,
  modifyWholeThread,
  processDueSnoozes
};
