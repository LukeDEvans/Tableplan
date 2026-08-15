// Canonical music entities + conservative entity resolution.
//
// The provider layer (music-streaming.js: CanonicalTrack/Album) holds a
// PROVIDER'S RECORD of something. This module is the layer above it: the app's
// own Work / Movement / Recording entities, which provider records RESOLVE TO
// via ProviderReferences. Provider ids are never canonical ids.
//
//   Work        — the composition (Beethoven, Piano Sonata No. 14, Op. 27 No. 2)
//   Movement    — a section of a Work
//   Recording   — a particular performance of a Work
//   (provider record → resolves to → Work + Recording, keeping a ProviderRef)
//   PlayableSource — the actual stream (music-streaming.js)
//
// Matching is deterministic and conservative: strong signals (catalog number,
// composer + structured work identity, composer + normalized title) only, with
// explicit CONFLICT guards (different catalog / different number ⇒ reject) so we
// never merge two different works or two different performances. False positives
// are worse than duplicates. Every association keeps provenance so it stays
// reversible and auditable. See MUSIC.md.

let _n = 0;
export function uid(prefix = "id") { _n += 1; return `${prefix}_${Date.now().toString(36)}${_n.toString(36)}${Math.random().toString(36).slice(2, 7)}`; }
const nowIso = () => new Date().toISOString();

