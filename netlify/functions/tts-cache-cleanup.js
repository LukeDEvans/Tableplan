// On-demand + scheduled cleanup of orphaned article-audio (TTS) and reading-content
// (offloaded article body) objects in Storage.
//
// Synthesized article audio is content-addressed: one Storage folder per cache
// key. Nothing prunes folders for removed articles or unused voices, so the bucket
// only grows. This job computes the LIVE set of folders (every current saved
// article × the voices we keep) and deletes the rest. It also sweeps reading-content
// the same way, keyed by each live article's own bodyRef.cloud.path (no hashing
// needed there — the path is already stored on the record).
//
// SAFETY: the audio is fully regenerable — a wrongly-deleted folder just re-synths
// on next play (never user-data loss). The one real hazard is deleting on a failed/
// empty state read, so we abort unless a healthy article set loaded. And deletion
// is itself gated behind TTS_CLEANUP_DELETE=1: by default the job runs in DRY-RUN,
// logging exactly what it WOULD delete, so we can verify in production before ever
// removing anything.
//
// TEXT BACKFILL (fixed 2026-09-21): computing a live article's audio cache key
// needs its spoken text (prepareArticleListenText → ttsCacheKey), but the synced
// `media` row nulls `article.text` once its body is durably offloaded to
// reading-content (the whole point of that offload is to keep the synced row
// small) — which is true for MOST saved articles, read or not. Before this fix,
// any such article's live prefixes silently computed as `[]` (prepareArticleListenText
// returns null with no text), so its ALREADY-CACHED audio looked orphaned and would
// have been deleted the moment TTS_CLEANUP_DELETE was ever turned on — actively
// working against the "instant playback" goal this whole cache exists for. Now we
// backfill missing text from reading-content before computing prefixes, and abort
// the whole run (rather than proceed with a partial/wrong live set) if any live
// article's body can't be fetched.

import { resolveVoicePrefs } from "../../voice-prefs.js";
import { resolveProviderVoice } from "../../voice-registry.js";
import { GOOGLE_MODEL, KOKORO_MODEL } from "../../tts-provider.js";
import { liveAudioPrefixes, partitionAudioFolders } from "../../tts-cache-sweep.mjs";

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const AUDIO_BUCKET = "article-audio";
const READING_CONTENT_BUCKET = "reading-content";
const SECTION_NAMES = ["media", "config"]; // savedArticles live in `media`, aiSettings in `config`

export default async () => {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) { console.log("[tts-cleanup] no service key"); return new Response("no key", { status: 200 }); }
  const deleteEnabled = process.env.TTS_CLEANUP_DELETE === "1";
  const allowEmpty = process.env.TTS_CLEANUP_ALLOW_EMPTY === "1";
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, Accept: "application/json" };

  let state;
  try { state = await loadState(headers); }
  catch (e) { console.error("[tts-cleanup] state load failed:", e.message); return new Response("state fail", { status: 200 }); }

  const rawArticles = Array.isArray(state?.savedArticles) ? state.savedArticles : null;
  if (!rawArticles) { console.error("[tts-cleanup] no savedArticles — aborting (won't sweep on a bad read)"); return new Response("no articles", { status: 200 }); }
  if (rawArticles.length === 0 && !allowEmpty) { console.log("[tts-cleanup] savedArticles empty — aborting (set TTS_CLEANUP_ALLOW_EMPTY=1 to sweep anyway)"); return new Response("empty", { status: 200 }); }

  const backfill = await backfillArticleText(headers, rawArticles);
  if (!backfill.ok) {
    console.error(`[tts-cleanup] ${backfill.failed} article body fetch(es) failed — aborting rather than sweep with an incomplete live set (would misclassify their cached audio as orphaned).`);
    return new Response("backfill fail", { status: 200 });
  }
  const articles = backfill.articles;

  // Voices to KEEP: the user's current article voice + the always-on Google
  // fallback, so switching back to either never needs a re-synth. Everything else
  // (old experiments, legacy keys) is orphaned and reclaimable.
  const prefs = resolveVoicePrefs(state.aiSettings || {}, "article");
  const cur = resolveProviderVoice(prefs.voiceId);
  const voices = [];
  if (cur) voices.push({ provider: cur.provider, providerVoiceId: cur.providerVoiceId, model: cur.provider === "kokoro" ? KOKORO_MODEL : GOOGLE_MODEL, speed: prefs.speed });
  voices.push({ provider: "google", providerVoiceId: "en-US-Neural2-D", model: GOOGLE_MODEL, speed: 1 });

  const live = liveAudioPrefixes(articles, voices);
  let folders;
  try { folders = await listTopFolders(headers, AUDIO_BUCKET); }
  catch (e) { console.error("[tts-cleanup] storage list failed:", e.message); return new Response("list fail", { status: 200 }); }

  const { keep, orphan } = partitionAudioFolders(folders, live);
  console.log(`[tts-cleanup] articles=${articles.length} voice=${prefs.voiceId} folders=${folders.length} live=${live.size} keep=${keep.length} orphan=${orphan.length} mode=${deleteEnabled ? "DELETE" : "DRY-RUN"}`);
  if (orphan.length) console.log("[tts-cleanup] orphan sample:", orphan.slice(0, 10).join(", "));

  // reading-content: live set is just every current article's own offloaded-body
  // path (already stored on the record — no hashing/backfill needed here).
  const liveContentPaths = new Set(articles.map((a) => a?.bodyRef?.cloud?.path).filter(Boolean));
  let contentObjects;
  try { contentObjects = await listAt(headers, READING_CONTENT_BUCKET, ""); }
  catch (e) { console.error("[tts-cleanup] reading-content list failed:", e.message); contentObjects = null; }
  const orphanContentPaths = contentObjects ? contentObjects.map((o) => o.name).filter((p) => p && !liveContentPaths.has(p)) : [];
  console.log(`[tts-cleanup] reading-content objects=${contentObjects?.length ?? "?"} live=${liveContentPaths.size} orphan=${orphanContentPaths.length}`);

  if (!deleteEnabled) { console.log("[tts-cleanup] dry-run — nothing deleted. Set TTS_CLEANUP_DELETE=1 to enable."); return new Response("dry-run", { status: 200 }); }

  let deletedFolders = 0, deletedFiles = 0;
  for (const folder of orphan) {
    try {
      const files = await listFolderFiles(headers, AUDIO_BUCKET, folder);
      if (!files.length) continue;
      await deletePaths(headers, AUDIO_BUCKET, files);
      deletedFolders++; deletedFiles += files.length;
    } catch (e) {
      console.error(`[tts-cleanup] delete failed for ${folder}:`, e.message);
    }
  }
  console.log(`[tts-cleanup] deleted ${deletedFiles} files across ${deletedFolders} folders`);

  if (orphanContentPaths.length) {
    try {
      await deletePaths(headers, READING_CONTENT_BUCKET, orphanContentPaths);
      console.log(`[tts-cleanup] deleted ${orphanContentPaths.length} orphaned reading-content object(s)`);
    } catch (e) {
      console.error("[tts-cleanup] reading-content delete failed:", e.message);
    }
  }
  return new Response("ok", { status: 200 });
};

