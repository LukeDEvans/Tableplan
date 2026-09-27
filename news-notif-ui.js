// news-notif-ui.js — the Media page's notification bell: a swipe deck of news
// articles linked in NYT / Economist / Star Tribune emails (NEWS_INTAKE_DESIGN.md).
// Same look and gesture as the Meal Plan recipe deck (`.eat-swipe-*` markup +
// swipe-deck.js). Right swipe / Save → Media → Publications; left / Dismiss →
// gone for good (the server's seen record never re-delivers it).
//
// Data comes from gmail.js `pendingNews` — read when the app warms page dots and
// when the bell opens (at most once per REFRESH_MS). No polling.

import { attachSwipeGesture } from './swipe-deck.js';

const REFRESH_MS = 60_000;
const FLUSH_MS = 1500;
const BELL_ICON_FALLBACK = `<svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 4h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4z"/><path d="M19 8h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>`;

function dateLabel(iso) {
  const t = Date.parse(iso || "");
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Pure: the deck body for a list of cards. Exported for tests.
export function newsDeckHtml(articles, esc) {
  if (!articles.length) {
    return `<div class="eat-notif-head media-news-head">News</div><div class="eat-notif-empty media-news-empty">No new articles. Articles linked in your news emails show up here.</div>`;
  }
  return `
    <div class="eat-swipe-deck" data-news-deck>
      ${articles.map((a) => {
        const meta = [a.source, dateLabel(a.publishedAt)].filter(Boolean).join(" · ");
        return `
        <div class="eat-swipe-card" data-news-id="${esc(a.id)}">
          <div class="eat-swipe-action eat-swipe-action-del" aria-hidden="true">Dismiss</div>
          <div class="eat-swipe-action eat-swipe-action-add" aria-hidden="true">Save</div>
          <div class="eat-swipe-card-inner">
            <div class="eat-swipe-flip">
              <div class="eat-swipe-face eat-swipe-front">
                <button class="eat-swipe-media" type="button" data-news-flip aria-label="Show summary">
                  ${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
                  <span class="eat-swipe-media-fallback" aria-hidden="true">${BELL_ICON_FALLBACK}</span>
                </button>
                <div class="eat-swipe-meta">
                  <div class="eat-swipe-title">${esc(a.title)}</div>
                  ${a.subtitle ? `<div class="media-news-subtitle">${esc(a.subtitle)}</div>` : ""}
                  ${meta ? `<div class="eat-swipe-source">${esc(meta)}</div>` : ""}
                </div>
                <div class="eat-swipe-buttons">
                  <button class="secondary-btn eat-swipe-btn" type="button" data-news-dismiss>Dismiss</button>
                  <button class="primary-btn eat-swipe-btn" type="button" data-news-save>Save</button>
                </div>
              </div>
              <div class="eat-swipe-face eat-swipe-back">
                <div class="eat-swipe-back-head">
                  <button class="eat-swipe-flip-back" type="button" data-news-flip-back aria-label="Back to photo">← Photo</button>
                  <a class="eat-swipe-view" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>
                </div>
                <div class="eat-swipe-recipe">
                  <h3 class="eat-swipe-recipe-title">${esc(a.title)}</h3>
                  ${meta ? `<div class="eat-swipe-recipe-meta">${esc(meta)}</div>` : ""}
                  <p class="media-news-summary">${a.subtitle ? esc(a.subtitle) : "No summary available."}</p>
                </div>
              </div>
            </div>
          </div>
        </div>`;
      }).join("")}
    </div>`;
}

// Pure: the Media savedArticles record for an accepted card. Must match the
// server's accept record (gmail.js resolveNews) — same id, so the optimistic
// local copy and the server's copy merge into one (savedArticles unions by id).
export function acceptedArticleRecord(card, nowIso = new Date().toISOString()) {
  const pub = card.publishedAt ? new Date(card.publishedAt) : null;
  return {
    id: `nl-${card.id}`,
    url: card.url,
    title: card.title,
    subtitle: card.subtitle || "",
    image: card.image || "",
    author: card.source,
    date: pub && !Number.isNaN(pub.getTime()) ? pub.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "",
    publication: card.paper,
    savedAt: nowIso,
    text: null
  };
}

export function createNewsNotifModule(deps) {
  const { callGmailApi, escapeHtml, showToast, onAccepted, setDotCount, isSignedIn } = deps;
  let articles = null;     // null = never loaded
  let lastLoadedAt = 0;
  let open = false;
  let panel = null;
  let wired = false;

  const bell = () => document.getElementById("mediaNotificationsBtn");
  const badge = () => document.getElementById("mediaNotifBadge");

  function updateBadge() {
    const n = articles ? articles.length : 0;
    const b = badge();
    if (b) { b.textContent = n > 99 ? "99+" : String(n); b.hidden = n === 0; }
    setDotCount?.(n);
  }

  async function load(force = false) {
    if (!isSignedIn?.()) return;
    if (!force && articles && Date.now() - lastLoadedAt < REFRESH_MS) return;
    lastLoadedAt = Date.now();
    const d = await callGmailApi({ action: "pendingNews" });
    if (!Array.isArray(d?.articles)) return;
    const pendingIds = new Set(queue.map((x) => x.id));
    articles = d.articles.filter((a) => !pendingIds.has(a.id));
    updateBadge();
    if (open) render();
  }

  function position() {
    const b = bell();
    if (!b || !panel) return;
    const r = b.getBoundingClientRect();
    const gap = Math.max(8, Math.round(window.innerWidth - r.right));
    panel.style.left = gap + "px";
    panel.style.right = gap + "px";
    panel.style.bottom = gap + "px";
    panel.style.top = Math.round(r.bottom + 6) + "px";
  }

  function render() {
    if (!panel) return;
    panel.innerHTML = newsDeckHtml(articles || [], escapeHtml);
    position();
  }

  function setOpen(next) {
    open = next;
    bell()?.setAttribute("aria-expanded", String(open));
    if (!open) { flush(); panel?.remove(); panel = null; return; }
    panel = document.createElement("div");
    panel.className = "eat-notif-panel eat-notif-panel-swipe media-news-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "News notifications");
    document.body.appendChild(panel);
    wirePanel(panel);
    if (articles) render();
    else panel.innerHTML = `<div class="eat-notif-empty media-news-empty">Loading…</div>`;
    load();
  }

  function cardFor(id) { return (articles || []).find((a) => a.id === id) || null; }

  function remove(id) {
    articles = (articles || []).filter((a) => a.id !== id);
    updateBadge();
    render();
  }

  // Swipe decisions are batched: one server round-trip per pause in swiping
  // (FLUSH_MS), on panel close, and when the page is hidden — not one per card.
  let queue = [];
  let flushTimer = null;
  function enqueue(id, decision) {
    queue.push({ id, decision });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, FLUSH_MS);
  }
  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!queue.length) return;
    const decisions = queue;
    queue = [];
    callGmailApi({ action: "resolveNews", decisions }).then((d) => {
      if (d) return;
      // Server unreachable: the cards stay pending there and will reappear on the
      // next load. Accepted articles are already saved on this device.
      if (decisions.some((x) => x.decision === "accept")) showToast?.("Couldn't reach the server — saved articles are kept on this device.");
    });
  }

  function accept(id) {
    const card = cardFor(id);
    if (!card) return;
    remove(id);
    onAccepted?.(acceptedArticleRecord(card));
    enqueue(id, "accept");
    showToast?.(`Saved “${card.title}” to Publications.`);
  }

  function dismiss(id) {
    if (!cardFor(id)) return;
    remove(id);
    enqueue(id, "dismiss");
  }

  function flip(cardEl, on) {
    cardEl.querySelector(".eat-swipe-flip")?.classList.toggle("is-flipped", on);
    const deck = cardEl.closest(".eat-swipe-deck");
    if (deck) deck.classList.toggle("is-card-flipped", !!deck.querySelector(".eat-swipe-flip.is-flipped"));
  }

  function wirePanel(el) {
    el.addEventListener("click", (e) => {
      const cardEl = e.target.closest(".eat-swipe-card");
      const id = cardEl?.dataset.newsId;
      if (!cardEl || !id) return;
      if (e.target.closest("[data-news-save]")) { accept(id); return; }
      if (e.target.closest("[data-news-dismiss]")) { dismiss(id); return; }
      if (e.target.closest("[data-news-flip]")) { flip(cardEl, true); return; }
      if (e.target.closest("[data-news-flip-back]")) { flip(cardEl, false); return; }
      if (e.target.closest(".eat-swipe-back") && !e.target.closest("a, button")) flip(cardEl, false);
    });
    attachSwipeGesture(el, {
      onAccept: (cardEl) => accept(cardEl.dataset.newsId),
      onDismiss: (cardEl) => dismiss(cardEl.dataset.newsId)
    });
  }

  function wire() {
    if (wired) return;
    wired = true;
    bell()?.addEventListener("click", (e) => { e.stopPropagation(); setOpen(!open); });
    document.addEventListener("click", (e) => {
      if (!open || !panel) return;
      if (panel.contains(e.target) || bell()?.contains(e.target)) return;
      setOpen(false);
    }, { capture: true });
    document.addEventListener("keydown", (e) => { if (open && e.key === "Escape") setOpen(false); });
    window.addEventListener("resize", () => { if (open) position(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  }

  return {
    wire,
    warm: () => load(),
    close: () => { if (open) setOpen(false); },
    // Local-dev test hook: seed the deck without the network.
    seed: (list) => { articles = list; lastLoadedAt = Date.now(); updateBadge(); if (open) render(); return articles.length; }
  };
}