// ── text normalization ────────────────────────────────────────────────────────
export function deburr(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
const clean = (s) => deburr(s).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
const contributorName = (c) => (c == null ? "" : typeof c === "string" ? c : String(c.name || ""));

// ── composer identity ─────────────────────────────────────────────────────────
export function parseComposer(name) {
  let n = deburr(String(name || "")).toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = n.split(" ").filter(Boolean);
  return { norm: n, tokens, surname: tokens.length ? tokens[tokens.length - 1] : "" };
}
export function composerSurname(name) { return parseComposer(name).surname; }

// Two composer strings refer to the same person? Surnames must match; given
// names must be compatible (equal, initial-of, or one side unspecified).
export function composerCompatible(a, b) {
  const A = parseComposer(a), B = parseComposer(b);
  if (!A.surname || !B.surname || A.surname !== B.surname) return false;
  const ga = A.tokens.slice(0, -1), gb = B.tokens.slice(0, -1);
  if (!ga.length || !gb.length) return true; // one side has no given names → compatible (weak)
  const ok = (short, long) => short.every((s) => long.some((l) => l === s || (s.length === 1 && l[0] === s) || (l.length === 1 && s[0] === l)));
  return ok(ga, gb) || ok(gb, ga);
}

// ── catalog numbers ───────────────────────────────────────────────────────────
// Thematic-catalog schemes (composer-specific ids). BWV Bach, K/KV Mozart,
// D Schubert, Hob Haydn, HWV Handel, RV Vivaldi, WoO/Op Beethoven & general.
const CATALOG_RE = /\b(bwv|kv|k|d|hob|hwv|rv|woo|op|opus)\.?\s*(\d+)(?:\s*(?:no|nr|number)\.?\s*(\d+)|\s*\/\s*(\d+))?/i;
export function extractCatalog(title) {
  const s = String(title || "");
  const m = s.match(CATALOG_RE);
  if (!m) return { catalog: null, catalogId: null, opus: null, number: null };
  let scheme = m[1].toLowerCase();
  if (scheme === "opus") scheme = "op";
  if (scheme === "kv") scheme = "k";
  const n1 = Number(m[2]);
  const n2 = m[3] != null ? Number(m[3]) : m[4] != null ? Number(m[4]) : null;
  const catalogId = `${scheme}${n1}${n2 != null ? `no${n2}` : ""}`;
  const pretty = scheme === "op" ? `Op. ${n1}${n2 != null ? ` No. ${n2}` : ""}` : `${scheme.toUpperCase()} ${n1}${n2 != null ? `/${n2}` : ""}`;
  return { catalog: pretty, catalogId, opus: scheme === "op" ? n1 : null, number: null };
}

const WORK_TYPES = ["sonatina", "sonata", "symphony", "concerto", "quartet", "quintet", "sextet", "trio", "prelude", "fugue", "nocturne", "etude", "study", "waltz", "mazurka", "polonaise", "ballade", "scherzo", "impromptu", "rhapsody", "suite", "partita", "variations", "overture", "requiem", "mass", "cantata", "arabesque", "invention", "toccata", "serenade", "romance", "fantasia", "fantasy", "bagatelle", "gymnopedie", "gnossienne", "intermezzo", "caprice", "elegie", "berceuse", "barcarolle", "march"];
const INSTRUMENTS = ["piano", "violin", "cello", "viola", "flute", "oboe", "clarinet", "bassoon", "guitar", "organ", "harpsichord", "horn", "trumpet", "harp", "string", "orchestra"];

const wordNums = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
export function extractWorkType(title) { const c = clean(title); return WORK_TYPES.find((w) => new RegExp(`\\b${w}s?\\b`).test(c)) || null; }
export function extractInstrument(title) { const c = clean(title); return INSTRUMENTS.find((i) => new RegExp(`\\b${i}\\b`).test(c)) || null; }
export function extractNumber(title) {
  const c = clean(title);
  let m = c.match(/\b(?:no|nr|number)\s*(\d+)\b/);
  if (m) return Number(m[1]);
  m = c.match(/\b(?:no|nr|number)\s*(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (m) return wordNums[m[1]];
  return null;
}
const KEYS = "(c|d|e|f|g|a|b)(\\s?(sharp|flat|#|b))?\\s+(major|minor|maj|min)";
export function extractKey(title) { const m = clean(title).match(new RegExp(`\\b${KEYS}\\b`)); return m ? m[0].replace(/\s+/g, " ").trim() : null; }

// A small, high-confidence nickname table → structured descriptor. Conservative
// on purpose; extend deliberately.
export const NICKNAMES = {
  "moonlight sonata": { composer: "Beethoven", workType: "sonata", number: 14, instrument: "piano", catalog: "Op. 27 No. 2", title: "Piano Sonata No. 14" },
  moonlight: { composer: "Beethoven", workType: "sonata", number: 14, instrument: "piano", catalog: "Op. 27 No. 2", title: "Piano Sonata No. 14" },
  pathetique: { composer: "Beethoven", workType: "sonata", number: 8, instrument: "piano", catalog: "Op. 13", title: "Piano Sonata No. 8" },
  appassionata: { composer: "Beethoven", workType: "sonata", number: 23, instrument: "piano", catalog: "Op. 57", title: "Piano Sonata No. 23" },
  "clair de lune": { composer: "Debussy", workType: "suite", instrument: "piano", title: "Suite bergamasque: Clair de lune" },
  "fur elise": { composer: "Beethoven", workType: "bagatelle", instrument: "piano", catalog: "WoO 59", title: "Bagatelle in A minor (Für Elise)" },
};
export function matchNickname(title) {
  const c = clean(title);
  for (const [k, v] of Object.entries(NICKNAMES)) if (c.includes(k)) return { ...v, nicknameKey: k };
  return null;
}

// A comparable descriptor of the work a title/composer denotes.
export function deriveWorkDescriptor(rawTitle, rawComposer) {
  let composer = contributorName(rawComposer);
  let title = String(rawTitle || "").trim();
  if (!composer) { // "Composer: Work"
    const m = title.match(/^([A-Za-zÀ-ÿ.''-]+(?:\s+[A-Za-zÀ-ÿ.''-]+){0,2}):\s+(.+)$/);
    if (m && parseComposer(m[1]).tokens.length <= 3) { composer = m[1]; title = m[2]; }
  }
  const nick = matchNickname(title);
  const cat = extractCatalog(nick && nick.catalog ? nick.catalog : title);
  const workType = (nick && nick.workType) || extractWorkType(title);
  const number = nick && nick.number != null ? nick.number : extractNumber(title);
  const instrument = (nick && nick.instrument) || extractInstrument(title);
  const composerName = composer || (nick && nick.composer) || "";
  const baseTitle = nick && nick.title ? nick.title : title;
  const titleKey = clean(baseTitle).replace(new RegExp(`\\b${KEYS}\\b`, "g"), "").replace(CATALOG_RE, "").replace(/\bnr\b/g, "no").replace(/\s+/g, " ").trim();
  return {
    composer: composerName,
    composerKey: composerName ? composerSurname(composerName) : "",
    title: baseTitle,
    titleKey,
    workType: workType || null,
    number: number != null ? number : null,
    instrument: instrument || null,
    key: extractKey(title),
    catalog: cat.catalog,
    catalogId: cat.catalogId,
    opus: cat.opus,
    nickname: nick ? nick.nicknameKey : null,
    hasStrongKey: !!(cat.catalogId || (workType && number != null) || (composerName && titleKey.length >= 4)),
  };
}

// ── matching ──────────────────────────────────────────────────────────────────
// Returns { matched, confidence, signals[], reason? }. High-confidence only.
export function matchWork(a, b) {
  if (!a || !b) return { matched: false, confidence: 0 };
  if (a.composer && b.composer && !composerCompatible(a.composer, b.composer)) return { matched: false, confidence: 0, reason: "composer-mismatch" };
  // Hard conflicts first — these prove the works are DIFFERENT.
  if (a.catalogId && b.catalogId && a.catalogId !== b.catalogId) return { matched: false, confidence: 0, reason: "catalog-conflict" };
  if (a.workType && b.workType && a.workType === b.workType && a.number != null && b.number != null && a.number !== b.number) return { matched: false, confidence: 0, reason: "number-conflict" };
  const signals = [];
  if (a.catalogId && b.catalogId && a.catalogId === b.catalogId) signals.push("catalog");
  if (a.workType && b.workType && a.workType === b.workType && a.number != null && b.number != null && a.number === b.number && (!a.instrument || !b.instrument || a.instrument === b.instrument)) signals.push("structured");
  if (a.titleKey && b.titleKey && a.titleKey === b.titleKey && a.titleKey.length >= 4) signals.push("title");
  // Every signal below needs composer agreement (compatible, and at least one side named).
  const composerOk = a.composer && b.composer && composerCompatible(a.composer, b.composer);
  const confidence = signals.includes("catalog") && composerOk ? 0.98
    : signals.includes("structured") && composerOk ? 0.92
    : signals.includes("title") && composerOk ? 0.86
    : signals.includes("catalog") ? 0.8 // catalog id alone (rare without composer)
    : 0;
  return { matched: confidence >= 0.85, confidence, signals };
}

// Deterministic bucket key for grouping provider records under one Work. Only
// produced when a strong key exists, so ambiguous items never group.
export function workGroupingKey(desc) {
  if (!desc || !desc.hasStrongKey) return null;
  const c = desc.composerKey || "";
  if (desc.catalogId) return `${c}|cat:${desc.catalogId}`;
  if (desc.workType && desc.number != null) return `${c}|${desc.workType}${desc.instrument ? ":" + desc.instrument : ""}:${desc.number}`;
  if (c && desc.titleKey) return `${c}|t:${desc.titleKey}`;
  return null;
}

// Same performance? (for exact-recording fallback across providers)
export function matchRecording(a, b) {
  if (!a || !b) return { matched: false, confidence: 0 };
  const perfA = clean((a.performers || []).map((p) => p.name).join(" ") || a.performer || "");
  const perfB = clean((b.performers || []).map((p) => p.name).join(" ") || b.performer || "");
  const albumA = clean(a.album), albumB = clean(b.album);
  const durOk = a.durationMs && b.durationMs ? Math.abs(a.durationMs - b.durationMs) <= 3000 : null;
  if (perfA && perfB && perfA !== perfB) return { matched: false, confidence: 0, reason: "performer-mismatch" };
  const signals = [];
  if (perfA && perfB && perfA === perfB) signals.push("performer");
  if (albumA && albumB && albumA === albumB) signals.push("album");
  if (durOk) signals.push("duration");
  const confidence = signals.includes("performer") && (signals.includes("album") || signals.includes("duration")) ? 0.95
    : signals.includes("album") && signals.includes("duration") ? 0.85 : 0;
  return { matched: confidence >= 0.85, confidence, signals };
}

// ── canonical entities ────────────────────────────────────────────────────────
const provenanceEntry = (p = {}) => ({
  provider: String(p.provider || ""),
  providerId: String(p.providerId || ""),
  matchType: p.matchType || "auto",        // "auto" | "manual" | "possible"
  confidence: p.confidence != null ? p.confidence : null,
  matchedOn: Array.isArray(p.matchedOn) ? p.matchedOn : [],
  metadata: p.metadata || null,            // original provider metadata, kept separate
  at: p.at || nowIso(),
});

export function makeCanonicalWork(p = {}) {
  const d = p.descriptor || {};
  return {
    entity: "work",
    id: String(p.id || uid("work")),
    composer: String(p.composer || d.composer || ""),
    title: String(p.title || d.title || "Untitled work"),
    catalog: p.catalog || d.catalog || null,
    catalogId: p.catalogId || d.catalogId || null,
    opus: p.opus != null ? p.opus : d.opus ?? null,
    number: p.number != null ? p.number : d.number ?? null,
    key: p.key || d.key || null,
    workType: p.workType || d.workType || null,
    instrument: p.instrument || d.instrument || null,
    nickname: p.nickname || d.nickname || null,
    movements: Array.isArray(p.movements) ? p.movements : [],
    providerRefs: Array.isArray(p.providerRefs) ? p.providerRefs : [],
    canonicalFields: p.canonicalFields || {}, // user edits win over provider data
    provenance: (p.provenance || []).map(provenanceEntry),
    createdAt: p.createdAt || nowIso(),
    updatedAt: p.updatedAt || nowIso(),
  };
}

export function makeCanonicalRecording(p = {}) {
  return {
    entity: "recording",
    id: String(p.id || uid("rec")),
    workId: p.workId || null,
    workTitle: String(p.workTitle || ""),
    composer: String(p.composer || ""),
    title: String(p.title || p.workTitle || "Recording"),
    performers: Array.isArray(p.performers) ? p.performers : [],
    ensemble: p.ensemble || null,
    conductor: p.conductor || null,
    album: p.album || null,
    releaseDate: p.releaseDate || null,
    durationMs: p.durationMs != null ? p.durationMs : null,
    artworkUrl: p.artworkUrl || null,
    originProvider: p.originProvider || (p.providerRefs && p.providerRefs[0] && p.providerRefs[0].provider) || null,
    providerRefs: Array.isArray(p.providerRefs) ? p.providerRefs : [],
    canonicalFields: p.canonicalFields || {},
    provenance: (p.provenance || []).map(provenanceEntry),
    createdAt: p.createdAt || nowIso(),
  };
}

// ── derive canonical entities from a provider record ──────────────────────────
export function deriveWorkFromRecord(rec) {
  const d = deriveWorkDescriptor(rec.work && rec.work.title ? rec.work.title : rec.title, rec.composer || (rec.work && rec.work.composer));
  return makeCanonicalWork({
    descriptor: d,
    providerRefs: rec.providerRefs || [],
    provenance: [provenanceEntry({ provider: rec.provider, providerId: refId(rec), matchType: "auto", matchedOn: ["derived"], metadata: { title: rec.title, composer: contributorName(rec.composer) } })],
  });
}

export function deriveRecordingFromRecord(rec, workId = null) {
  return makeCanonicalRecording({
    workId,
    workTitle: (rec.work && rec.work.title) || rec.album || rec.title,
    composer: contributorName(rec.composer),
    title: rec.title,
    performers: (rec.artists || []).filter((a) => a.role !== "composer"),
    album: rec.album || null,
    durationMs: rec.durationMs != null ? rec.durationMs : null,
    artworkUrl: rec.artworkUrl || null,
    originProvider: rec.provider,
    providerRefs: rec.providerRefs || [],
    provenance: [provenanceEntry({ provider: rec.provider, providerId: refId(rec), matchType: "auto", matchedOn: ["derived"] })],
  });
}
const refId = (rec) => (rec.providerRefs && rec.providerRefs[0] && rec.providerRefs[0].externalId) || rec.id || "";

// ── search consolidation (Work → its recordings) ──────────────────────────────
// Groups provider records that resolve to the same Work under one CanonicalWork;
// records with no strong work key stay loose (e.g. ambient tracks). Conservative
// and deterministic (bucket by grouping key — no fuzzy transitive merging).
export function consolidateSearchResults(items) {
  const buckets = new Map(); const loose = [];
  for (const it of items || []) {
    const d = deriveWorkDescriptor(it.work && it.work.title ? it.work.title : it.title, it.composer || (it.work && it.work.composer));
    const key = workGroupingKey(d);
    if (!key) { loose.push(it); continue; }
    if (!buckets.has(key)) buckets.set(key, { descriptor: d, items: [] });
    buckets.get(key).items.push(it);
  }
  const groups = [];
  for (const { descriptor, items: bItems } of buckets.values()) {
    if (bItems.length < 2 && !descriptor.catalogId && !(descriptor.workType && descriptor.number != null)) {
      // a lone weak-title bucket isn't worth a Work header
      loose.push(...bItems); continue;
    }
    const work = makeCanonicalWork({
      descriptor,
      providerRefs: dedupeRefs(bItems.flatMap((i) => i.providerRefs || [])),
      provenance: bItems.map((i) => provenanceEntry({ provider: i.provider, providerId: refId(i), matchType: "auto", matchedOn: [workGroupingKey(descriptor) ? "grouping-key" : "derived"] })),
    });
    groups.push({ work, items: bItems });
  }
  return { groups, loose };
}
function dedupeRefs(refs) {
  const seen = new Set(); const out = [];
  for (const r of refs) { const k = `${r.provider}:${r.externalId}`; if (seen.has(k)) continue; seen.add(k); out.push(r); }
  return out;
}

// ── enrichment (merge without clobbering user edits) ──────────────────────────
// Precedence: user-edited canonicalFields > existing structured value > incoming.
export function enrichWork(work, incoming) {
  const out = makeCanonicalWork(work);
  const fields = ["composer", "title", "catalog", "catalogId", "opus", "number", "key", "workType", "instrument", "nickname"];
  for (const f of fields) {
    if (out.canonicalFields[f] != null) { out[f] = out.canonicalFields[f]; continue; } // user wins
    if ((out[f] == null || out[f] === "") && incoming[f] != null && incoming[f] !== "") out[f] = incoming[f];
  }
  const refs = dedupeRefs([...(out.providerRefs || []), ...(incoming.providerRefs || [])]);
  out.providerRefs = refs;
  out.provenance = [...out.provenance, ...(incoming.provenance || []).map(provenanceEntry)];
  out.updatedAt = nowIso();
  return out;
}
