// search-index.js — Liv's universal search: a local-first, projection-backed index
// shared by the app, the in-app assistant and liv-mcp (UNIVERSAL_SEARCH_DESIGN.md).
// Pure and deterministic: state-like data → search docs → an in-memory inverted
// index → ranked results. NO external search engine, NO second source of truth.
//
// Properties (ARCHITECTURE.md — search slice):
//   - DERIVED / non-authoritative: built from state; never written back.
//   - REBUILDABLE / INVALIDATABLE: the index stamps state.stateUpdatedAt; isStale()
//     detects drift and createIndexCache() rebuilds only then.
//   - ACCOUNT- and VIEW-SCOPED: built only from the data the caller hands in, and
//     every doc carries the view it came from.
//   - PORTABLE: pure JS, no backend, no DOM — the same file runs in the app, in the
//     liv-mcp Edge Function (bundled) and later on a home server.
//
// A source is a deliberate projection, not a dump: it names its state section and
// keys (so liv-mcp can read just those JSON paths) and turns records into
// { id, title, text, date?, detail? }. `server: false` keeps a source on the device
// (too heavy, or not something an outside assistant should read).

// ── Text ────────────────────────────────────────────────────────────────────
// Unicode-aware, accents folded: "Café" → "cafe", "één" → "een".
export function fold(s) {
  return String(s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}
export function tokenize(s) {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 || /\d/.test(t));
}

const str = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const firstOf = (rec, fields) => { for (const f of fields) { const v = str(rec?.[f]); if (v) return v; } return ""; };
// Strings, numbers, arrays of either, and arrays of small objects ({ value }, { name }, { item }).
function flat(v) {
  if (typeof v === "string" || typeof v === "number") return str(v);
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === "object" ? flat(x.value ?? x.name ?? x.item ?? x.label ?? "") : flat(x))).filter(Boolean).join(" ");
  if (v && typeof v === "object") return flat(v.name ?? v.address ?? v.value ?? "");
  return "";
}
const textOf = (rec, fields) => fields.map((f) => flat(rec?.[f])).filter(Boolean).join(" ");
const list = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));

