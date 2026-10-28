// news-ui.js — the News page (NEWS_PAGE_DESIGN.md). Articles linked in the
// newspapers' emails (collected server-side by the mail sweep, _news-links.js),
// sorted into newspaper sections, in the same shell as Mail and Media: a top bar,
// a sidebar directory (Front page · Saved · sections · papers) and
// the stories. Each story's ⋯ menu: Save, Open, Listen, Share, Hide. Only Save
// adds a story to Saved; Open / Listen read it without saving. Saved is the
// one list of saved articles (stories saved here, newsletters, extension, URL,
// scans, PDFs) — app.js owns it (MEDIA_SPLIT_DESIGN.md).
//
// Data: gmail.js `newsFeed` over the news_articles table (NEWS_PAGE_DESIGN.md §10)
// — one page of one view at a time (Front page, a section, a paper, Sent), plus
// sidebar counts. A view is re-read when shown if over a minute old, on Refresh,
// or on "Load more". No polling. Read / send / hide are batched into one
// `updateNews` call. Newsletter briefings (savedArticles "news-*") are not shown
// in News at all — they live only in Listen (Luke, 2026-10-16).
//
// Sports has two tabs: Scores (scores-ui.js, mounted here through the injected
// `scores` interface) and Stories (the section's articles, as everywhere else).
//
// For you (NEWS_RANKING_DESIGN.md): a view ranked by the person's interests,
// shown once the server says it can (`forYou` in the newsFeed reply). The ⋯ menu
// then also offers More like this / Less like this / Mute topic, and Listen is
// reported as its own (stronger) signal. The person's Scores favourites are sent
// to the server when they differ from what it has (`teamsSig`), so the hourly
// job can follow those teams on The Athletic. "What News has learned" (a view
// reached from For you) lists the strongest likes, dislikes and mutes, each
// removable, with a Reset. Stories that sit on screen in For you and aren't opened
// are reported as skipped when you leave it, once per story per app session.

import { paperHandoff } from './out-catalog.js';

const REFRESH_MS = 60_000;
const FLUSH_MS = 1500;
const DAY_MS = 86_400_000;
const KEEP_DAYS = 3;          // matches the server's FRESH_DAYS
const LEAD_WINDOW_MS = 36 * 3_600_000;
const SIGNIN_RECHECK_MS = DAY_MS;
const DEVICE_AUTO_CHECK_MS = 6 * 3_600_000;
const SPORTS_TAB_KEY = "live-news-sports-tab-v1"; // per device: "scores" | "stories"

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
  // Front page: no Athletic stories (Luke, 2026-10-15; the server leaves them out
  // too). They still show in Sports and under Papers.
  // For you: the server's order is the point; only search narrows it.
  if (view?.kind === "foryou") {
    const q = String(query || "").trim().toLowerCase();
    return q ? list.filter((a) => `${a.title} ${a.subtitle || ""} ${a.source || ""}`.toLowerCase().includes(q)) : list;
  }
  if (!view?.kind || view.kind === "front") list = list.filter((a) => a.paper !== "athletic");
  if (view?.kind === "section") list = list.filter((a) => sectionOf(a) === view.key);
  else if (view?.kind === "paper") list = list.filter((a) => a.paper === view.key);
  else if (view?.kind === "sent") list = list.filter((a) => a.sentAt);
  const q = String(query || "").trim().toLowerCase();
  if (q) list = list.filter((a) => `${a.title} ${a.subtitle || ""} ${a.source || ""}`.toLowerCase().includes(q));
  return list.sort((a, b) => cardTime(b) - cardTime(a));
}

// Pull-to-refresh (Luke, 2026-10-15): pulling down past the top of News refreshes
// it. Touch: drag down from the top past PULL_TRIGGER_PX and let go. Trackpad /
// wheel: keep scrolling up at the top until WHEEL_TRIGGER of upward scroll builds
// up within WHEEL_WINDOW_MS. A small label at the top shows the state. Listeners
// are passive, so normal scrolling is never held up.
export const PULL_TRIGGER_PX = 80;
const WHEEL_TRIGGER = 260;
const WHEEL_WINDOW_MS = 700;
const PULL_COOLDOWN_MS = 2500;

function scrollerAtTop(target, root) {
  for (let el = target; el && el !== root.parentElement; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return el.scrollTop <= 0;
    }
    if (el === root) break;
  }
  return true;
}

export function wirePullToRefresh(root, onRefresh, { now = () => Date.now() } = {}) {
  if (!root || root.dataset.pullWired) return;
  root.dataset.pullWired = "1";
  const hint = document.createElement("div");
  hint.className = "news-pull-hint";
  hint.setAttribute("aria-hidden", "true");
  // Lives beside the content (whose HTML is rebuilt on every render), over its top.
  (root.parentElement || root).appendChild(hint);
  let startY = null, pulled = 0, lastFire = 0, wheelSum = 0, wheelAt = 0;
  const show = (dist) => {
    pulled = dist;
    hint.textContent = dist >= PULL_TRIGGER_PX ? "Release to refresh" : "Pull to refresh";
    hint.style.setProperty("--pull", `${Math.min(dist, PULL_TRIGGER_PX * 1.4)}px`);
    hint.classList.toggle("is-visible", dist > 12);
    hint.classList.toggle("is-ready", dist >= PULL_TRIGGER_PX);
  };
  const fire = () => {
    if (now() - lastFire < PULL_COOLDOWN_MS) return;
    lastFire = now();
    hint.textContent = "Refreshing…";
    hint.classList.add("is-visible", "is-refreshing");
    setTimeout(() => hint.classList.remove("is-visible", "is-ready", "is-refreshing"), 900);
    onRefresh();
  };
  root.addEventListener("touchstart", (e) => {
    startY = e.touches.length === 1 && scrollerAtTop(e.target, root) ? e.touches[0].clientY : null;
    pulled = 0;
  }, { passive: true });
  root.addEventListener("touchmove", (e) => {
    if (startY === null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || !scrollerAtTop(e.target, root)) { startY = null; show(0); return; }
    show(dy * 0.6);
  }, { passive: true });
  const end = () => {
    if (startY !== null && pulled >= PULL_TRIGGER_PX) fire();
    else hint.classList.remove("is-visible", "is-ready");
    startY = null; pulled = 0;
  };
  root.addEventListener("touchend", end, { passive: true });
  root.addEventListener("touchcancel", end, { passive: true });
  root.addEventListener("wheel", (e) => {
    if (e.deltaY >= 0 || !scrollerAtTop(e.target, root)) { wheelSum = 0; return; }
    const t = now();
    if (t - wheelAt > WHEEL_WINDOW_MS) wheelSum = 0;
    wheelAt = t;
    wheelSum += -e.deltaY;
    if (wheelSum >= WHEEL_TRIGGER) { wheelSum = 0; fire(); }
  }, { passive: true });
}

