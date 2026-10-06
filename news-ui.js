// news-ui.js — the News page (NEWS_PAGE_DESIGN.md). Articles linked in the
// newspapers' emails (collected server-side by the mail sweep, _news-links.js),
// sorted into newspaper sections, in the same shell as Mail and Media: a top bar,
// a sidebar directory (Front page · Briefings · Sent to Media · sections · papers)
// and the stories. Each story's ⋯ menu: Send to Media, Open, Listen, Share, Hide.
//
// Data: gmail.js `newsFeed` — read when the page opens (at most once a minute)
// and on Refresh. No polling. Read / send / hide are batched into one
// `updateNews` call. Briefings come from client state (savedArticles "news-*").

const REFRESH_MS = 60_000;
const FLUSH_MS = 1500;
const DAY_MS = 86_400_000;
const KEEP_DAYS = 3;          // matches the server's FRESH_DAYS
const LEAD_WINDOW_MS = 36 * 3_600_000;
const SIGNIN_RECHECK_MS = DAY_MS;

export const NEWS_SECTIONS = [
  { key: "world", label: "World" },
  { key: "us", label: "U.S." },
  { key: "politics", label: "Politics" },
  { key: "mn", label: "Minnesota" },
  { key: "business", label: "Business" },
  { key: "science", label: "Science & Health" },
  { key: "opinion", label: "Opinion" },
  { key: "culture", label: "Culture" },
  { key: "sports", label: "Sports" },
  { key: "more", label: "More" }
];
export const NEWS_PAPERS = [
  { key: "nyt", label: "New York Times", mark: "T" },
  { key: "economist", label: "The Economist", mark: "E" },
  { key: "startribune", label: "Star Tribune", mark: "S" },
  { key: "athletic", label: "The Athletic", mark: "A" }
];
const SECTION_LABEL = Object.fromEntries(NEWS_SECTIONS.map((s) => [s.key, s.label]));
const PAPER = Object.fromEntries(NEWS_PAPERS.map((p) => [p.key, p]));
const signInPaperFor = (paper) => (paper === "athletic" ? "nyt" : paper);

const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isNaN(t) ? 0 : t; };
const cardTime = (c) => ms(c.publishedAt) || ms(c.discoveredAt);
const sectionOf = (c) => (SECTION_LABEL[c?.section] ? c.section : "more");

// ── Pure helpers (exported for tests) ────────────────────────────────────────

// The articles a sidebar view shows, newest first. `view`: { kind, key }.
export function articlesForView(articles, view, query = "") {
  let list = (articles || []).filter((a) => a && a.id && a.url);
  if (view?.kind === "section") list = list.filter((a) => sectionOf(a) === view.key);
  else if (view?.kind === "paper") list = list.filter((a) => a.paper === view.key);
  else if (view?.kind === "sent") list = list.filter((a) => a.sentAt);
  const q = String(query || "").trim().toLowerCase();
  if (q) list = list.filter((a) => `${a.title} ${a.subtitle || ""} ${a.source || ""}`.toLowerCase().includes(q));
  return list.sort((a, b) => cardTime(b) - cardTime(a));
}

// The lead story plus the rest, in display order (Q3): newsletter leads from the
// last ~36 h first (most recent lead on top), then everything else newest first.
export function arrangeFront(list, nowMs = Date.now()) {
  const isLead = (a) => a.lead && nowMs - ms(a.lead) <= LEAD_WINDOW_MS;
  const leads = list.filter(isLead).sort((a, b) => ms(b.lead) - ms(a.lead));
  const rest = list.filter((a) => !isLead(a));
  const ordered = [...leads, ...rest];
  return { lead: ordered[0] || null, rest: ordered.slice(1) };
}

