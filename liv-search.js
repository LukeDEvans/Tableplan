// liv-search.js — the instant results under Chat with Liv's box
// (UTILITIES_MENU_DESIGN.md §4, UNIVERSAL_SEARCH_DESIGN.md phase 4). Pure.
//
// The device holds one view's rows in `state` and the others as shadow copies;
// searchParts() gathers what each of the person's views can see so results come
// from all of them (decision 1), each labelled with its own view.

import { SOURCES, groupResults } from "./search-index.js";
import { scopeForView } from "./views.js";

// Sections that are one row whatever the view (app.js SECTION_SCOPE).
export const FIXED_SECTION_SCOPE = Object.freeze({ eat: "household", contacts: "household", config: "household", listen: "personal", recreate: "personal" });

// views: the person's views; scopeData(section, scope) → that row's data or null.
// Returns [{ view, data }] with only the keys each source names.
export function searchParts({ views = [], hasBusiness = false, scopeData = () => null, sources = SOURCES } = {}) {
  const byScope = new Map();
  for (const view of views) {
    for (const src of sources) {
      const scope = FIXED_SECTION_SCOPE[src.section] || scopeForView(view, src.section, { hasBusiness });
      if (!views.includes(scope)) continue;
      const data = scopeData(src.section, scope);
      if (!data || typeof data !== "object") continue;
      const bucket = byScope.get(scope) || {};
      for (const k of src.keys) if (!(k in bucket) && data[k] !== undefined) bucket[k] = data[k];
      byScope.set(scope, bucket);
    }
  }
  return [...byScope].map(([view, data]) => ({ view, data }));
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// The results list: "Ask Liv: …" first, then up to three per kind.
// viewLabel(view) names a view; currentView's results carry no label.
export function searchResultsHtml(query, results, { viewLabel = (v) => v, currentView = null, perType = 3 } = {}) {
  const q = String(query || "").trim();
  if (!q) return "";
  const groups = groupResults(results, perType);
  const row = (r) => {
    const bits = [r.detail, r.date, r.view && r.view !== currentView ? viewLabel(r.view) : ""].filter(Boolean);
    return `<button type="button" class="liv-result" role="option" data-ref-type="${esc(r.type)}" data-ref-id="${esc(r.id)}" data-ref-view="${esc(r.view || "")}"><span class="liv-result-title">${esc(r.title)}</span>${bits.length ? `<span class="liv-result-meta">${esc(bits.join(" · "))}</span>` : ""}</button>`;
  };
  return `<button type="button" class="liv-result liv-result-ask" role="option" data-ask="1"><span class="liv-result-title">Ask Liv: ${esc(q)}</span></button>`
    + groups.map((g) => `<div class="liv-result-group"><p class="liv-result-head">${esc(g.label)}${g.more ? ` <span>+${g.more}</span>` : ""}</p>${g.items.map(row).join("")}</div>`).join("");
}