// The planner week starts on Friday (the grocery day); these are its day ids.
const DO_DAY_OFFSETS = { "friday-start": 0, saturday: 1, sunday: 2, monday: 3, tuesday: 4, wednesday: 5, thursday: 6 };
export function addDays(key, n) {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Sources ─────────────────────────────────────────────────────────────────
// type → what it is; section/keys → where it lives in tableplan_states;
// label → how a result is named to people and the assistant.
export const SOURCES = [
  {
    type: "recipe", label: "Recipe", plural: "Recipes", section: "eat", keys: ["recipes"], server: "recipes-table",
    collect: (d) => list(d.recipes).map((r) => ({
      id: r.id, title: firstOf(r, ["name", "title"]),
      text: [textOf(r, ["tags"]), list(r.ingredients).map((i) => str(i.item)).join(" ")].join(" "),
      detail: Array.isArray(r.tags) && r.tags.length ? r.tags.slice(0, 3).join(", ") : "",
    })),
  },
  {
    type: "task", label: "Task", plural: "Tasks", section: "do", keys: ["doPlans", "doBacklog", "doTasks"], server: true,
    collect: (d) => {
      const out = [];
      const add = (t, date) => out.push({ id: t.id, title: firstOf(t, ["title", "text"]), text: textOf(t, ["notes"]), date, detail: t.done ? "done" : (date ? "" : "backlog") });
      const plans = d.doPlans && typeof d.doPlans === "object" ? d.doPlans : {};
      for (const [week, days] of Object.entries(plans)) {
        if (!isDate(week) || !days || typeof days !== "object") continue;
        for (const [dayId, tasks] of Object.entries(days)) {
          const off = DO_DAY_OFFSETS[dayId];
          for (const t of list(tasks)) add(t, off == null ? week : addDays(week, off));
        }
      }
      for (const t of list(d.doBacklog)) add(t, null);
      for (const t of list(d.doTasks)) add(t, isDate(t.date) ? t.date : null);
      return out;
    },
  },
  {
    type: "event", label: "Event", plural: "Events", section: "plan", keys: ["planEvents"], server: true,
    collect: (d) => list(d.planEvents).map((e) => ({
      id: e.id, title: str(e.title), text: [textOf(e, ["notes"]), flat(e.location)].join(" "),
      date: isDate(e.date) ? e.date : null, detail: e.recurrence ? "repeats" : (e.startTime ? str(e.startTime) : ""),
    })),
  },
  {
    type: "trip", label: "Trip", plural: "Trips", section: "travel", keys: ["trips"], server: true,
    collect: (d) => list(d.trips).map((t) => ({
      id: t.id, title: firstOf(t, ["name", "title", "destination"]), text: textOf(t, ["destination", "notes"]),
      date: isDate(t.startDate) ? t.startDate : null, detail: str(t.destination) !== firstOf(t, ["name", "title", "destination"]) ? str(t.destination) : "",
    })),
  },
  {
    type: "trip_idea", label: "Trip idea", plural: "Trip ideas", section: "travel", keys: ["travelIdeas"], server: true,
    collect: (d) => list(d.travelIdeas).map((t) => ({ id: t.id, title: firstOf(t, ["name", "title", "destination", "place"]), text: textOf(t, ["destination", "place", "notes"]) })),
  },
  {
    type: "watch", label: "Watch", plural: "Watch list", section: "watch", keys: ["watchItems"], server: true,
    collect: (d) => list(d.watchItems).map((w) => ({
      id: w.id, title: str(w.title), text: textOf(w, ["year", "overview"]),
      detail: [w.type === "tv" ? "show" : "movie", w.status === "watched" ? "watched" : ""].filter(Boolean).join(", "),
    })),
  },
  {
    type: "article", label: "Saved article", plural: "Saved articles", section: "media", keys: ["savedArticles"], server: true,
    collect: (d) => list(d.savedArticles).map((a) => ({ id: a.id, title: str(a.title), text: textOf(a, ["author", "publication", "source"]), detail: firstOf(a, ["publication", "source"]) })),
  },
  {
    // Podcast shows carry their episode lists in the row, so this stays on the device.
    type: "podcast", label: "Podcast", plural: "Podcasts", section: "media", keys: ["podcasts"], server: false,
    collect: (d) => list(d.podcasts).map((p) => ({ id: p.id ?? p.feedUrl, title: firstOf(p, ["title", "name"]), text: textOf(p, ["author"]), detail: str(p.author) })),
  },
  {
    type: "shop", label: "Shopping list", plural: "Shopping list", section: "grocery", keys: ["persistentManualGroceries"], server: true,
    collect: (d) => (Array.isArray(d.persistentManualGroceries) ? d.persistentManualGroceries : [])
      .map((x) => (typeof x === "string" ? x : str(x?.name ?? x?.item))).filter(Boolean)
      .map((name) => ({ id: `shop:${fold(name)}`, title: name, text: "" })),
  },
  {
    type: "contact", label: "Contact", plural: "Contacts", section: "contacts", keys: ["contacts"], server: true,
    collect: (d) => list(d.contacts).map((c) => ({
      id: c.id, title: firstOf(c, ["name"]) || [str(c.firstName), str(c.lastName)].filter(Boolean).join(" "),
      text: textOf(c, ["emails", "email", "phones", "phone", "groups", "company"]), detail: str(c.company),
    })),
  },
];
export const SOURCE_TYPES = SOURCES.map((s) => s.type);
const SOURCE_BY_TYPE = new Map(SOURCES.map((s) => [s.type, s]));
export const typeLabel = (type) => SOURCE_BY_TYPE.get(type)?.label || type;
export const typePlural = (type) => SOURCE_BY_TYPE.get(type)?.plural || typeLabel(type);

// Kept for older callers/tests: { type, collection } pairs.
export const SEARCHABLE = SOURCES.flatMap((s) => s.keys.map((k) => ({ type: s.type, collection: k })));

// ── Docs ────────────────────────────────────────────────────────────────────
// Project one state-like object into docs, each tagged with its view.
// opts: { view, types }.
export function toSearchDocs(data, { view = null, types = null, sources = SOURCES } = {}) {
  const d = data && typeof data === "object" ? data : {};
  const want = types ? new Set(types) : null;
  const docs = [];
  const seen = new Set();
  for (const src of sources) {
    if (want && !want.has(src.type)) continue;
    let rows;
    try { rows = src.collect(d); } catch { rows = []; }
    for (const r of rows) {
      if (!r || r.id == null || r.id === "") continue;
      const title = str(r.title);
      if (!title) continue; // nothing to show/rank on
      const id = String(r.id);
      const key = `${src.type}|${view || ""}|${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push({ id, type: src.type, title, text: str(r.text), date: isDate(r.date) ? r.date : null, detail: str(r.detail), view: view || null });
    }
  }
  return docs;
}

// Several views' data at once: parts = [{ view, data }].
export function toSearchDocsForViews(parts, opts = {}) {
  return (Array.isArray(parts) ? parts : []).flatMap((p) => toSearchDocs(p?.data, { ...opts, view: p?.view || null }));
}

// ── Index ───────────────────────────────────────────────────────────────────
export function buildIndex(docs, stamp = null) {
  const docList = Array.isArray(docs) ? docs : [];
  const terms = new Map();
  docList.forEach((d, i) => {
    for (const t of new Set([...tokenize(d.title), ...tokenize(d.text)])) {
      if (!terms.has(t)) terms.set(t, new Set());
      terms.get(t).add(i);
    }
  });
  return { docs: docList, terms, stamp };
}

export function indexFromState(state, opts = {}) {
  return buildIndex(toSearchDocs(state, opts), state?.stateUpdatedAt || null);
}

export function isStale(index, state) {
  return !index || index.stamp !== (state?.stateUpdatedAt || null);
}

// Rebuild only when state has moved on (or the view changed). Returns
// (state, opts) => index. Holds one index in memory; never persisted.
export function createIndexCache() {
  let index = null;
  let key = null;
  return (state, opts = {}) => {
    const k = `${state?.stateUpdatedAt || ""}|${opts.view || ""}|${(opts.types || []).join(",")}`;
    if (!index || k !== key || !state?.stateUpdatedAt) { index = indexFromState(state, opts); key = k; }
    return index;
  };
}

// ── Search ──────────────────────────────────────────────────────────────────
// Every query term is matched exactly or as a prefix (partial typing). Ranking,
// highest first: how many query terms matched (all beats some), title matches,
// exact over prefix, the preferred view, then nearness of the date to today.
// opts: { limit, types, view (preferred), today (YYYY-MM-DD) }.
export function search(index, query, { limit = 20, types = null, view = null, today = null } = {}) {
  if (!index || !index.docs.length) return [];
  const qterms = [...new Set(tokenize(query))];
  if (!qterms.length) return [];
  const typeSet = types ? new Set(types) : null;
  const perDoc = new Map(); // di -> { matched:Set(qt), hits }
  for (const qt of qterms) {
    const bump = (set, w) => { for (const di of set) { const e = perDoc.get(di) || { matched: new Set(), hits: 0 }; e.matched.add(qt); e.hits += w; perDoc.set(di, e); } };
    if (index.terms.has(qt)) bump(index.terms.get(qt), 2);
    for (const [term, set] of index.terms) if (term !== qt && term.startsWith(qt)) bump(set, 1);
  }
  const results = [];
  for (const [di, e] of perDoc) {
    const d = index.docs[di];
    if (typeSet && !typeSet.has(d.type)) continue;
    const titleTokens = tokenize(d.title);
    const titleBoost = qterms.reduce((n, qt) => n + (titleTokens.includes(qt) ? 2 : titleTokens.some((t) => t.startsWith(qt)) ? 1 : 0), 0);
    let score = e.matched.size * 10 + e.hits + titleBoost;
    if (view && d.view === view) score += 1;
    if (today && d.date) {
      const days = Math.abs((Date.parse(`${d.date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 864e5);
      score += d.date >= today ? (days <= 60 ? 1 : 0.5) : (days <= 30 ? 0.5 : 0);
    }
    results.push({ id: d.id, type: d.type, title: d.title, detail: d.detail, date: d.date, view: d.view, score, ref: { type: d.type, id: d.id, view: d.view } });
  }
  results.sort((a, b) => b.score - a.score || String(b.date || "").localeCompare(String(a.date || "")) || a.title.localeCompare(b.title));
  return results.slice(0, Math.max(1, Math.min(100, Number(limit) || 20)));
}

// Results grouped by type, in the order the best result of each type appeared.
export function groupResults(results, perType = 3) {
  const groups = new Map();
  for (const r of results || []) {
    if (!groups.has(r.type)) groups.set(r.type, { type: r.type, label: typePlural(r.type), items: [], more: 0 });
    const g = groups.get(r.type);
    if (g.items.length < perType) g.items.push(r); else g.more += 1;
  }
  return [...groups.values()];
}