// Unread counts per section, per paper, and overall.
export function unreadCounts(articles) {
  const out = { all: 0, sent: 0, section: {}, paper: {} };
  for (const a of articles || []) {
    if (a.sentAt) out.sent++;
    if (a.readAt) continue;
    out.all++;
    const s = sectionOf(a);
    out.section[s] = (out.section[s] || 0) + 1;
    out.paper[a.paper] = (out.paper[a.paper] || 0) + 1;
  }
  return out;
}

// Today's newsletters, already converted into listenable articles in Media.
export function briefingsFrom(savedArticles, nowMs = Date.now()) {
  return (savedArticles || [])
    .filter((a) => a && String(a.id || "").startsWith("news-") && nowMs - ms(a.savedAt) <= KEEP_DAYS * DAY_MS)
    .sort((a, b) => ms(b.savedAt) - ms(a.savedAt));
}

// Does the sign-in status need a fresh check (any paper never checked, or over 24 h)?
export function signInsNeedCheck(signIns, nowMs = Date.now()) {
  return ["nyt", "economist", "startribune"].some((p) => {
    const at = ms(signIns?.[p]?.checkedAt);
    return !at || nowMs - at > SIGNIN_RECHECK_MS;
  });
}

// "signed-in" | "unverified" | "expired" | "none" | "unknown" for a paper.
export function paperStatus(signIns, paper) {
  return signIns?.[signInPaperFor(paper)]?.status || "unknown";
}

