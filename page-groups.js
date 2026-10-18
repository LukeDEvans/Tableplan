// Page groups — the landing page's links and the page-title menu (Luke, 2026-10-17).
//
// Pages are grouped under six headings that open like an accordion: tapping a
// heading shows its pages and closes whichever group was open, so only one is
// ever open. Both menus share this list and the behaviour below; the buttons
// themselves are static markup in index.html (other code and the QA scripts
// find them by id), each group a `.page-group[data-page-group]` holding a
// `.page-group-head` button and a `.page-group-pages` panel.
//
// Pure list + small DOM helpers; no app state. app.js decides which page
// buttons are hidden (page switches) and then calls syncPageGroups().

export const PAGE_GROUPS = [
  { key: "plan",     label: "Plan",     pages: ["calendar", "meal-plan", "tasks"] },
  { key: "inform",   label: "Inform",   pages: ["news", "weather"] },
  { key: "resource", label: "Resource", pages: ["finance", "shop"] },
  { key: "media",    label: "Media",    pages: ["watch", "listen"] },
  { key: "message",  label: "Message",  pages: ["mail"] },
  { key: "recreate", label: "Recreate", pages: ["explore", "exercise", "leisure", "scores"] },
];

// Which group holds the page an `activeAppArea` shows (null for Home or an
// area with no menu entry). Contacts lives inside Mail; Inventory is a Shop space.
const AREA_GROUP = {
  plan: "plan", eat: "plan", do: "plan",
  news: "inform", weather: "inform",
  finance: "resource", shop: "resource", inventory: "resource",
  watch: "media", media: "media",
  mail: "message", contacts: "message",
  explore: "recreate", play: "recreate", recreate: "recreate", scores: "recreate",
};
export function groupForArea(area) {
  return AREA_GROUP[area] || null;
}

const groupsIn = (root) => [...(root?.querySelectorAll(".page-group[data-page-group]") || [])];

// Open one group (or none with key null), closing the rest.
export function openPageGroup(root, key) {
  for (const group of groupsIn(root)) {
    const open = !!key && group.dataset.pageGroup === key;
    group.classList.toggle("is-open", open);
    group.querySelector(".page-group-head")?.setAttribute("aria-expanded", String(open));
    const panel = group.querySelector(".page-group-pages");
    if (panel) panel.hidden = !open;
  }
}

export function openGroupKey(root) {
  return groupsIn(root).find((g) => g.classList.contains("is-open"))?.dataset.pageGroup || null;
}

// Tapping a heading toggles its group; any other open group closes.
export function wirePageGroups(root) {
  if (!root || root.dataset.groupsWired) return;
  root.dataset.groupsWired = "1";
  root.addEventListener("click", (event) => {
    const head = event.target.closest(".page-group-head");
    if (!head || !root.contains(head)) return;
    event.preventDefault();
    event.stopPropagation();
    const key = head.closest(".page-group")?.dataset.pageGroup || null;
    openPageGroup(root, openGroupKey(root) === key ? null : key);
  });
}

// After app.js has hidden the pages that are switched off: hide a group with no
// visible page, and carry a page's notification mark up to its group's heading
// (so a closed group still shows that something inside needs attention).
export function syncPageGroups(root) {
  for (const group of groupsIn(root)) {
    const pages = [...group.querySelectorAll(".page-group-pages > button")];
    const shown = pages.filter((b) => !b.hidden);
    group.hidden = shown.length === 0;
    const marked = shown.some((b) => b.classList.contains("has-notif-dot"));
    group.querySelector(".page-group-head")?.classList.toggle("has-group-notif", marked);
  }
  // An open group that just lost all its pages shouldn't stay "open".
  const open = openGroupKey(root);
  if (open && groupsIn(root).find((g) => g.dataset.pageGroup === open)?.hidden) openPageGroup(root, null);
}
