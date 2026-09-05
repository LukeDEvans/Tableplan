// Background pre-synthesis worker (15-min budget). Renders the newest unread
// articles' audio into Storage IN THE CHOSEN KOKORO VOICE, so the app can play
// them instantly (a cache hit — no box round-trip, no cold-start wait). The box
// is ~real-time even at 4 vCPU, so this deliberately runs OFF-SCREEN where latency
// doesn't matter; the user never waits on it.
//
// Idempotent: every chunk is checked against Storage first and skipped if already
// rendered, so repeated runs just top up new articles and resume where a prior run
// was cut off. Kokoro-only (Google is fast + metered). Triggered by presynth-cron.
//
// Writes go through kokoro-store.mjs so the layout is byte-identical to what the
// incremental player reads; text/keys come from the SAME shared helpers the client
// uses (tts-article-text, kokoro-core chunkText, tts-cache-identity) — no drift.

import { resolveVoicePrefs } from "../../voice-prefs.js";
import { resolveProviderVoice } from "../../voice-registry.js";
import { KOKORO_MODEL } from "../../tts-provider.js";
import { prepareArticleListenText } from "../../tts-article-text.mjs";
import { chunkText, sanitizeKey } from "../../kokoro-core.mjs";
import { ttsCacheKey } from "../../tts-cache-identity.js";
import { renderChunkToStorage } from "../../kokoro-store.mjs";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const SECTION_NAMES = ["media", "config"];
const WORKING_SET = 15;        // newest N unread articles to keep rendered
const MAX_SYNTHS = 60;         // hard cap on box calls per run (idempotent skips are free)
const MAX_MS = 13 * 60 * 1000; // stay under the 15-min background cap
const CHUNK_TIMEOUT_MS = 100000; // generous: the first chunk may cold-start the box

export default async () => {
  const started = Date.now();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const kokoroUrl = (process.env.KOKORO_URL || "").trim();
  const kokoroToken = (process.env.KOKORO_TOKEN || "").trim();
  if (!serviceKey || !kokoroUrl || !kokoroToken) { console.log("[presynth] missing env — skip"); return new Response("no env", { status: 200 }); }

  let state;
  try { state = await loadState(serviceKey); }
  catch (e) { console.error("[presynth] state load failed:", e.message); return new Response("state fail", { status: 200 }); }

  const prefs = resolveVoicePrefs(state?.aiSettings || {}, "article");
  const voice = resolveProviderVoice(prefs.voiceId);
  if (!voice || voice.provider !== "kokoro") { console.log(`[presynth] article voice is ${prefs.voiceId} (not kokoro) — nothing to pre-render`); return new Response("not kokoro", { status: 200 }); }

  const readIds = new Set(Array.isArray(state.readArticleIds) ? state.readArticleIds : []);
  const articles = (Array.isArray(state.savedArticles) ? state.savedArticles : [])
    .filter(a => a && a.text && !readIds.has(a.id))
    .sort((a, b) => String(b.savedAt || b.pubDate || "").localeCompare(String(a.savedAt || a.pubDate || "")))
    .slice(0, WORKING_SET);

  let synths = 0, cached = 0, failed = 0, articlesTouched = 0;
  outer: for (const article of articles) {
    const prepared = prepareArticleListenText(article);
    if (!prepared) continue;
    articlesTouched++;
    for (const chunk of chunkText(prepared.text)) {
      if (synths >= MAX_SYNTHS || Date.now() - started > MAX_MS) { console.log("[presynth] budget reached"); break outer; }
      const keyPrefix = sanitizeKey(ttsCacheKey({ text: chunk, provider: "kokoro", providerVoiceId: voice.providerVoiceId, model: KOKORO_MODEL, speed: prefs.speed, speedInAudio: false }));
      try {
        const r = await renderChunkToStorage({ keyPrefix, text: chunk, voice: voice.providerVoiceId, speed: prefs.speed, kokoroUrl, kokoroToken, serviceKey, timeoutMs: CHUNK_TIMEOUT_MS });
        if (r.cached) cached++; else synths++;
      } catch (e) {
        failed++;
        console.warn(`[presynth] chunk failed (${e.kokoroCode || e.message}) — continuing`);
        // A failure early on is likely a still-cold box; keep going, next chunks warm it.
      }
    }
  }
  console.log(`[presynth] voice=${prefs.voiceId} articles=${articlesTouched}/${articles.length} synthesized=${synths} alreadyCached=${cached} failed=${failed} ms=${Date.now() - started}`);
  return new Response("ok", { status: 200 });
};

// Household rows overlaid with the admin's personal rows (same as the other jobs).
async function loadState(serviceKey) {
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=not.in.(email_schedule_log,push_schedule_log)&select=id,updated_at&order=updated_at.desc&limit=20`, { headers });
  if (!listRes.ok) throw new Error(`list ${listRes.status}`);
  const rows = (await listRes.json()).filter(r => !/^(gmail_|mailsugg_|mailai_|u-|backup-)/.test(r.id) && r.id.includes(":"));
  if (!rows.length) return null;
  const baseId = rows[0].id.split(":")[0];
  const adminUid = await getAdminUid(headers, baseId);
  const ids = [...SECTION_NAMES.map(s => `${baseId}:${s}`), ...(adminUid ? SECTION_NAMES.map(s => `u-${adminUid}:${s}`) : [])].join(",");
  const sectionRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=in.(${encodeURIComponent(ids)})&select=id,state`, { headers });
  if (!sectionRes.ok) throw new Error(`sections ${sectionRes.status}`);
  const sections = await sectionRes.json();
  const assembled = {}, overlay = {};
  for (const row of sections) { const { stateUpdatedAt, ...data } = row.state || {}; Object.assign(row.id.startsWith("u-") ? overlay : assembled, data); }
  for (const [k, v] of Object.entries(overlay)) {
    const empty = v == null || (Array.isArray(v) && !v.length) || (typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    if (!empty || !(k in assembled)) assembled[k] = v;
  }
  return assembled;
}
async function getAdminUid(headers, groupId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/live_group_members?group_id=eq.${encodeURIComponent(groupId)}&role=eq.admin&select=user_id&limit=1`, { headers });
    if (!r.ok) return null;
    return (await r.json())[0]?.user_id || null;
  } catch { return null; }
}
