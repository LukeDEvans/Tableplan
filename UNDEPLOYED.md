# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Tools menu closes on an outside tap** · #285 · client only. Opening Settings (or tapping/clicking anywhere else, or Esc) now closes the nine-dot tools menu. Post-deploy, Claude (Luke's Chrome): open the tools menu, click Settings → only Settings is open. Luke (iPhone): same check.
- **Watch: tabs move into the menu** · #286 · client only. All, Upcoming, In Theaters and your own tabs (Spooky, French Revolution…) now sit in the three-bar menu, nested under Watch list like Mail's subfolders, with a chevron to fold them and a "+ New tab" row; the strip above the list is gone and the picked tab's name heads the list. Dragging a show onto a tab in the menu still files it; a show's ⋯ › Tabs › New tab… opens the menu with the name box. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): hover the Watch rail, the tabs show under Watch list; pick Spooky, the list heads "Spooky". Luke (iPhone): ☰ › a tab closes the menu onto that tab; the chevron folds the tabs.
- **Finance: pinned tab bar, cleaner Transactions and card, Insights folded away** · #296 · client only. Tabs are Transactions · Budget · Accounts in an opaque bar pinned to the window top with a sliding underline; Transactions has no title or box, one tools row (search, Add, Filter with sort inside, bell) that tucks on scroll down, pinned day dates, red underline for charges to review, receipts with no bank charge yet as rows, upcoming bills just above the newest charge; the card has a ⋯ menu instead of ✎/×, category as text that filters, View Receipt link; Budget gains the savings figures, net worth and the old Insights charts; Accounts is just the list (names open the bank, red ! for stale), ⋯ › Edit accounts; Bank Link, Personal Accounts and Alerts are in Finance's gear menu. Reaches the iPhone by TestFlight; the web on the next deploy. Post-deploy, Claude (Luke's Chrome): `qa-finance-tabs` checks by hand on the real data — tabs bar, a card's ⋯, a category tap filters, gear › Bank Link opens. Luke (iPhone): scroll Transactions — the tools tuck and come back, dates stay pinned, nothing peeks above the tabs; open a charge, it jumps to the top.
