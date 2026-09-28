// Playable-source resolution + provider fallback.
//
// A saved Recording is a canonical entity; the CURRENTLY-PLAYABLE SOURCE is
// separate and dynamic. resolvePlayableSource() turns the recording into a
// source at play time, trying providers in order and — critically — telling the
// caller *what kind* of source it found:
//
//   status "exact"       the SAME recording (its own ref, or the same
//                        performance found via another provider). Play it.
//   status "alternate"   the exact recording is unavailable, but another
//                        PERFORMANCE of the same Work is available. Offer it to
//                        the user; never silently substitute (§13).
//   status "unavailable" no playable source anywhere right now.
//
// Provider requests failing does NOT delete refs — availability is dynamic
// (§18). Matching for "same recording / same work" uses music-canonical.js.

import { deriveWorkDescriptor, deriveRecordingFromRecord, matchWork, matchRecording } from "./music-canonical.js";

const clean = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

// Order a recording's provider refs: user-preferred first, then the origin
// provider, then the rest (stable).
function orderedRefs(recording, preferred) {
  const refs = (recording && recording.providerRefs || []).slice();
  const rank = (r) => (preferred && r.provider === preferred ? 0 : recording.originProvider && r.provider === recording.originProvider ? 1 : 2);
  return refs.map((r, i) => [r, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([r]) => r);
}

async function sourceFromRef(provider, ref) {
  if (provider && typeof provider.resolveRef === "function") { try { return await provider.resolveRef(ref); } catch { return null; } }
  return null;
}

async function providerUp(provider) {
  if (!provider) return false;
  if (typeof provider.isAvailable !== "function") return true;
  try { return await provider.isAvailable(); } catch { return false; }
}

/**
 * @param recording canonical Recording (music-canonical.js)
 * @param opts { registry, preferredProvider?, allowAlternate? }
 * @returns { status, source?, providerRef?, recording, alternateRecording?, attempts[] }
 */
export async function resolvePlayableSource(recording, opts = {}) {
  const registry = opts.registry;
  const attempts = [];
  const refs = orderedRefs(recording, opts.preferredProvider);

  // 1) Try the recording's own known sources (this exact performance).
  for (const ref of refs) {
    const p = registry && registry.get ? registry.get(ref.provider) : null;
    if (!p) { attempts.push({ provider: ref.provider, ok: false, reason: "no-provider" }); continue; }
    if (!(await providerUp(p))) { attempts.push({ provider: ref.provider, ok: false, reason: "unavailable" }); continue; }
    const src = await sourceFromRef(p, ref);
    // A playback-owning provider (Apple Music) resolves to an `owned` source —
    // no URL; the caller plays it through that provider's transport.
    if (src && (src.url || src.owned)) return { status: "exact", source: src, providerRef: ref, recording, attempts };
    attempts.push({ provider: ref.provider, ok: false, reason: "no-source" });
  }

  // 2) Search-based fallback (only if asked): may find the SAME performance on a
  //    provider we had no ref for (→ exact), else a DIFFERENT performance of the
  //    same work (→ alternate, offered explicitly).
  if (opts.allowAlternate) {
    // 2a) Same SONG on another provider (ISRC, or artist + title + duration). This
    //     is what carries non-classical favourites/playlists across a provider
    //     switch: the saved item keeps its old ref, and the first play on the new
    //     provider finds it here and reports `learnedRef` so the caller can save it.
    const song = await findSameSongViaSearch(recording, registry, attempts);
    if (song) return { ...song, recording, attempts };
    const found = await findViaSearch(recording, registry, attempts);
    if (found) return { ...found, recording, attempts };
  }
  return { status: "unavailable", recording, attempts };
}

function altQuery(recording) {
  const parts = [recording.composer, recording.workTitle || recording.title].map(clean).filter(Boolean);
  return parts.join(" ").trim();
}

async function findViaSearch(recording, registry, attempts) {
  if (!registry || typeof registry.search !== "function") return null;
  const q = altQuery(recording);
  if (!q) return null;
  let res;
  try { res = await registry.search(q, { limit: 15 }); } catch { return null; }
  const wantWork = deriveWorkDescriptor(recording.workTitle || recording.title, recording.composer);
  const candidates = await collectCandidates(res.items || [], registry, wantWork);
  if (!candidates.length) return null;

  // (a) Same performance via another provider → still "exact".
  for (const c of candidates) {
    if (matchRecording(recording, c.recording).matched) {
      return { status: "exact", source: c.source, providerRef: c.ref };
    }
  }
  // (b) A different performance of the same work → "alternate".
  const alt = candidates[0];
  return { status: "alternate", alternateRecording: alt.recording, source: alt.source, providerRef: alt.ref };
}

// Turn up to a few search results that (i) belong to the same work and (ii)
// resolve to a playable source, into {recording, source, ref} candidates.
async function collectCandidates(items, registry, wantWork, cap = 6) {
  const out = [];
  for (const item of items.slice(0, 12)) {
    if (out.length >= cap) break;
    const d = deriveWorkDescriptor(item.work && item.work.title ? item.work.title : item.title, item.composer || (item.work && item.work.composer));
    if (!matchWork(wantWork, d).matched) continue;

    if (item.entity === "track" && item.playable && item.playable.url) {
      out.push({ recording: deriveRecordingFromRecord(item, wantWork.id || null), source: item.playable, ref: (item.providerRefs || [])[0] || null });
      continue;
    }
    // Album: expand and take its first streamable track.
    const p = registry.get(item.provider);
    if (!p || typeof p.getItem !== "function") continue;
    if (!(await providerUp(p))) continue;
    let detail; try { detail = await p.getItem(item); } catch { continue; }
    const track = (detail.tracks || []).find((t) => t.playable && t.playable.url);
    if (track) out.push({ recording: deriveRecordingFromRecord(track), source: track.playable, ref: (track.providerRefs || [])[0] || null });
  }
  return out;
}

// ── same-song (non-classical) cross-provider matching ─────────────────────────
// A song title key tolerant of the usual release decorations: "(Remastered
// 2011)", "[Live]", "- 2009 Remaster", "feat. X". Deliberately NOT fuzzy beyond
// that — a wrong match silently plays the wrong song (§13).
export function songTitleKey(title) {
  return clean(String(title || "")
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\s+-\s+.*(remaster|version|edit|mix|live|mono|stereo).*$/i, " ")
    .replace(/\b(feat|ft)\.?\s.*$/i, " "));
}
const firstArtist = (r) => clean((r && r.performers && r.performers[0] && r.performers[0].name) || (r && r.artists && r.artists[0] && r.artists[0].name) || (r && r.artist) || "");

