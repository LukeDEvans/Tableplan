// publications-render.js — PURE HTML builders for the Publications UI (Phase 2B-UI).
// No DOM, no state, no events, no fetching: given already-computed data (from
// publications-notify.js projections), returns HTML strings the shell injects. This
// keeps the visual structure unit-testable (string assertions, no browser) while the
// thin app.js wiring owns the container + delegated event handlers. Reuses existing
// visual classes (article-row, watch-category-tabs, badge) — no new design system.

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// A human date label from an ISO string (or "" when absent).
function dateLabel(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "";
  try { return new Date(t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }); }
  catch { return new Date(t).toISOString().slice(0, 10); }
}

function pubName(article, pubsById) {
  const p = article.publicationId && pubsById ? pubsById[article.publicationId] : null;
  return p?.name || article.category || "";
}

// One triage card. FRONT: title/publication/author/date/image. BACK (flipped):
// the RSS excerpt. Tapping flips (data-pub-flip) — it does NOT open/play/read
// (§16/§32/§33). Explicit Save/Dismiss buttons (accessible, not swipe-only §43).
export function notificationCardHtml(article, { pubsById } = {}) {
  const title = esc(article.title || "(untitled)");
  const pub = esc(pubName(article, pubsById));
  const author = esc(article.author || "");
  const date = esc(dateLabel(article.publishedAt));
  const excerpt = esc((article.description || "").slice(0, 500)) || "No preview available.";
  const meta = [pub, author, date].filter(Boolean).join(" · ");
  const img = article.imageUrl
    ? `<img class="pub-card-img" src="${esc(article.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
  return `<article class="pub-card" data-article-id="${esc(article.id)}" tabindex="0" role="group" aria-label="${title}">
    <button class="pub-card-flip" type="button" data-pub-flip aria-label="Show preview">
      <div class="pub-card-face pub-card-front">
        ${img}
        <div class="pub-card-text"><div class="pub-card-title">${title}</div>${meta ? `<div class="pub-card-meta">${meta}</div>` : ""}</div>
      </div>
      <div class="pub-card-face pub-card-back"><div class="pub-card-excerpt">${excerpt}</div></div>
    </button>
    <div class="pub-card-actions">
      <button class="pub-btn pub-dismiss" type="button" data-pub-dismiss="${esc(article.id)}">Dismiss</button>
      <button class="pub-btn pub-save" type="button" data-pub-save="${esc(article.id)}">Save</button>
    </div>
  </article>`;
}

// The Notifications triage deck (pending), or an empty state.
export function notificationDeckHtml(pending, { pubsById } = {}) {
  if (!pending || !pending.length) {
    return `<div class="pub-empty">No new articles to triage. You're all caught up.</div>`;
  }
  return `<div class="pub-deck">${pending.map((a) => notificationCardHtml(a, { pubsById })).join("")}</div>`;
}

// One retained-library row (compact; click → details later, never auto-play §32).
export function libraryRowHtml(article, { pubsById } = {}) {
  const meta = [esc(pubName(article, pubsById)), esc(article.author || ""), esc(dateLabel(article.publishedAt))].filter(Boolean).join(" · ");
  return `<div class="article-row pub-lib-row" data-article-id="${esc(article.id)}" role="button" tabindex="0">
    <div class="article-row-main"><div class="article-row-title">${esc(article.title || "(untitled)")}</div>${meta ? `<div class="article-row-sub">${meta}</div>` : ""}</div>
  </div>`;
}

export function libraryListHtml(articles, { pubsById, emptyText = "No saved articles yet." } = {}) {
  if (!articles || !articles.length) return `<div class="pub-empty">${esc(emptyText)}</div>`;
  return `<div class="pub-lib-list">${articles.map((a) => libraryRowHtml(a, { pubsById })).join("")}</div>`;
}

// Publication filter chips for the library ("All" + each publication).
export function publicationTabsHtml(pubs, activePublicationId) {
  const chip = (id, label, active) =>
    `<button class="watch-category-tab${active ? " is-active" : ""}" type="button" role="tab" data-pub-filter="${esc(id)}">${esc(label)}</button>`;
  return `<div class="watch-category-tabs" role="tablist" aria-label="Publications">
    ${chip("all", "All", !activePublicationId)}
    ${(pubs || []).map((p) => chip(p.id, p.name || "(publication)", activePublicationId === p.id)).join("")}
  </div>`;
}

// The whole panel: header (tabs + badge) + the active view.
export function publicationsPanelHtml({ tab = "notifications", badge = 0, badgeLabel = "0", pending = [], retained = [], pubs = [], activePublicationId = null, pubsById = {} } = {}) {
  const tabBtn = (id, label, extra = "") =>
    `<button class="watch-category-tab${tab === id ? " is-active" : ""}" type="button" role="tab" data-pub-tab="${id}">${esc(label)}${extra}</button>`;
  const badgeHtml = badge > 0 ? ` <span class="pub-badge" aria-label="${badge} new">${esc(badgeLabel)}</span>` : "";
  const body = tab === "library"
    ? publicationTabsHtml(pubs, activePublicationId) + libraryListHtml(retained, { pubsById })
    : notificationDeckHtml(pending, { pubsById });
  return `<div class="pub-panel">
    <div class="pub-panel-head">
      <div class="watch-category-tabs" role="tablist" aria-label="Publications sections">
        ${tabBtn("notifications", "Notifications", badgeHtml)}
        ${tabBtn("library", "Library")}
      </div>
      <button class="icon-btn pub-refresh" type="button" data-pub-refresh title="Refresh feeds" aria-label="Refresh feeds">↻</button>
    </div>
    <div class="pub-panel-body">${body}</div>
  </div>`;
}
