// Pure logic for the TTS audio-cache cleanup sweep.
//
// Synthesized article audio lives in the Storage bucket under content-addressed
// folders (one folder per cache key). Over time, folders accumulate for articles
// that were removed, or for voices/models no longer used, and nothing prunes them.
// This module computes which folders are still "live" (produced by a current saved
// article in a voice we want to keep) so the caller can delete the rest.
//
// IMPORTANT: the audio is fully regenerable — deleting a folder only means that
// article re-synthesizes on next play. So the real hazard is deleting on a bad/
// empty state read (mass re-synth), which the function guards against; it is never
// user-data loss. Kept pure/DOM-free so the key math is unit-tested against the
// exact same helpers the writer uses (no drift → no accidental over-deletion).

import { prepareArticleListenText } from "./tts-article-text.mjs";
import { chunkText, sanitizeKey } from "./kokoro-core.mjs";
import { ttsCacheKey } from "./tts-cache-identity.js";

// Every Storage folder prefix one article occupies for a given voice, matching
// EXACTLY what the client + the kokoro-tts function write:
//   - kokoro: one folder PER CHUNK (the incremental player synthesizes per chunk)
//   - google: one folder for the WHOLE article (single batch synth)
// The folder name is sanitizeKey(cacheKey), so we apply the same sanitize here.
export function articleAudioPrefixes(article, { provider, providerVoiceId, model, speed = 1 }) {
  const prepared = prepareArticleListenText(article);
  if (!prepared) return [];
  const mk = (text) => sanitizeKey(ttsCacheKey({ text, provider, providerVoiceId, model, speed, speedInAudio: false }));
  return provider === "kokoro" ? chunkText(prepared.text).map(mk) : [mk(prepared.text)];
}

// The set of folder prefixes to KEEP: every (article × voice) combination we still
// want cached. `voices` is a list of { provider, providerVoiceId, model, speed }.
export function liveAudioPrefixes(articles, voices) {
  const set = new Set();
  for (const article of articles || []) {
    if (!article || !article.text) continue;
    for (const v of voices || []) {
      for (const p of articleAudioPrefixes(article, v)) set.add(p);
    }
  }
  return set;
}

// Split observed top-level folder names into keep vs orphan (safe to delete).
export function partitionAudioFolders(folderNames, liveSet) {
  const keep = [], orphan = [];
  for (const name of folderNames || []) (liveSet.has(name) ? keep : orphan).push(name);
  return { keep, orphan };
}
