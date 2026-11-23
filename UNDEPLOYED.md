# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Watch: tabs move into the menu** · #286 · client only. All, Upcoming, In Theaters and your own tabs (Spooky, French Revolution…) now sit in the three-bar menu, nested under Watch list like Mail's subfolders, with a chevron to fold them and a "+ New tab" row; the strip above the list is gone and the picked tab's name heads the list. Dragging a show onto a tab in the menu still files it; a show's ⋯ › Tabs › New tab… opens the menu with the name box. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): hover the Watch rail, the tabs show under Watch list; pick Spooky, the list heads "Spooky". Luke (iPhone): ☰ › a tab closes the menu onto that tab; the chevron folds the tabs.