// The lead story plus the rest, in display order (Q3): newsletter leads from the
// last ~36 h first (most recent lead on top), then everything else newest first.
export function arrangeFront(list, nowMs = Date.now()) {
  const leads = recentLeads(list, nowMs);
  const rest = list.filter((a) => !leads.includes(a));
  const ordered = [...leads, ...rest];
  return { lead: ordered[0] || null, rest: ordered.slice(1) };
}

// The newsletter leads from the last ~36 h, most recent lead first — the Front
// page's lead stories, and what the dock's ticker shows (news-ticker.js).
export function recentLeads(list, nowMs = Date.now()) {
  return (list || [])
    .filter((a) => a && a.id && a.lead && nowMs - ms(a.lead) <= LEAD_WINDOW_MS)
    .sort((a, b) => ms(b.lead) - ms(a.lead));
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

// A newsletter briefing (The Morning, The world in brief…): a saved article the
// mail sweep converted from a paper's newsletter, id "news-<gmail id>". Briefings
// live only in Listen (Luke, 2026-10-16), so News's Saved list leaves them out.
export function isNewsletterBriefing(a) {
  return !!a && String(a.id || "").startsWith("news-");
}

// Does the sign-in status need a fresh check (any paper never checked, or over 24 h)?
export function signInsNeedCheck(signIns, nowMs = Date.now()) {
  return ["nyt", "economist", "startribune"].some((p) => {
    const at = ms(signIns?.[p]?.checkedAt);
    return !at || nowMs - at > SIGNIN_RECHECK_MS;
  });
}

// Which sign-in banner the Front page shows: "" (none), "expired" (a paper's
// sign-in lapsed) or "prompt" (no paper is signed in — say where to sign in).
// Before the first status arrives (`loaded` false) and while a check is running
// nothing is shown. A paper that has never been checked counts as not signed in:
// a device with no sign-in saved never runs a check, so "unknown" stays forever.
export function signInBannerKind(signIns, { loaded = false, verifying = false } = {}) {
  if (!loaded) return "";
  const statuses = ["nyt", "economist", "startribune"].map((p) => signIns?.[p]?.status || "unknown");
  if (statuses.some((s) => s === "signed-in" || s === "unverified")) return statuses.includes("expired") ? "expired" : "";
  if (statuses.includes("expired")) return "expired";
  return verifying ? "" : "prompt";
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
    else if (d.decision === "read" || d.decision === "listen") read.set(d.id, true);
    else if (d.decision === "unread") read.set(d.id, false);
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

// Favourite teams → the signature the server keeps (same as _news-rank.js
// teamsSignature), so the app sends its favourites only when they changed.
export function teamsSignature(teams) {
  return (Array.isArray(teams) ? teams : []).map((t) => String(t?.key || "")).filter(Boolean).sort().join("|");
}
// What a favourite looks like on the wire (_news-rank.js cleanTeams).
export function teamsForServer(teams) {
  return (Array.isArray(teams) ? teams : []).filter((t) => t?.key).slice(0, 20)
    .map((t) => ({ key: t.key, scope: t.scope || "", name: t.name || "", short: t.short || "", league: t.league || "" }));
}
// For you stories seen on screen but not opened → the skip decisions to send
// (at most `max`, never one already reported this session).
export function skipsToSend(seenIds, cards, reported, max = 30) {
  const byId = new Map((cards || []).map((a) => [a.id, a]));
  const out = [];
  for (const id of seenIds || []) {
    const a = byId.get(id);
    if (!a || a.readAt || a.sentAt || reported.has(id)) continue;
    out.push(id);
    if (out.length >= max) break;
  }
  return out;
}

// The server's `learned` reply → one toast line.
export function learnedToast(learned) {
  const l = (learned || []).filter((x) => x && x.label).pop();
  if (!l) return "";
  if (l.decision === "more") return `You'll see more about ${l.label}.`;
  if (l.decision === "less") return `You'll see less about ${l.label}.`;
  if (l.decision === "mute") return `${l.label} muted in For you.`;
  return "";
}

// Append a further page to a view's list, de-duplicated by id (the server's
// cursor is inclusive, so the boundary story can come back). Order kept.
export function mergeArticles(existing, incoming) {
  const seen = new Set((existing || []).map((a) => a.id));
  return [...(existing || []), ...(incoming || []).filter((a) => a && !seen.has(a.id) && seen.add(a.id))];
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
  sent: '<svg viewBox="0 0 24 24" class="article-sidebar-icon" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  saved: '<svg viewBox="0 0 24 24" class="article-sidebar-icon" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  app: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
  listen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3z"/><path d="M3 19a2 2 0 0 0 2 2h1v-6H3z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>',
  hide: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 14h10l1-14"/></svg>',
  media: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  foryou: '<svg viewBox="0 0 24 24" class="article-sidebar-icon" aria-hidden="true"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 18.4 21H7V10l4.4-7.1A1.9 1.9 0 0 1 15 5.9z"/></svg>',
  less: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 14V3"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-2-2.3l1.4-7A2 2 0 0 1 5.6 3H17v11l-4.4 7.1A1.9 1.9 0 0 1 9 18.1z"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></svg>'
};

export function createNewsModule(deps) {
  const {
    callGmailApi, escapeHtml: esc, showToast, isSignedIn, getState, onSentToMedia,
    // Open / Listen without saving (Luke, 2026-10-21): hands the reader a copy of
    // the story for this session only. Only ⋯ → Save puts a story in Saved.
    onOpenUnsaved,
    openInMedia, listenInMedia, openSignInSettings, getActiveAppArea, setDotCount,
    // iPhone app only (app.js): returns { check(): Promise<{ nyt?, economist?,
    // startribune? }>, needsCheck(signIns): boolean } — the phone's own in-app
    // newspaper sign-ins (news-device-signin.js) — or null in a browser.
    getDeviceSignIn,
    // Hand a story to its paper's own app (APP_LINKS_DESIGN.md): app.js handOff(),
    // which opens the app on the iPhone and the website elsewhere. Optional.
    handOff,
    // The Scores view (scores-ui.js, SPORTS_SCORES_DESIGN.md), shown as a tab of the
    // Sports section: { mount(el), unmount(), refresh() }. Optional.
    scores,
    // Saved articles (app.js — the former Media → Publications list, with its
    // reader; MEDIA_SPLIT_DESIGN.md): { mount(el), unmount(), refresh(),
    // search(q), count() }; mount(el, { query }) applies the News search box. Optional.
    saved
  } = deps;
  const deviceSignIn = () => getDeviceSignIn?.() || null;

  const pages = new Map(); // viewKey → { articles, nextBefore, loadedAt }
  let counts = null;       // server sidebar counts (unreadCounts shape + sections)
  let signIns = {};
  let signInsLoaded = false;   // the server's status has arrived at least once
  let lastDeviceCheckAt = 0;   // bounds the phone's automatic re-check (per app run)
  let lastDeviceStatus = null; // what the phone itself last found, per paper
  let pendingTrail = null;     // the sign-in sheet's steps, sent with the next check
  let loadingKey = null;
  let loadError = "";
  let seeded = null;       // local-dev seed (window.__liveQA.newsSetFeed)
  const seededLog = [];    // decisions a seeded page would have sent (QA)
  let searchTimer = null;
  let view = { kind: "front" };
  let query = "";
  let openMenuId = null;
  let wired = false;
  let verifying = false;
  let forYouAvailable = false;  // the server has the For you migration (newsFeed `forYou`)
  let teamsSentSig = null;      // favourites signature sent this session
  let learned = null;           // "What News has learned": { likes, dislikes, muted, teams }
  let learnedState = "";        // "" | "loading" | "error"
  let resetArmedUntil = 0;      // Reset asks for a second tap within a few seconds
  const forYouSeen = new Set();     // For you stories that sat on screen this visit
  const skipsReported = new Set();  // skips already sent this app session
  let seenObserver = null;
  const seenTimers = new Map();
  // Sports opens on Scores; the choice between Scores and Stories is remembered.
  let sportsTab = "scores";
  try { if (localStorage.getItem(SPORTS_TAB_KEY) === "stories") sportsTab = "stories"; } catch { /* private mode */ }
  const onScores = () => !!scores && view.kind === "section" && view.key === "sports" && sportsTab === "scores";
  const onSaved = () => !!saved && view.kind === "saved";

  const $ = (id) => document.getElementById(id);
  const isNarrow = () => window.innerWidth <= 680;
  const isActive = () => getActiveAppArea?.() === "news";
  const viewKey = (v = view, q = query) => `${v.kind}:${v.key || ""}:${String(q || "").trim().toLowerCase()}`;
  const currentPage = () => pages.get(viewKey()) || null;
  const allCards = function* () { for (const p of pages.values()) yield* p.articles; };

  // ── Decision queue (batched like the old bell deck) ──
  let queue = [];
  let inflight = []; // sent to the server, not yet answered — re-applied to any load meanwhile
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
    inflight = [...inflight, ...decisions];
    if (seeded) { inflight = []; seededLog.push(...decisions); return; } // local dev: nothing to send
    callGmailApi({ action: "updateNews", decisions }).then((d) => {
      inflight = inflight.filter((x) => !decisions.includes(x));
      if (d?.ok) {
        if (d.counts) counts = d.counts;
        const msg = learnedToast(d.learned);
        if (msg) showToast?.(msg);
        updateDot();
        if (isActive()) renderSidebar();
        return;
      }
      // Server unreachable: put the decisions back for the next flush.
      queue = [...decisions, ...queue];
      showToast?.("Couldn't reach the server. News will retry your changes.");
    });
  }

  function updateDot() { setDotCount?.(counts ? counts.all : 0); }

  const countsFor = (list) => ({ ...unreadCounts(list), sections: [...new Set(list.map(sectionOf))] });

  // Load (or refresh) the current view's first page, or with `more` its next page.
  async function load(force = false, { more = false } = {}) {
    if (view.kind === "saved") { render(); return; }
    if (view.kind === "learned") { loadLearned(force); return; }
    const key = viewKey();
    const page = pages.get(key);
    if (seeded) {
      pages.set(key, { articles: articlesForView(seeded, view, query), nextBefore: null, loadedAt: Date.now() });
      render();
      return;
    }
    if (!isSignedIn?.()) { if (!page) loadError = "Sign in to see your news."; render(); return; }
    if (loadingKey === key) return;
    if (more && !page?.nextBefore) return;
    if (!force && !more && page && Date.now() - page.loadedAt < REFRESH_MS) { render(); return; }
    loadingKey = key;
    if (!page) render();
    const d = await callGmailApi({
      action: "newsFeed",
      view: { kind: view.kind, key: view.key },
      q: String(query || "").trim() || undefined,
      before: more ? page.nextBefore : undefined
    });
    loadingKey = null;
    if (!Array.isArray(d?.articles)) {
      loadError = page ? "" : "Couldn't load News. Try Refresh.";
      if (more) showToast?.("Couldn't load more stories.");
      if (isActive()) render();
      return;
    }
    loadError = "";
    const incoming = applyLocalDecisions(d.articles, [...inflight, ...queue]);
    pages.set(key, {
      articles: more ? mergeArticles(page.articles, incoming) : incoming,
      nextBefore: d.nextBefore || null,
      loadedAt: more ? page.loadedAt : Date.now()
    });
    if (d.counts) counts = d.counts;
    if (d.signIns) { signIns = d.signIns; signInsLoaded = true; }
    if (d.forYou === true && !forYouAvailable) forYouAvailable = true;
    if (typeof d.teamsSig === "string") syncTeams(d.teamsSig);
    updateDot();
    if (isActive()) { if (viewKey() === key) render(); else renderSidebar(); }
    // Auto-recheck only from a device that has sign-ins saved: one whose synced
    // settings haven't arrived yet would otherwise record every paper as "none".
    if (d.signIns && signInsNeedCheck(signIns) && hasSavedSignIn()) verifySignIns();
    // The iPhone app re-reports its own sign-ins when its last report is over a
    // day old — at most once per DEVICE_AUTO_CHECK_MS per app run, so a server
    // that doesn't record the report can't make every feed load start a check.
    else if (d.signIns && deviceSignIn()?.needsCheck?.(signIns) && Date.now() - lastDeviceCheckAt > DEVICE_AUTO_CHECK_MS) verifySignIns();
  }

  // ── What News has learned ──
  async function loadLearned(force = false) {
    if (seeded) { learned = learned || { likes: [], dislikes: [], muted: [], teams: [] }; render(); return; }
    if (learnedState === "loading" || (learned && !force)) { render(); return; }
    learnedState = "loading";
    render();
    const d = await callGmailApi({ action: "newsInterest" });
    learnedState = d?.ok ? "" : "error";
    if (d?.ok) learned = { likes: d.likes || [], dislikes: d.dislikes || [], muted: d.muted || [], teams: d.teams || [] };
    if (isActive() && view.kind === "learned") render();
  }
  async function editLearned(change) {
    // Optimistic: drop the row now; the server's reply is the new list.
    if (learned) {
      const drop = new Set([...(change.forget || []), ...(change.unmute || [])]);
      learned = change.reset ? { ...learned, likes: [], dislikes: [], muted: [] }
        : { ...learned, likes: learned.likes.filter((r) => !drop.has(r.feature)), dislikes: learned.dislikes.filter((r) => !drop.has(r.feature)), muted: learned.muted.filter((r) => !drop.has(r.feature)) };
    }
    for (const [k, p] of pages) if (k.startsWith("foryou:")) p.loadedAt = 0; // For you re-ranks on next visit
    render();
    if (seeded) return;
    const d = await callGmailApi({ action: "newsInterestEdit", ...change });
    if (d?.ok) {
      learned = { likes: d.likes || [], dislikes: d.dislikes || [], muted: d.muted || [], teams: d.teams || [] };
      if (change.reset) showToast?.("For you starts fresh.");
    } else showToast?.("Couldn't save that. Try again.");
    if (isActive() && view.kind === "learned") render();
  }

  // ── Skipped stories (For you) ──
  // A story counts as seen when at least 60% of it is on screen for 1.5 s.
  function observeForYou() {
    seenObserver?.disconnect();
    for (const t of seenTimers.values()) clearTimeout(t);
    seenTimers.clear();
    if (view.kind !== "foryou" || !forYouAvailable || typeof IntersectionObserver !== "function") return;
    const root = $("newsContent")?.querySelector(".news-scroll") || null;
    seenObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const id = e.target.dataset.newsId;
        if (e.isIntersecting && e.intersectionRatio >= 0.6) {
          if (!seenTimers.has(id)) seenTimers.set(id, setTimeout(() => forYouSeen.add(id), 1500));
        } else { clearTimeout(seenTimers.get(id)); seenTimers.delete(id); }
      }
    }, { root, threshold: [0, 0.6] });
    for (const el of $("newsContent")?.querySelectorAll("[data-news-id]") || []) seenObserver.observe(el);
  }
  function reportSkips() {
    if (!forYouSeen.size) return;
    const page = pages.get(viewKey({ kind: "foryou" }, ""));
    const ids = skipsToSend([...forYouSeen], page?.articles || [], skipsReported);
    forYouSeen.clear();
    if (!ids.length || !forYouAvailable) return;
    for (const id of ids) { skipsReported.add(id); enqueue(id, "skip"); }
  }

  // Send the Scores favourites when the server's copy differs (once per signature
  // per session, so a failed send can't turn every load into another request).
  function syncTeams(serverSig) {
    const teams = teamsForServer(getState?.()?.sportsPrefs?.teams);
    const sig = teamsSignature(teams);
    // Never send an empty list: before synced state arrives every device reads as
    // "no favourites", which would wipe the server's copy (ISSUES.md: removing every
    // favourite therefore doesn't reach the server).
    if (!teams.length || sig === serverSig || sig === teamsSentSig) return;
    teamsSentSig = sig;
    callGmailApi({ action: "newsTeams", teams });
  }

  function hasSavedSignIn() {
    const sync = getState()?.articleSync || {};
    return !!(sync.nytCookie || sync.economistCookie || sync.stribCookie);
  }

  // Re-check every paper's sign-in with the cookies saved in Settings → Sync and,
  // in the iPhone app, with what the phone finds for its own in-app sign-ins (a
  // status per paper; the phone's cookies are never sent). A call during a check
  // runs once more afterward, with the latest state (saving NYT then Economist in
  // quick succession must check both). Resolves to the latest status map.
  let verifyAgain = false;
  let verifyPromise = null;
  function verifySignIns() {
    if (!isSignedIn?.()) return Promise.resolve(signIns);
    if (verifying) { verifyAgain = true; return verifyPromise; }
    verifying = true;
    verifyPromise = (async () => {
      try {
        do {
          verifyAgain = false;
          const sync = getState()?.articleSync || {};
          let deviceStatus;
          const device = deviceSignIn();
          if (device?.check) {
            lastDeviceCheckAt = Date.now();
            try { deviceStatus = await device.check(); } catch { deviceStatus = undefined; }
            lastDeviceStatus = deviceStatus || null;
          }
          const deviceTrail = pendingTrail;
          pendingTrail = null;
          const d = await callGmailApi({
            action: "verifyNewsSignIns",
            cookies: { nytCookie: sync.nytCookie || "", economistCookie: sync.economistCookie || "", stribCookie: sync.stribCookie || "" },
            ...(deviceStatus && Object.keys(deviceStatus).length ? { deviceStatus } : {}),
            ...(deviceTrail ? { deviceTrail } : {})
          });
          if (d?.signIns) { signIns = d.signIns; signInsLoaded = true; }
        } while (verifyAgain);
      } finally {
        verifying = false;
        if (isActive()) render();
      }
      return signIns;
    })();
    return verifyPromise;
  }

  function cardFor(id) { for (const a of allCards()) if (a.id === id) return a; return null; }
  // The same story can be cached in several views (Front page and its section).
  function patch(id, fn) {
    for (const p of pages.values()) p.articles = p.articles.map((a) => (a.id === id ? fn({ ...a }) : a));
  }
  // Optimistic sidebar counts until the server's arrive with the flush reply.
  function bumpUnread(a, delta) {
    if (!counts || !a) return;
    counts.all = Math.max(0, counts.all + delta);
    const s = sectionOf(a);
    counts.section[s] = Math.max(0, (counts.section[s] || 0) + delta);
    counts.paper[a.paper] = Math.max(0, (counts.paper[a.paper] || 0) + delta);
  }

  // `how` is "listen" for Listen; an older server only knows "read".
  function markRead(id, how = "read") {
    const a = cardFor(id);
    if (!a) return;
    if (!a.readAt) {
      patch(id, (x) => ({ ...x, readAt: new Date().toISOString() }));
      bumpUnread(a, -1);
    } else if (how !== "listen") return;
    enqueue(id, how === "listen" && forYouAvailable ? "listen" : "read");
  }
  // More / Less like this, Mute topic (For you servers only). Less and Mute also
  // take the story out of For you here; the server's reply names what it learned.
  function feedback(id, decision) {
    if (!forYouAvailable || !cardFor(id)) return;
    enqueue(id, decision);
    if (decision !== "more") {
      for (const [k, p] of pages) if (k.startsWith("foryou:")) p.articles = p.articles.filter((x) => x.id !== id);
    }
    flush();
  }
  function sendToMedia(id, { quiet = false } = {}) {
    const a = cardFor(id);
    if (!a) return null;
    const record = sentArticleRecord(a);
    if (!a.sentAt) {
      patch(id, (x) => ({ ...x, sentAt: new Date().toISOString() }));
      if (counts) counts.sent += 1;
      for (const k of [...pages.keys()]) if (k.startsWith("sent:")) pages.delete(k); // re-read on next visit
      enqueue(id, "send");
      onSentToMedia?.(record);
      if (!quiet) showToast?.("Saved.");
    } else {
      // Sent from another device (or since removed from Media): make sure this
      // device has the copy Open / Listen hand to the reader. Skips duplicates by id.
      onSentToMedia?.(record);
      if (!quiet) showToast?.("Already saved.");
    }
    return record;
  }
  function hide(id) {
    const a = cardFor(id);
    if (!a) return;
    if (!a.readAt) bumpUnread(a, -1);
    for (const p of pages.values()) p.articles = p.articles.filter((x) => x.id !== id);
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
  // Opening or listening to a story does NOT save it (Luke, 2026-10-21): the
  // reader gets a session-only copy and the story is only marked read. Saved holds
  // just what ⋯ → Save put there.
  function readerRecord(id) {
    const a = cardFor(id);
    if (!a) return null;
    const record = sentArticleRecord(a);
    onOpenUnsaved?.(record);
    return record;
  }
  function open(id) {
    const record = readerRecord(id);
    markRead(id);
    flush();
    if (record) openInMedia?.(record.id);
  }
  // ⋯ → Open in the paper's app: the story's own link, which the paper's app
  // claims; the website if the app isn't installed. Counts as reading it.
  function openInPaperApp(id) {
    const a = cardFor(id);
    const spec = a ? paperHandoff(a.paper, a.url) : null;
    if (!spec || typeof handOff !== "function") return;
    markRead(id);
    flush();
    handOff(spec);
  }
  function listen(id) {
    const record = readerRecord(id);
    markRead(id, "listen");
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
    const c = counts || { all: 0, sent: 0, section: {}, paper: {}, sections: [] };
    const present = new Set(c.sections || []);
    let h = forYouAvailable ? sideTab("foryou", null, `${ICONS.foryou}<span>For you</span>`) : "";
    h += sideTab("front", null, `${ICONS.front}<span>Front page</span>`, c.all);
    // One Saved view (MEDIA_SPLIT_DESIGN.md): stories saved here land in the same
    // list as newsletters, scans and links, so there is no separate "Sent" view.
    if (saved) h += sideTab("saved", null, `${ICONS.saved}<span>Saved</span>`, saved.count?.() || 0);
    h += `<div class="article-sidebar-divider"></div><div class="article-sidebar-section-label">Sections</div>`;
    for (const s of NEWS_SECTIONS) {
      // Sports always shows when the Scores view is mounted: scores don't depend on
      // sports articles arriving, so hiding it until one does made Scores unreachable.
      const alwaysShown = s.key === "sports" && !!scores;
      if (!alwaysShown && !present.has(s.key) && !(view.kind === "section" && view.key === s.key)) continue;
      h += sideTab("section", s.key, `<i class="news-side-dot article-sidebar-icon" style="${hue(s.key)}" aria-hidden="true"></i><span>${esc(s.label)}</span>`, c.section[s.key]);
    }
    if (!present.size) h += `<div class="news-side-empty">Sections appear as articles arrive.</div>`;
    h += `<div class="article-sidebar-divider"></div><div class="article-sidebar-section-label">Papers</div>`;
    for (const p of NEWS_PAPERS) {
      const st = paperStatus(signIns, p.key);
      const note = st === "expired" ? "Sign in again" : (st === "none" || (st === "unknown" && signInsLoaded && !verifying)) ? "Not signed in" : "";
      h += sideTab("paper", p.key, `<i class="news-side-mark article-sidebar-icon" aria-hidden="true">${p.mark}</i><span class="news-side-paper"><span>${esc(p.label)}</span>${note ? `<small class="news-side-warn">${note}</small>` : ""}</span>`, c.paper[p.key]);
    }
    el.innerHTML = h;
  }

  function menuHtml(a) {
    return `<div class="news-menu" role="menu">
      <button type="button" role="menuitem" class="news-menu-primary" data-news-act="send">${ICONS.saved.replace(' class="article-sidebar-icon"', "")}${a.sentAt ? "Saved ✓" : "Save"}</button>
      <button type="button" role="menuitem" data-news-act="open">${ICONS.open}Open</button>
      ${handOff && paperHandoff(a.paper, a.url) ? `<button type="button" role="menuitem" data-news-act="app">${ICONS.app}Open in ${esc(paperHandoff(a.paper, a.url).label)} app</button>` : ""}
      <button type="button" role="menuitem" data-news-act="listen">${ICONS.listen}Listen</button>
      <button type="button" role="menuitem" data-news-act="share">${ICONS.share}Share</button>
      ${forYouAvailable ? `<div class="news-menu-divider"></div>
      <button type="button" role="menuitem" data-news-act="more">${ICONS.more}More like this</button>
      <button type="button" role="menuitem" data-news-act="less">${ICONS.less}Less like this</button>
      <button type="button" role="menuitem" data-news-act="mute">${ICONS.mute}Mute topic</button>` : ""}
      <div class="news-menu-divider"></div>
      <button type="button" role="menuitem" data-news-act="hide">${ICONS.hide}Hide</button>
    </div>`;
  }
  const dotsBtn = (a) => `<button class="news-dots" type="button" aria-label="Article actions" aria-haspopup="menu" aria-expanded="${openMenuId === a.id}" data-news-dots>⋯</button>${openMenuId === a.id ? menuHtml(a) : ""}`;

  function metaLine(a) {
    const paper = PAPER[a.paper]?.label || a.source || "";
    const why = view.kind === "foryou" && a.why ? a.why : "";
    return [why, paper, timeAgo(a.publishedAt || a.discoveredAt), a.sentAt ? "In Media ✓" : ""].filter(Boolean).map(esc).join(" · ");
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

  // "What News has learned": likes, dislikes and mutes, each removable; Reset.
  function learnedHtml() {
    const KIND = { t: "Topic", team: "Team", e: "Name", k: "Word" };
    const chip = (r, attr) => `<li class="news-learned-chip"><span><span class="news-learned-label">${esc(r.label)}</span><small>${esc(KIND[r.kind] || "")}</small></span>
      <button type="button" class="news-learned-x" ${attr}="${esc(r.feature)}" aria-label="Remove ${esc(r.label)}">×</button></li>`;
    const group = (title, note, rows, attr) => `<section class="news-learned-group"><h3>${esc(title)}</h3><p class="news-learned-note">${esc(note)}</p>
      ${rows.length ? `<ul class="news-learned-list">${rows.map((r) => chip(r, attr)).join("")}</ul>` : `<p class="news-empty">Nothing yet.</p>`}</section>`;
    let body;
    if (!learned && learnedState === "loading") body = `<p class="news-empty">Loading…</p>`;
    else if (!learned) body = `<p class="news-empty">${learnedState === "error" ? "Couldn't load this. Pull down to try again." : "Loading…"}</p>`;
    else {
      const armed = Date.now() < resetArmedUntil;
      body = `${learned.teams?.length ? `<p class="news-learned-note">Your teams, from Scores: ${esc(learned.teams.join(", "))}.</p>` : ""}
        ${group("More of", "From what you open, listen to, save and mark More like this.", learned.likes, "data-news-forget")}
        ${group("Less of", "From Less like this, Hide, and stories you scroll past.", learned.dislikes, "data-news-forget")}
        ${group("Muted", "Never shown in For you.", learned.muted, "data-news-unmute")}
        <button type="button" class="news-more news-learned-reset${armed ? " is-armed" : ""}" data-news-reset>${armed ? "Tap again to reset" : "Reset what News has learned"}</button>`;
    }
    return `<div class="news-scroll">
      <div class="news-head"><button type="button" class="news-back" data-news-back-foryou aria-label="Back to For you">‹</button><h2 class="news-title">What News has learned</h2></div>
      <div class="news-head-sub">Remove anything that's off. Your favorite teams come from Scores.</div>
      ${body}
    </div>`;
  }

  function signInBanner() {
    const kind = signInBannerKind(signIns, { loaded: signInsLoaded, verifying });
    if (kind === "expired") {
      const expired = NEWS_PAPERS.filter((p) => paperStatus(signIns, p.key) === "expired" && p.key !== "athletic").map((p) => p.label);
      return `<div class="news-banner">${esc(expired.join(", "))}: sign-in expired, so new articles from ${expired.length > 1 ? "them" : "it"} are paused. <button class="news-banner-btn" type="button" data-news-signin>Update sign-in</button></div>`;
    }
    if (kind !== "prompt") return "";
    // In the iPhone app the sign-ins are made in the app itself (Sync Settings →
    // the Sign in buttons); in a browser they are pasted subscriber cookies.
    const how = deviceSignIn() ? "Sign in to your papers in Sync Settings." : "Add your subscriber sign-ins in Sync Settings.";
    return `<div class="news-banner">News collects articles only from papers you're signed in to. ${how} <button class="news-banner-btn" type="button" data-news-signin>Open Sync Settings</button></div>`;
  }

  function sportsTabsHtml() {
    if (!scores) return "";
    const unread = counts?.section?.sports || 0;
    const tab = (key, label, extra = "") => `<button type="button" role="tab" class="news-tab${sportsTab === key ? " is-active" : ""}" data-news-sports-tab="${key}" aria-selected="${sportsTab === key}">${label}${extra}</button>`;
    return `<div class="news-tabs" role="tablist" aria-label="Sports">${tab("scores", "Scores")}${tab("stories", "Stories", unread ? `<span class="news-tab-count">${unread}</span>` : "")}</div>`;
  }

  function renderContent() {
    const el = $("newsContent");
    if (!el) return;
    // Sports → Scores is its own view: it doesn't wait on (or need) the stories.
    if (onScores()) {
      el.innerHTML = `<div class="news-scroll">
        <div class="news-head"><h2 class="news-title">Sports</h2></div>
        ${sportsTabsHtml()}
        <div class="news-scores" id="newsScoresMount"></div>
      </div>`;
      scores.mount($("newsScoresMount"));
      return;
    }
    scores?.unmount();
    // Saved articles: app.js owns the list (and keeps its scroll); News gives it a
    // place. Built once per visit to the view so re-renders don't reset it.
    if (onSaved()) {
      if (!$("newsSavedMount")) {
        el.innerHTML = `<div class="news-saved">
          <div class="news-head"><h2 class="news-title">Saved</h2></div>
          <div class="news-saved-mount" id="newsSavedMount"></div>
        </div>`;
      }
      saved.mount($("newsSavedMount"), { query: String(query || "").trim() });
      return;
    }
    saved?.unmount();
    if (view.kind === "learned") { el.innerHTML = learnedHtml(); return; }
    const page = currentPage();
    if (!page) {
      el.innerHTML = `<div class="news-scroll"><p class="news-empty">${esc(loadError || "Loading News…")}</p></div>`;
      return;
    }
    const nowMs = Date.now();
    let title = "Front page";
    if (view.kind === "foryou") title = "For you";
    else if (view.kind === "section") title = SECTION_LABEL[view.key] || "Section";
    else if (view.kind === "paper") title = PAPER[view.key]?.label || "Paper";
    else if (view.kind === "sent") title = "Saved";

    let body = "";
    const list = articlesForView(page.articles, view); // search already applied by the server
    const c = counts || { all: 0, section: {}, paper: {} };
    const unread = view.kind === "section" ? c.section[view.key] || 0
      : view.kind === "paper" ? c.paper[view.key] || 0
      : view.kind === "front" ? c.all : list.filter((a) => !a.readAt).length;
    const forYouView = view.kind === "foryou";
    const shown = `${list.length}${page.nextBefore ? "+" : ""} ${list.length === 1 && !page.nextBefore ? "story" : "stories"}`;
    body += `<div class="news-head-sub">${query ? `${shown} matching “${esc(query)}”` : forYouView ? `Ranked by what you read. Use ⋯ to tune it. <button class="news-link-btn" type="button" data-news-learned>What News has learned</button>` : `${shown} · ${unread} unread`}</div>`;
    if (!list.length) {
      body += `<p class="news-empty">${query ? "No stories match your search." : view.kind === "sent" ? "Nothing saved yet. Use ⋯ → Save on any story." : forYouView ? "You're all caught up. New stories arrive every hour." : `No stories here in the last ${KEEP_DAYS} days.`}</p>`;
    } else {
      const { lead, rest } = forYouView ? { lead: list[0], rest: list.slice(1) } : arrangeFront(list, nowMs);
      const kicker = forYouView ? `Top for you · ${SECTION_LABEL[sectionOf(lead)]}`
        : view.kind === "front"
        ? (lead.lead && nowMs - ms(lead.lead) <= LEAD_WINDOW_MS ? `Lead story · ${SECTION_LABEL[sectionOf(lead)]}` : `Latest · ${SECTION_LABEL[sectionOf(lead)]}`)
        : `Top in ${title}`;
      body += leadHtml(lead, kicker);
      if (rest.length) body += `<div class="news-grid">${rest.map(cardHtml).join("")}</div>`;
      if (page.nextBefore) body += `<button class="news-more" type="button" data-news-more>${loadingKey === viewKey() ? "Loading…" : "Load more stories"}</button>`;
    }
    el.innerHTML = `<div class="news-scroll">
      ${view.kind === "front" ? signInBanner() : ""}
      <div class="news-head"><h2 class="news-title">${esc(title)}</h2></div>
      ${view.kind === "section" && view.key === "sports" ? sportsTabsHtml() : ""}
      ${body}
    </div>`;
    placeOpenMenu();
    observeForYou();
  }

  // An open ⋯ menu near the bottom of the list opens upward when that fits better.
  function placeOpenMenu() {
    const menu = $("newsContent")?.querySelector(".news-menu");
    const scroller = menu?.closest(".news-scroll");
    if (!menu || !scroller) return;
    const m = menu.getBoundingClientRect(), box = scroller.getBoundingClientRect();
    const below = box.bottom - m.top, above = m.top - 42 - box.top;
    if (m.bottom > box.bottom && above > below) menu.classList.add("is-up");
  }

  function render() {
    if (!$("newsMainPage")) return;
    renderSidebar();
    renderContent();
  }

  function setView(next) {
    if (view.kind === "foryou" && next?.kind !== "foryou") { reportSkips(); flush(); }
    // The old "Sent" view folded into Saved; the old Briefings view is gone
    // (briefings live in Listen), so a stale link to it opens the Front page.
    view = next?.kind === "sent" && saved ? { kind: "saved" }
      : next?.kind === "briefings" ? { kind: "front" } : next;
    openMenuId = null;
    if (isNarrow()) $("newsSidebar")?.classList.remove("is-expanded");
    render();
    $("newsContent")?.querySelector(".news-scroll")?.scrollTo?.({ top: 0 });
    load();
  }

  // Refresh everything News shows (was the refresh button by the search box).
  function refreshAll() {
    if (onScores()) scores.refresh();
    if (onSaved()) saved.refresh();
    flush();
    for (const p of pages.values()) p.loadedAt = 0; // every view re-reads when next shown
    load(true);
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
    wirePullToRefresh($("newsContent"), refreshAll);
    // Search runs on the server (titles across the whole window), debounced.
    // Saved articles search on the device instead (they're local).
    $("newsSearchInput")?.addEventListener("input", (e) => {
      query = e.target.value;
      clearTimeout(searchTimer);
      if (onSaved()) { saved.search(query); return; }
      searchTimer = setTimeout(() => load(), 300);
    });
    $("newsSidebar")?.addEventListener("click", (e) => {
      const tab = e.target.closest("[data-news-view]");
      if (tab) setView({ kind: tab.dataset.newsView, key: tab.dataset.newsKey });
    });
    $("newsContent")?.addEventListener("click", (e) => {
      const sportsTabBtn = e.target.closest("[data-news-sports-tab]");
      if (sportsTabBtn) {
        sportsTab = sportsTabBtn.dataset.newsSportsTab === "stories" ? "stories" : "scores";
        try { localStorage.setItem(SPORTS_TAB_KEY, sportsTab); } catch { /* private mode */ }
        renderContent();
        return;
      }
      if (e.target.closest("#newsScoresMount")) return; // the Scores view handles its own taps
      if (e.target.closest("[data-news-signin]")) { openSignInSettings?.(); return; }
      if (e.target.closest("[data-news-learned]")) { setView({ kind: "learned" }); return; }
      if (e.target.closest("[data-news-back-foryou]")) { setView({ kind: "foryou" }); return; }
      const forget = e.target.closest("[data-news-forget]");
      if (forget) { editLearned({ forget: [forget.dataset.newsForget] }); return; }
      const unmute = e.target.closest("[data-news-unmute]");
      if (unmute) { editLearned({ unmute: [unmute.dataset.newsUnmute] }); return; }
      if (e.target.closest("[data-news-reset]")) {
        if (Date.now() < resetArmedUntil) { resetArmedUntil = 0; editLearned({ reset: true }); }
        else { resetArmedUntil = Date.now() + 4000; renderContent(); setTimeout(() => { if (isActive() && view.kind === "learned") renderContent(); }, 4100); }
        return;
      }
      if (e.target.closest("[data-news-more]")) { load(false, { more: true }); renderContent(); return; }
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
        else if (act === "app") openInPaperApp(id);
        else if (act === "listen") listen(id);
        else if (act === "share") share(id);
        else if (act === "hide") hide(id);
        else if (act === "more" || act === "less" || act === "mute") feedback(id, act);
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
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) return;
      if (isActive() && view.kind === "foryou") reportSkips();
      flush();
    });
  }

  // Page entry (showNewsApp).
  function enter() {
    wire();
    render();
    load();
  }

  // Local-dev only (window.__liveQA.newsSetFeed): fill the feed without a server.
  function seed(list, status, opts = {}) {
    seeded = Array.isArray(list) ? list : [];
    forYouAvailable = !!opts?.forYou;
    learned = opts?.learned || null;
    signIns = status || {};
    signInsLoaded = true;
    counts = countsFor(seeded);
    pages.clear();
    updateDot();
    load();
    return seeded.length;
  }

  // Leaving the page: send queued decisions and stop the Scores view's refresh.
  function leave() {
    if (view.kind === "foryou") reportSkips();
    flush();
    scores?.unmount();
  }

  // The iPhone app's sign-in sheet steps for `paper` (diagnostics), sent with the
  // next verifySignIns call.
  function setDeviceTrail(paper, steps) {
    if (paper && Array.isArray(steps) && steps.length) pendingTrail = { paper, steps: steps.slice(0, 80).map(String) };
  }

  // Show one of the sidebar's views ("saved", "front", …) — app.js uses this
  // after a scan or Add-by-URL lands a new saved article.
  function showView(kind, key) {
    if (kind === "saved" && !saved) return;
    if (view.kind !== kind || view.key !== key) setView({ kind, key });
  }

  // Sports → Scores (the dock ticker opens a game there). Call after enter().
  function showScores() {
    if (!scores) return;
    if (sportsTab !== "scores") {
      sportsTab = "scores";
      try { localStorage.setItem(SPORTS_TAB_KEY, sportsTab); } catch { /* private mode */ }
    }
    if (view.kind !== "section" || view.key !== "sports") setView({ kind: "section", key: "sports" });
    else renderContent();
  }

  // ── The dock ticker's headlines (news-ticker.js) ──
  // The Front page's lead stories. Reuses the Front page when News has loaded it
  // recently; otherwise asks for the Front page with a one-row page (the server
  // adds the recent leads to a first Front page whatever the limit), so the
  // ticker costs a small request every `maxAgeMs` at most. Never polls by itself.
  let tickerList = null, tickerAt = 0, tickerLoading = null;
  const TICKER_PAGE = "ticker::"; // not a view: lets Open / patch / hide find these cards
  async function tickerLeads({ maxAgeMs = 15 * 60_000 } = {}) {
    if (seeded) return recentLeads(seeded);
    const front = pages.get(viewKey({ kind: "front" }, ""));
    if (front && Date.now() - front.loadedAt < maxAgeMs) return recentLeads(front.articles);
    if (tickerList && Date.now() - tickerAt < maxAgeMs) return recentLeads(pages.get(TICKER_PAGE)?.articles || tickerList);
    if (!isSignedIn?.()) return [];
    if (!tickerLoading) {
      tickerLoading = (async () => {
        const d = await callGmailApi({ action: "newsFeed", view: { kind: "front" }, limit: 1 });
        if (!Array.isArray(d?.articles)) return;
        tickerList = applyLocalDecisions(d.articles, [...inflight, ...queue]);
        tickerAt = Date.now();
        pages.set(TICKER_PAGE, { articles: tickerList, nextBefore: null, loadedAt: tickerAt });
        if (d.counts) { counts = d.counts; updateDot(); }
        if (d.signIns) { signIns = d.signIns; signInsLoaded = true; }
      })().catch(() => {}).finally(() => { tickerLoading = null; });
    }
    await tickerLoading;
    return recentLeads(pages.get(TICKER_PAGE)?.articles || tickerList || []);
  }
  // Open a ticker headline the way a tap on the Front page does.
  function openStory(id) {
    if (!cardFor(id)) return false;
    open(id);
    return true;
  }

  return {
    enter, leave, load, verifySignIns, render, seed, setDeviceTrail, showView, showScores, tickerLeads, openStory,
    qaDecisions: () => seededLog.slice(),
    deviceStatus: () => lastDeviceStatus,
    signInStatus: () => (signInsLoaded ? signIns : null)
  };
}