/** Is provider track `t` the same song as saved recording `rec`? */
export function isSameSong(rec, t) {
  if (!rec || !t) return false;
  if (rec.isrc && t.isrc) return rec.isrc === t.isrc;
  const ta = songTitleKey(rec.title), tb = songTitleKey(t.title);
  if (!ta || ta !== tb) return false;
  const aa = firstArtist(rec), ab = firstArtist(t);
  if (!aa || !ab || !(aa === ab || aa.startsWith(ab) || ab.startsWith(aa))) return false;
  if (rec.durationMs && t.durationMs) return Math.abs(rec.durationMs - t.durationMs) <= 5000;
  return true;
}

async function findSameSongViaSearch(recording, registry, attempts) {
  if (!registry || typeof registry.search !== "function") return null;
  const artist = (recording.performers && recording.performers[0] && recording.performers[0].name) || "";
  const title = songTitleKey(recording.title);
  if (!title || (!artist && !recording.isrc)) return null; // too weak to search safely
  const known = new Set((recording.providerRefs || []).map((r) => r.provider));
  let res;
  try { res = await registry.search(`${artist} ${title}`.trim(), { limit: 15 }); } catch { return null; }
  for (const item of (res.items || [])) {
    if (item.entity !== "track" || known.has(item.provider) || !isSameSong(recording, item)) continue;
    const ref = (item.providerRefs || [])[0] || null;
    const p = registry.get ? registry.get(item.provider) : null;
    let src = item.playable && item.playable.url ? item.playable : null;
    if (!src && p && ref) src = await sourceFromRef(p, ref);
    if (src && (src.url || src.owned)) {
      attempts.push({ provider: item.provider, ok: true, reason: "same-song-search" });
      return { status: "exact", source: src, providerRef: ref, learnedRef: ref };
    }
  }
  return null;
}