// Fetch spoken text for any article missing it (its body was durably offloaded and
// nulled from the synced row — normal, not an error) so its audio cache key can
// still be computed. Returns { ok:false, failed } if any such fetch fails, so the
// caller aborts the whole sweep rather than risk deleting still-live audio.
async function backfillArticleText(headers, articles) {
  let failed = 0;
  const out = [];
  for (const a of articles) {
    if (!a || a.text || !a?.bodyRef?.cloud?.path) { out.push(a); continue; }
    try {
      const bucket = a.bodyRef.cloud.bucket || READING_CONTENT_BUCKET;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${a.bodyRef.cloud.path}`, { headers });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      out.push({ ...a, text: await res.text() });
    } catch (e) {
      failed++;
      console.error(`[tts-cleanup] body backfill failed for article ${a.id}:`, e.message);
      out.push(a); // stays textless; caller aborts on any failure anyway
    }
  }
  return { ok: failed === 0, failed, articles: out };
}

// ── Supabase state (household rows overlaid with the admin's personal rows) ────
async function loadState(headers) {
  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=not.in.(email_schedule_log,push_schedule_log)&select=id,updated_at&order=updated_at.desc&limit=20`,
    { headers }
  );
  if (!listRes.ok) throw new Error(`list ${listRes.status}`);
  const allRows = await listRes.json();
  const rows = allRows.filter(r => !/^(gmail_|mailsugg_|mailai_|u-|backup-)/.test(r.id) && r.id.includes(":"));
  if (!rows.length) return null;
  const baseId = rows[0].id.split(":")[0];
  const adminUid = await getAdminUid(headers, baseId);
  const ids = [
    ...SECTION_NAMES.map(s => `${baseId}:${s}`),
    ...(adminUid ? SECTION_NAMES.map(s => `u-${adminUid}:${s}`) : []),
  ].join(",");
  const sectionRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tableplan_states?id=in.(${encodeURIComponent(ids)})&select=id,state`,
    { headers }
  );
  if (!sectionRes.ok) throw new Error(`sections ${sectionRes.status}`);
  const sections = await sectionRes.json();
  const assembled = {}, overlay = {};
  for (const row of sections) {
    const { stateUpdatedAt, ...data } = row.state || {};
    Object.assign(row.id.startsWith("u-") ? overlay : assembled, data);
  }
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
    const rows = await r.json();
    return rows[0]?.user_id || null;
  } catch { return null; }
}

// ── Storage helpers ───────────────────────────────────────────────────────────
async function listAt(headers, bucket, prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`storage list ${res.status}`);
    const page = await res.json();
    if (!Array.isArray(page) || !page.length) break;
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}
// Top-level entries are the content-addressed folders (each holds N.mp3 + meta.json).
async function listTopFolders(headers, bucket) {
  return (await listAt(headers, bucket, "")).map(e => e.name).filter(Boolean);
}
async function listFolderFiles(headers, bucket, folder) {
  return (await listAt(headers, bucket, folder)).map(e => e.name).filter(Boolean).map(n => `${folder}/${n}`);
}
async function deletePaths(headers, bucket, paths) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!res.ok) throw new Error(`storage delete ${res.status}`);
}
// Schedule + included_files are declared in netlify.toml (repo convention).
