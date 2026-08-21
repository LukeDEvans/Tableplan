// Travel refs — the association layer. A trip enriches itself from the rest of
// Live by REFERENCING canonical objects (a movie in Watch, a podcast in Media, a
// shopping need in Shop, an item in Inventory), never by copying them. Each ref
// is a lightweight pointer the trip owns; the real object stays owned by its
// module. This keeps Explore a contextual layer over Live rather than a second
// copy of it. Pure logic — the app supplies the canonical lists and does the
// rendering.

export const REF_KINDS = Object.freeze({
  WATCH: "watch",       // a movie/show in Watch
  PODCAST: "podcast",   // a show in Media
  ARTICLE: "article",   // a saved article in Media
  BOOK: "book",         // a reading item in Media
  SHOP: "shop",         // a shopping need (buckets: before/during/bring-home)
  INVENTORY: "inventory", // something the household owns (for packing)
  CONTACT: "contact",
  CALENDAR: "calendar",
  LINK: "link",         // a free-form URL
  NOTE: "note",         // a free-form text idea
});

export const SHOP_BUCKETS = Object.freeze(["before", "during", "bring-home"]);
export const SHOP_BUCKET_LABELS = Object.freeze({ before: "Before leaving", during: "While traveling", "bring-home": "Bring home" });

export const REF_KIND_META = Object.freeze({
  watch:     { icon: "🎬", label: "Watch", group: "enrich" },
  podcast:   { icon: "🎧", label: "Listen", group: "enrich" },
  article:   { icon: "📰", label: "Read", group: "enrich" },
  book:      { icon: "📚", label: "Read", group: "enrich" },
  shop:      { icon: "🛍️", label: "Shopping", group: "prepare" },
  inventory: { icon: "🧳", label: "Packing", group: "prepare" },
  contact:   { icon: "👤", label: "Contacts", group: "prepare" },
  calendar:  { icon: "📅", label: "Calendar", group: "prepare" },
  link:      { icon: "🔗", label: "Links", group: "enrich" },
  note:      { icon: "💭", label: "Notes", group: "enrich" },
});

let _n = 0;
function uid() { _n += 1; return `ref_${Date.now().toString(36)}${_n.toString(36)}${Math.random().toString(36).slice(2, 5)}`; }

export function makeRef(kind, { refId = null, title = "", subtitle = "", meta = null, bucket = null, url = "" } = {}) {
  return { id: uid(), kind, refId: refId != null ? String(refId) : null, title: String(title), subtitle: String(subtitle), meta, bucket, url: String(url || ""), createdAt: new Date().toISOString() };
}

// Identity for dedupe: a ref to a canonical object is identified by kind+refId;
// a free-form ref by kind+lowercased title.
function refIdentity(ref) {
  return ref.refId ? `${ref.kind}:${ref.refId}` : `${ref.kind}:~${String(ref.title).trim().toLowerCase()}`;
}

export function hasRef(refs, ref) {
  const id = refIdentity(ref);
  return (refs || []).some(r => refIdentity(r) === id);
}

// Add a ref unless an equivalent one already exists. Returns a NEW array (never
// mutates) so callers control persistence; idempotent by identity.
export function addRef(refs, ref) {
  const list = Array.isArray(refs) ? refs : [];
  if (hasRef(list, ref)) return list;
  return [...list, ref];
}

export function removeRef(refs, id) {
  return (Array.isArray(refs) ? refs : []).filter(r => r.id !== id);
}

export function refsOfKind(refs, kind) {
  return (Array.isArray(refs) ? refs : []).filter(r => r.kind === kind);
}

// Group refs by kind, preserving insertion order within each.
export function groupByKind(refs) {
  const out = {};
  (Array.isArray(refs) ? refs : []).forEach(r => { (out[r.kind] = out[r.kind] || []).push(r); });
  return out;
}

// Shopping refs grouped into the three trip buckets (unknown buckets fall into
// "before" so nothing is lost).
export function shopByBucket(refs) {
  const out = { before: [], during: [], "bring-home": [] };
  refsOfKind(refs, REF_KINDS.SHOP).forEach(r => { (out[SHOP_BUCKETS.includes(r.bucket) ? r.bucket : "before"]).push(r); });
  return out;
}

// Rank canonical candidates for "bring it along" enrichment: items whose text
// mentions the destination come first, then most-recent. `getText` extracts a
// searchable string; `getTime` an ISO/sortable string. Pure and deterministic.
export function rankCandidates(items, destination, { getText = x => x.title || "", getTime = x => x.createdAt || "", limit = 6 } = {}) {
  const dest = String(destination || "").trim().toLowerCase();
  const terms = dest ? dest.split(/[\s,]+/).filter(t => t.length >= 3) : [];
  const scored = (items || []).map(it => {
    const text = String(getText(it) || "").toLowerCase();
    const match = terms.some(t => text.includes(t));
    return { it, match, time: String(getTime(it) || "") };
  });
  scored.sort((a, b) => {
    if (a.match !== b.match) return a.match ? -1 : 1;
    return b.time.localeCompare(a.time);
  });
  return scored.slice(0, limit).map(s => ({ item: s.it, matched: s.match }));
}
