// Shared server-side helper: fetch a saved article's spoken/cache-key text when
// it's missing from the synced record.
//
// article.text is nulled once its body is durably offloaded to the reading-content
// Storage bucket (see media-content.js's ContentStore adapter) -- true for most
// saved articles, read or not, since that's the point of the offload. Any
// server-side job that needs the article's text to compute its TTS cache key
// (tts-article-text.mjs -> tts-cache-identity.js) must backfill it from there
// first, or it will silently treat a live, still-cached article as textless and
// misclassify its audio as orphaned/unrenderable. Two jobs need this identically
// (tts-cache-cleanup.js, presynth-tts-background.mjs) -- kept in one place so they
// can't drift, mirroring tts-article-text.mjs's own "one place" rationale.
//
// Pure aside from the fetch call: takes the caller's own auth headers, does not
// mutate its input, and never throws -- failures are reported per-article via the
// returned `failed` count so the caller decides whether to proceed or abort.

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
const DEFAULT_BUCKET = "reading-content";

/**
 * @param headers  Supabase REST/Storage auth headers (apikey + Authorization)
 * @param articles array of saved-article records (not mutated)
 * @returns { articles, ok, failed } -- `articles` is a NEW array with `.text`
 *          filled in wherever it was missing and fetchable; `ok` is false if any
 *          such fetch failed, so a caller building a "live set" for a delete/
 *          orphan decision can abort rather than proceed on incomplete data.
 */
export async function backfillArticleText(headers, articles) {
  let failed = 0;
  const out = [];
  for (const a of articles || []) {
    if (!a || a.text || !a?.bodyRef?.cloud?.path) { out.push(a); continue; }
    try {
      const bucket = a.bodyRef.cloud.bucket || DEFAULT_BUCKET;
      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${bucket}/${a.bodyRef.cloud.path}`, { headers });
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      out.push({ ...a, text: await res.text() });
    } catch (e) {
      failed++;
      console.error(`[article-body-backfill] failed for article ${a.id}:`, e.message);
      out.push(a); // stays textless -- caller decides whether that's fatal
    }
  }
  return { articles: out, ok: failed === 0, failed };
}
