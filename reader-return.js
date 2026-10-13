// Reader return-to-origin (MEDIA_SPLIT_DESIGN.md, decision 2).
//
// The article reader lives on one page (its "host"). Opening it from anywhere
// else — News, the listen queue, the now-playing bar, search — records where
// you were, and closing the reader takes you back there: same page, same tab,
// same scroll position. Pure apart from the two small DOM helpers at the end,
// which take the document/root they work on as an argument.

// A snapshot of where the reader was opened from.
//   area      the page (activeAppArea), e.g. "news", "media", "plan"
//   tab       the page's own sub-view when it has one (Media's tab), or null
//   scroll    [{ id, top }] for each scrolled element that has an id
//   windowY   the window's own scroll
export function makeReaderOrigin({ area, tab = null, scroll = [], windowY = 0 } = {}) {
  if (!area) return null;
  return {
    area: String(area),
    tab: tab == null ? null : String(tab),
    scroll: (Array.isArray(scroll) ? scroll : [])
      .filter((s) => s && s.id && Number.isFinite(s.top) && s.top > 0)
      .map((s) => ({ id: String(s.id), top: Math.round(s.top) })),
    windowY: Number.isFinite(windowY) && windowY > 0 ? Math.round(windowY) : 0,
  };
}

// Where closing the reader should go. null means "just close it where it is":
// there is no origin, or the origin is the very place the reader is showing.
export function readerReturnTarget(origin, { hostArea, hostTab = null } = {}) {
  if (!origin || !origin.area) return null;
  if (origin.area !== hostArea) return origin;
  // Same page: only a different tab needs restoring (e.g. Media's queue opened
  // the reader, which then switched Media to another tab).
  if (origin.tab != null && origin.tab !== hostTab) return origin;
  return null;
}

// Every element under `root` with an id that is scrolled away from the top.
export function captureScroll(root) {
  if (!root?.querySelectorAll) return [];
  const out = [];
  const all = [root, ...root.querySelectorAll("[id]")];
  for (const el of all) {
    if (el.id && el.scrollTop > 0) out.push({ id: el.id, top: el.scrollTop });
  }
  return out;
}

// Put scroll positions back. Elements re-rendered since the snapshot are found
// again by id; ones that no longer exist are skipped.
export function restoreScroll(origin, doc, win) {
  if (!origin) return;
  for (const { id, top } of origin.scroll || []) {
    const el = doc?.getElementById?.(id);
    if (el) el.scrollTop = top;
  }
  if (origin.windowY && win?.scrollTo) win.scrollTo({ top: origin.windowY, behavior: "instant" });
}