// The Media savedArticles record for a sent card. Must match the server's
// (_news-links.js acceptedArticleRecord) — same id, so the optimistic local copy
// and the server's copy merge into one (savedArticles unions by id).
export function sentArticleRecord(card, nowIso = new Date().toISOString()) {
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

// Apply queued-but-unflushed decisions to a freshly loaded list, so a load that
// races a pending write never brings a hidden card back or un-reads one.
export function applyLocalDecisions(list, decisions) {
  const hide = new Set(), read = new Map(), sent = new Set();
  for (const d of decisions || []) {
    if (d.decision === "hide") hide.add(d.id);
    else if (d.decision === "send") sent.add(d.id);
    else read.set(d.id, d.decision === "read");
  }
  const now = new Date().toISOString();
  return (list || []).filter((a) => !hide.has(a.id)).map((a) => {
    if (!read.has(a.id) && !sent.has(a.id)) return a;
    const next = { ...a };
    if (sent.has(a.id) && !next.sentAt) next.sentAt = now;
    if (read.get(a.id) === true && !next.readAt) next.readAt = now;
    if (read.get(a.id) === false) delete next.readAt;
    return next;
  });
}

export function timeAgo(iso, nowMs = Date.now()) {
  const t = ms(iso);
  if (!t) return "";
  const mins = Math.max(0, Math.round((nowMs - t) / 60_000));
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

// ── Module ───────────────────────────────────────────────────────────────────

const ICONS = {
  front: '<svg viewBox="0 0 24 24" class="article-sidebar-icon" aria-hidden="true"><path d="M4 4h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4z"/><path d="M19 8h1a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"/><line x1="7" y1="8" x2="14" y2="8"/><line x1="7" y1="12" x2="14" y2="12"/><line x1="7" y1="16" x2="11" y2="16"/></svg>',
  briefings: '<svg viewBox="0 0 24 24" class="article-sidebar-icon" aria-hidden="true"><path d="M4 4h16v16H4z"/><path d="m4 7 8 6 8-6"/></svg>',
  sent: '<svg viewBox="0 0 24 24" class="article-sidebar-icon" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
  listen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3z"/><path d="M3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
  hide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  media: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>'
};

export function createNewsModule(deps) {
  const {
    callGmailApi, escapeHtml: esc, showToast, isSignedIn, getState, onSentToMedia,
    openInMedia, listenInMedia, openSignInSettings, getActiveAppArea, setDotCount
  } = deps;

  let articles = null;   // null = never loaded
  let signIns = {};
  let lastLoadedAt = 0;
  let loading = false;
  let loadError = "";
  let view = { kind: "front" };
  let query = "";
  let openMenuId = null;
  let wired = false;
  let verifying = false;

  const $ = (id) => document.getElementById(id);
  const isNarrow = () => window.innerWidth <= 680;
  const isActive = () => getActiveAppArea?.() === "news";

  // ── Decision queue (batched like the old bell deck) ──
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
    callGmailApi({ action: "updateNews", decisions }).then((d) => {
      if (Array.isArray(d?.articles)) {
        articles = applyLocalDecisions(d.articles, queue);
        updateDot();
        if (isActive()) render();
        return;
      }
      // Server unreachable: put the decisions back for the next flush.
      queue = [...decisions, ...queue];
      showToast?.("Couldn't reach the server. News will retry your changes.");
    });
  }

  function updateDot() { setDotCount?.(articles ? unreadCounts(articles).all : 0); }

  async function load(force = false) {
    if (!isSignedIn?.()) { if (!articles) loadError = "Sign in to see your news."; render(); return; }
    if (loading) return;
    if (!force && articles && Date.now() - lastLoadedAt < REFRESH_MS) return;
    loading = true;
    lastLoadedAt = Date.now();
    if (!articles) render();
    const d = await callGmailApi({ action: "newsFeed" });
    loading = false;
    if (!Array.isArray(d?.articles)) {
      loadError = articles ? "" : "Couldn't load News. Try Refresh.";
      render();
      return;
    }
    loadError = "";
    articles = applyLocalDecisions(d.articles, queue);
    signIns = d.signIns || {};
    updateDot();
    render();
    if (signInsNeedCheck(signIns)) verifySignIns();
  }

  // Re-check every paper's sign-in with the cookies saved in Settings → Sync.
  async function verifySignIns() {
    if (verifying || !isSignedIn?.()) return;
    verifying = true;
    const sync = getState()?.articleSync || {};
    const d = await callGmailApi({
      action: "verifyNewsSignIns",
      cookies: { nytCookie: sync.nytCookie || "", economistCookie: sync.economistCookie || "", stribCookie: sync.stribCookie || "" }
    });
    verifying = false;
    if (d?.signIns) { signIns = d.signIns; if (isActive()) render(); }
  }

  function cardFor(id) { return (articles || []).find((a) => a.id === id) || null; }
  function patch(id, fn) {
    articles = (articles || []).map((a) => (a.id === id ? fn({ ...a }) : a));
  }

  function markRead(id) {
    const a = cardFor(id);
    if (!a || a.readAt) return;
    patch(id, (x) => ({ ...x, readAt: new Date().toISOString() }));
    enqueue(id, "read");
  }
  function sendToMedia(id, { quiet = false } = {}) {
    const a = cardFor(id);
    if (!a) return null;
    const record = sentArticleRecord(a);
    if (!a.sentAt) {
      patch(id, (x) => ({ ...x, sentAt: new Date().toISOString() }));
      enqueue(id, "send");
      onSentToMedia?.(record);
      if (!quiet) showToast?.("Sent to Media → Publications.");
    } else if (!quiet) {
      showToast?.("Already in Media → Publications.");
    }
    return record;
  }
  function hide(id) {
    if (!cardFor(id)) return;
    articles = articles.filter((a) => a.id !== id);
    enqueue(id, "hide");
    showToast?.("Hidden. It won't come back.");
  }
  async function share(id) {
    const a = cardFor(id);
    if (!a) return;
    try {
      if (navigator.share) { await navigator.share({ title: a.title, url: a.url }); return; }
    } catch (e) {
      if (e?.name === "AbortError") return; // the user closed the share sheet
    }
    try { await navigator.clipboard.writeText(a.url); showToast?.("Link copied."); }
    catch { showToast?.(a.url); }
  }
  function open(id) {
    const record = sendToMedia(id, { quiet: true });
    markRead(id);
    flush();
    if (record) openInMedia?.(record.id);
  }
  function listen(id) {
    const record = sendToMedia(id, { quiet: true });
    markRead(id);
    flush();
    if (record) listenInMedia?.(record.id);
  }

  // ── Rendering ──
  function hue(section) { return `--c1:var(--news-${sectionOf({ section })}1);--c2:var(--news-${sectionOf({ section })}2)`; }

  function sideTab(kind, key, inner, count) {
    const active = view.kind === kind && (key == null || view.key === key);
    return `<button class="article-sidebar-tab${active ? " is-active" : ""}" type="button" data-news-view="${kind}"${key ? ` data-news-key="${esc(key)}"` : ""} aria-current="${active}">
      ${inner}${count ? `<span class="news-side-count">${count}</span>` : ""}</button>`;
  }

  function renderSidebar() {
    const el = $("newsSidebar");
    if (!el) return;
    const list = articles || [];
    const counts = unreadCounts(list);
    const briefings = briefingsFrom(getState()?.savedArticles);
    const present = new Set(list.map(sectionOf));
    let h = sideTab("front", null, `${ICONS.front}<span>Front page</span>`, counts.all);
    h += sideTab("briefings", null, `${ICONS.briefings}<span>Briefings</span>`, briefings.length);
    h += sideTab("sent", null, `${ICONS.sent}<span>Sent to Media</span>`, counts.sent);
    h += `<div class="article-sidebar-divider"></div><div class="article-sidebar-section-label">Sections</div>`;
    for (const s of NEWS_SECTIONS) {
      if (!present.has(s.key) && !(view.kind === "section" && view.key === s.key)) continue;
      h += sideTab("section", s.key, `<i class="news-side-dot article-sidebar-icon" style="${hue(s.key)}" aria-hidden="true"></i><span>${esc(s.label)}</span>`, counts.section[s.key]);
    }
    if (!present.size) h += `<div class="news-side-empty">Sections appear as articles arrive.</div>`;
    h += `<div class="article-sidebar-divider"></div><div class="article-sidebar-section-label">Papers</div>`;
    for (const p of NEWS_PAPERS) {
      const st = paperStatus(signIns, p.key);
      const note = st === "expired" ? "Sign in again" : st === "none" ? "Not signed in" : "";
      h += sideTab("paper", p.key, `<i class="news-side-mark article-sidebar-icon" aria-hidden="true">${p.mark}</i><span class="news-side-paper"><span>${esc(p.label)}</span>${note ? `<small class="news-side-warn">${note}</small>` : ""}</span>`, counts.paper[p.key]);
    }
    el.innerHTML = h;
  }

  function menuHtml(a) {
    return `<div class="news-menu" role="menu">
      <button type="button" role="menuitem" class="news-menu-primary" data-news-act="send">${ICONS.media}${a.sentAt ? "In Media ✓" : "Send to Media"}</button>
      <button type="button" role="menuitem" data-news-act="open">${ICONS.open}Open</button>
      <button type="button" role="menuitem" data-news-act="listen">${ICONS.listen}Listen</button>
      <button type="button" role="menuitem" data-news-act="share">${ICONS.share}Share</button>
      <div class="news-menu-divider"></div>
      <button type="button" role="menuitem" data-news-act="hide">${ICONS.hide}Hide</button>
    </div>`;
  }
  const dotsBtn = (a) => `<button class="news-dots" type="button" aria-label="Article actions" aria-haspopup="menu" aria-expanded="${openMenuId === a.id}" data-news-dots>⋯</button>${openMenuId === a.id ? menuHtml(a) : ""}`;

  function metaLine(a) {
    const paper = PAPER[a.paper]?.label || a.source || "";
    return [paper, timeAgo(a.publishedAt || a.discoveredAt), a.sentAt ? "In Media ✓" : ""].filter(Boolean).map(esc).join(" · ");
  }

  function leadHtml(a, kicker) {
    return `<article class="news-lead${a.readAt ? " is-read" : ""}" data-news-id="${esc(a.id)}" style="${hue(a.section)}">
      <div class="news-lead-text">
        <div class="news-kicker">${esc(kicker)}</div>
        <h3 class="news-lead-title">${esc(a.title)}</h3>
        ${a.subtitle ? `<p class="news-lead-sub">${esc(a.subtitle)}</p>` : ""}
        <div class="news-lead-meta">${metaLine(a)}</div>
      </div>
      ${a.image ? `<img class="news-lead-img" src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      ${dotsBtn(a)}
    </article>`;
  }

  function cardHtml(a) {
    return `<article class="news-card${a.readAt ? " is-read" : ""}" data-news-id="${esc(a.id)}" style="${hue(a.section)}">
      <div class="news-card-band" aria-hidden="true"></div>
      <div class="news-card-body">
        <div class="news-card-text">
          <div class="news-card-sec">${esc(SECTION_LABEL[sectionOf(a)])}</div>
          <h4 class="news-card-title">${esc(a.title)}</h4>
          <div class="news-card-meta">${metaLine(a)}</div>
        </div>
        ${a.image ? `<img class="news-card-img" src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ""}
      </div>
      ${dotsBtn(a)}
    </article>`;
  }

  function briefingsHtml(list, compact) {
    if (!list.length) return compact ? "" : `<p class="news-empty">No briefings in the last ${KEEP_DAYS} days. The Morning and The world in brief show up here once they're converted.</p>`;
    return `<div class="news-briefs">${list.map((b) => `
      <button class="news-brief" type="button" data-news-brief="${esc(b.id)}">
        <span class="news-brief-title">${esc(b.title || "Briefing")}</span>
        <span class="news-brief-meta">${esc([b.author, timeAgo(b.savedAt)].filter(Boolean).join(" · "))}</span>
      </button>`).join("")}</div>`;
  }

  function signInBanner() {
    const statuses = NEWS_PAPERS.map((p) => paperStatus(signIns, p.key));
    if (statuses.some((s) => s === "signed-in" || s === "unverified" || s === "unknown")) {
      const expired = NEWS_PAPERS.filter((p) => paperStatus(signIns, p.key) === "expired" && p.key !== "athletic").map((p) => p.label);
      if (!expired.length) return "";
      return `<div class="news-banner">${esc(expired.join(", "))}: sign-in expired, so new articles from ${expired.length > 1 ? "them" : "it"} are paused. <button class="news-banner-btn" type="button" data-news-signin>Update sign-in</button></div>`;
    }
    return `<div class="news-banner">News collects articles only from papers you're signed in to. Add your subscriber sign-ins in Sync Settings. <button class="news-banner-btn" type="button" data-news-signin>Open Sync Settings</button></div>`;
  }

  function renderContent() {
    const el = $("newsContent");
    if (!el) return;
    if (!articles) {
      el.innerHTML = `<div class="news-scroll"><p class="news-empty">${esc(loadError || "Loading News…")}</p></div>`;
      return;
    }
    const nowMs = Date.now();
    const briefings = briefingsFrom(getState()?.savedArticles, nowMs);
    let title = "Front page";
    if (view.kind === "section") title = SECTION_LABEL[view.key] || "Section";
    else if (view.kind === "paper") title = PAPER[view.key]?.label || "Paper";
    else if (view.kind === "sent") title = "Sent to Media";
    else if (view.kind === "briefings") title = "Briefings";

    let body = "";
    if (view.kind === "briefings") {
      body = briefingsHtml(briefings, false);
    } else {
      const list = articlesForView(articles, view, query);
      const unread = list.filter((a) => !a.readAt).length;
      body += `<div class="news-head-sub">${list.length} ${list.length === 1 ? "story" : "stories"} · ${unread} unread${query ? ` · matching “${esc(query)}”` : ""}</div>`;
      if (view.kind === "front" && !query) body += briefingsHtml(briefings.slice(0, 4), true);
      if (view.kind === "section" && view.key === "sports") {
        body += `<div class="news-scores-slot">Scores, schedules and standings will go here.</div>`;
      }
      if (!list.length) {
        body += `<p class="news-empty">${query ? "No stories match your search." : view.kind === "sent" ? "Nothing sent yet. Use ⋯ → Send to Media on any story." : `No stories here in the last ${KEEP_DAYS} days.`}</p>`;
      } else {
        const { lead, rest } = arrangeFront(list, nowMs);
        const kicker = view.kind === "front"
          ? (lead.lead && nowMs - ms(lead.lead) <= LEAD_WINDOW_MS ? `Lead story · ${SECTION_LABEL[sectionOf(lead)]}` : `Latest · ${SECTION_LABEL[sectionOf(lead)]}`)
          : `Top in ${title}`;
        body += leadHtml(lead, kicker);
        if (rest.length) body += `<div class="news-grid">${rest.map(cardHtml).join("")}</div>`;
      }
    }
    el.innerHTML = `<div class="news-scroll">
      ${view.kind === "front" ? signInBanner() : ""}
      <div class="news-head"><h2 class="news-title">${esc(title)}</h2></div>
      ${body}
    </div>`;
  }

  function render() {
    if (!$("newsMainPage")) return;
    renderSidebar();
    renderContent();
  }

  function setView(next) {
    view = next;
    openMenuId = null;
    if (isNarrow()) $("newsSidebar")?.classList.remove("is-expanded");
    render();
    $("newsContent")?.querySelector(".news-scroll")?.scrollTo?.({ top: 0 });
  }

  function wire() {
    if (wired) return;
    const page = $("newsMainPage");
    if (!page) return;
    wired = true;
    $("newsSidebarToggle")?.addEventListener("click", () => {
      const sb = $("newsSidebar");
      if (!sb) return;
      if (isNarrow()) sb.classList.toggle("is-expanded");
      else sb.classList.toggle("is-collapsed");
    });
    $("newsRefreshBtn")?.addEventListener("click", () => { flush(); load(true); });
    $("newsSearchInput")?.addEventListener("input", (e) => { query = e.target.value; renderContent(); });
    $("newsSidebar")?.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-news-view]");
      if (tab) setView({ kind: tab.dataset.newsView, key: tab.dataset.newsKey });
    });
    $("newsContent")?.addEventListener("click", (e) => {
      if (e.target.closest("[data-news-signin]")) { openSignInSettings?.(); return; }
      const brief = e.target.closest("[data-news-brief]");
      if (brief) { openInMedia?.(brief.dataset.newsBrief); return; }
      const item = e.target.closest("[data-news-id]");
      if (!item) return;
      const id = item.dataset.newsId;
      if (e.target.closest("[data-news-dots]")) {
        openMenuId = openMenuId === id ? null : id;
        renderContent();
        return;
      }
      const act = e.target.closest("[data-news-act]")?.dataset.newsAct;
      if (act) {
        openMenuId = null;
        if (act === "send") sendToMedia(id);
        else if (act === "open") open(id);
        else if (act === "listen") listen(id);
        else if (act === "share") share(id);
        else if (act === "hide") hide(id);
        updateDot();
        if (isActive()) render();
        return;
      }
      if (e.target.closest(".news-menu")) return;
      // Tapping a story opens it.
      open(id);
    });
    document.addEventListener("click", (e) => {
      if (!openMenuId || e.target.closest(".news-menu, [data-news-dots]")) return;
      openMenuId = null;
      if (isActive()) renderContent();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && openMenuId) { openMenuId = null; renderContent(); }
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
  }

  // Page entry (showNewsApp).
  function enter() {
    wire();
    render();
    load();
  }

  // Local-dev only (window.__liveQA.newsSetFeed): fill the feed without a server.
  function seed(list, status) {
    articles = Array.isArray(list) ? list : [];
    signIns = status || {};
    lastLoadedAt = Date.now() + 3_600_000; // keep load() from replacing the seed
    updateDot();
    render();
    return articles.length;
  }

  return { enter, leave: flush, load, verifySignIns, render, seed };
}
