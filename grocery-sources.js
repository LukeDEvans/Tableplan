// Shop source-reconciliation — the pure core of the "Shop is a dynamic
// projection of active household needs" model. No DOM, no global state: every
// dependency is injected, so this is unit-testable in isolation.
//
// A shopping NEED is keyed by the existing canonical grocery key. Multiple
// SOURCES (Meal Plan, Checklist, Manual) can contribute to the same need; the
// need stays active while ANY source still requires it, and a source changing
// state only changes its own contribution (source independence).
//
// This module deliberately does NOT know about stores, pricing, or rendering —
// those stay in the existing app.js routing/optimization code, which we reuse.

const SOURCE = { MEALPLAN: "mealplan", CHECKLIST: "checklist", MANUAL: "manual" };

// Merge every source's rows into one active row per canonical key, tagging each
// merged row with the set of sources that contributed to it (row.sources) and a
// per-source lookup (row.sourceMeta) for subtle contextual labels.
//
// contributions: [{ source, rows: [row...] }]  (rows already carry .key etc.)
// deps.mergeRows(rows) -> merged rows (the existing identity/aggregation merge)
// deps.keyOf(row)      -> canonical key for a raw input row
function reconcileSources(contributions, deps) {
  const { mergeRows, keyOf } = deps;
  const sourcesByKey = new Map(); // key -> Set(source)
  const metaByKey = new Map();    // key -> { source -> meta }
  const all = [];
  for (const { source, rows } of contributions || []) {
    for (const row of rows || []) {
      const k = keyOf(row);
      if (!k) continue;
      if (!sourcesByKey.has(k)) { sourcesByKey.set(k, new Set()); metaByKey.set(k, {}); }
      sourcesByKey.get(k).add(source);
      const meta = metaByKey.get(k);
      // Count contributions per source (e.g. Meal Plan · 6) without summing quantities.
      meta[source] = meta[source] ? { ...meta[source], count: (meta[source].count || 1) + 1 } : { count: 1 };
      all.push(row);
    }
  }
  const merged = mergeRows(all) || [];
  for (const row of merged) {
    const set = sourcesByKey.get(row.key);
    row.sources = set ? [...set] : [];
    row.sourceMeta = metaByKey.get(row.key) || {};
  }
  return { rows: merged, sourcesByKey, metaByKey };
}

// Whether a merged need still has at least one active source. A purchased/cleared
// need is satisfied for the cycle regardless of sources (that's handled by the
// caller via the cleared set, not here).
function isNeedActive(row) {
  return Array.isArray(row?.sources) && row.sources.length > 0;
}

// ── Checklist ────────────────────────────────────────────────────────────────
// A recurring weekly review, configured in Settings, that restarts every Friday.
// The user provisionally CHECKS items they've determined they do NOT need; the
// contribution is only committed on Submit. Everything here is cycle-keyed by the
// caller (the app's Friday-anchored groceryCycleKey), so the Friday reset is just
// "a new cycle has no submission yet".

// The checklist's contribution for a cycle = configured items the user did NOT
// check in that cycle's submitted answers. No submission yet ⇒ no contribution
// (a fresh Friday cycle starts empty until the user submits).
function checklistContribution(config, submission) {
  if (!submission || !submission.submittedAt) return [];
  const checked = submission.checked || {};
  return (config || [])
    .filter((entry) => entry && entry.name && !checked[entry.id])
    .map((entry) => ({ id: entry.id, name: entry.name }));
}

// Build the submission record from the user's current provisional answers.
// `answers` is { [configItemId]: true } for CHECKED (not-needed) items; we keep
// only ids that still exist in config so a removed config item can't linger.
function buildChecklistSubmission(config, answers, nowISO) {
  const validIds = new Set((config || []).map((e) => e && e.id).filter(Boolean));
  const checked = {};
  for (const [id, on] of Object.entries(answers || {})) {
    if (on && validIds.has(id)) checked[id] = true;
  }
  return { submittedAt: nowISO, checked };
}

