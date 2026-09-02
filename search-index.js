// search-index.js — a local-first, projection-backed search index. Pure and
// deterministic: canonical `state` → search docs → an in-memory inverted index →
// ranked queries. NO external search engine, NO second source of truth.
//
// Properties (ARCHITECTURE.md — search slice):
//   - DERIVED / non-authoritative: built from `state`; never written back.
//   - REBUILDABLE: indexFromState(state) at any time; cheap.
//   - INVALIDATABLE: the index stamps state.stateUpdatedAt; isStale() detects drift.
//   - ACCOUNT-SCOPED: built from the active account's in-memory state and held in
//     memory only (never persisted), so an account transition (which resets state)
//     rebuilds it — no account-boundary surface.
//   - PORTABLE: pure JS, no backend — runs identically against a home-server state.
//
// It indexes a curated set of high-value collections (below), not every field that
// exists — searchability is a deliberate projection, not a dump.

// What is searchable: {type, collection (state key), title fields, text fields}.
// First present title field wins; text fields are concatenated. Missing fields are
// skipped defensively. Extend this list to make a new domain searchable.
export const SEARCHABLE = [
  { type: "recipe",  collection: "recipes",       title: ["name", "title"], text: ["tags"] },
  { type: "article", collection: "savedArticles", title: ["title"],         text: ["author", "publication"] },
  { type: "task",    collection: "doTasks",       title: ["title", "text"], text: ["notes"] },
  { type: "contact", collection: "contacts",      title: ["name"],          text: ["email", "phone", "groups"] },
  { type: "trip",    collection: "trips",         title: ["name", "title", "destination"], text: ["destination", "notes"] },
  { type: "event",   collection: "planEvents",    title: ["title"],         text: ["notes"] },
  { type: "media",   collection: "mediaSaved",    title: ["title", "name"], text: ["kind"] },
];

const firstField = (rec, fields) => {
  for (const f of fields) { const v = rec?.[f]; if (typeof v === "string" && v.trim()) return v.trim(); }
  return "";
};
const joinFields = (rec, fields) => {
  const parts = [];
  for (const f of fields) {
    const v = rec?.[f];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) parts.push(v.filter((x) => typeof x === "string").join(" "));
  }
  return parts.join(" ");
};

const tokenize = (s) => String(s || "").toLowerCase().split(/[^a-z0-9]+/i).filter((t) => t.length > 1);

// Project canonical state into lightweight search docs. Pure.
export function toSearchDocs(state) {
  const s = state && typeof state === "object" ? state : {};
  const docs = [];
  for (const cfg of SEARCHABLE) {
    const rows = Array.isArray(s[cfg.collection]) ? s[cfg.collection] : [];
    for (const rec of rows) {
      if (!rec || rec.id == null) continue;
      const title = firstField(rec, cfg.title);
      if (!title) continue; // nothing to show/rank on
      docs.push({ id: String(rec.id), type: cfg.type, title, text: joinFields(rec, cfg.text) });
    }
  }
  return docs;
}

// Build an in-memory inverted index (term -> doc indices) + the docs. Pure.
export function buildIndex(docs, stamp = null) {
  const list = Array.isArray(docs) ? docs : [];
  const terms = new Map();
  list.forEach((d, i) => {
    for (const t of new Set([...tokenize(d.title), ...tokenize(d.text)])) {
      if (!terms.has(t)) terms.set(t, new Set());
      terms.get(t).add(i);
    }
  });
  return { docs: list, terms, stamp };
}

export function indexFromState(state) {
  return buildIndex(toSearchDocs(state), state?.stateUpdatedAt || null);
}

// The index is stale if the state has advanced since it was built.
export function isStale(index, state) {
  return !index || index.stamp !== (state?.stateUpdatedAt || null);
}

// Rank docs by matched query terms (title matches weighted higher). Returns
// [{id, type, title, score}] descending, capped by limit. Pure.
export function search(index, query, { limit = 20, types = null } = {}) {
  if (!index || !index.docs.length) return [];
  const qterms = tokenize(query);
  if (!qterms.length) return [];
  const typeSet = types ? new Set(types) : null;
  const scoreByDoc = new Map();
  for (const qt of qterms) {
    // exact term hits (inverted index) + cheap prefix hits for partial typing
    const hitSets = [];
    if (index.terms.has(qt)) hitSets.push(index.terms.get(qt));
    for (const [term, set] of index.terms) if (term !== qt && term.startsWith(qt)) hitSets.push(set);
    for (const set of hitSets) for (const di of set) scoreByDoc.set(di, (scoreByDoc.get(di) || 0) + 1);
  }
  const results = [];
  for (const [di, base] of scoreByDoc) {
    const d = index.docs[di];
    if (typeSet && !typeSet.has(d.type)) continue;
    const titleTokens = new Set(tokenize(d.title));
    const titleBoost = qterms.reduce((n, qt) => n + (titleTokens.has(qt) ? 2 : 0), 0);
    results.push({ id: d.id, type: d.type, title: d.title, score: base + titleBoost });
  }
  results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return results.slice(0, limit);
}