// True when the current provisional answers differ from what was submitted, i.e.
// there are un-committed changes (used to enable/label the Submit button and to
// keep Shop unchanged until the user submits again).
function checklistHasPendingChanges(config, submission, answers) {
  const submitted = (submission && submission.checked) || {};
  const validIds = (config || []).map((e) => e && e.id).filter(Boolean);
  if (!submission || !submission.submittedAt) {
    // Never submitted this cycle: pending if the user has checked anything.
    return validIds.some((id) => (answers || {})[id]);
  }
  return validIds.some((id) => Boolean((answers || {})[id]) !== Boolean(submitted[id]));
}

// ── Next Stop ────────────────────────────────────────────────────────────────
// Store- and date-independent persistent intents. These never regenerate; they
// live in their own list and are removed only on purchase or explicit removal.
// Modeled as a flat persistent array so they never touch store routing.

function normalizeNextStopItems(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const obj = typeof raw === "string" ? { name: raw } : (raw && typeof raw === "object" ? raw : null);
    if (!obj) continue;
    const name = String(obj.name || "").trim();
    if (!name) continue;
    const id = String(obj.id || "").trim() || `ns_${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({ id, name, quantity: String(obj.quantity || "").trim() });
  }
  return out;
}

// ── Store move interaction ────────────────────────────────────────────────────
// Ordered destinations for the move sheet: the item's preferred stores first (in
// rank order), then the remaining enabled stores, then Other. Skipped/disabled
// stores are excluded by the caller (it passes only enabled stores). Pure.
function moveDestinations({ stores = [], rank = [], currentStoreId = "" }) {
  const byId = new Map(stores.map((s) => [s.id, s]));
  const seen = new Set();
  const out = [];
  for (const id of rank) {
    if (byId.has(id) && !seen.has(id)) { seen.add(id); out.push({ id, name: byId.get(id).name }); }
  }
  for (const s of stores) {
    if (!seen.has(s.id)) { seen.add(s.id); out.push({ id: s.id, name: s.name }); }
  }
  out.push({ id: "", name: "Other" });
  return out.map((d) => ({ ...d, current: d.id === currentStoreId }));
}

// A manual move shows the temp/permanent confirmation ONLY when the item already
// resolves to a valid store and the target is a different store (spec #13/#14).
// Moving from Other (no current store) or to Other is a direct action.
function moveNeedsConfirmation({ currentStoreId, targetStoreId }) {
  return Boolean(currentStoreId) && Boolean(targetStoreId) && currentStoreId !== targetStoreId;
}

// ── Drag autoscroll (pure math for the shared pointer-drag utility) ────────────
// Given the pointer's Y, a scrollable container's rect, an activation band, and a
// max speed, return px/frame to scroll (negative = up). Zero in the middle; ramps
// to maxSpeed at the very edge. This is what makes a destination list reliably
// scrollable while an item is being dragged, including toward off-screen targets.
function autoscrollVelocity(pointerY, rect, band = 64, maxSpeed = 18) {
  if (!rect || band <= 0) return 0;
  const topDist = pointerY - rect.top;
  const bottomDist = rect.bottom - pointerY;
  if (topDist < band) {
    const t = Math.max(0, Math.min(1, (band - topDist) / band));
    return -Math.ceil(t * maxSpeed);
  }
  if (bottomDist < band) {
    const t = Math.max(0, Math.min(1, (band - bottomDist) / band));
    return Math.ceil(t * maxSpeed);
  }
  return 0;
}

export {
  SOURCE,
  reconcileSources,
  isNeedActive,
  checklistContribution,
  buildChecklistSubmission,
  checklistHasPendingChanges,
  normalizeNextStopItems,
  moveDestinations,
  moveNeedsConfirmation,
  autoscrollVelocity
};
