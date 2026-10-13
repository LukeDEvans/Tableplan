# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Calendar: pinch direction flipped** — fingers apart zooms in (month → week → day), together zooms out. · PR #81 · Post-deploy: on the phone, pinch out from month → week → day and back in to month.

_Last deploy: 2026-10-11 #2 (News: Sports always shows)._

- **Shop: the blue window border is back** · PR #82 · The 2026-10-06 change that slimmed the Shop window also removed its navy border; the border is restored. The buffer and shadow stay off and the trimmed list gutter stays, so the list keeps its extra width. CSS only. Verified in the browser at 390px: 2px navy border, no sideways scroll. **After deploy + TestFlight:** open Shop on the phone and check the border.

- **Finance: decluttered top of page + no sideways scroll on Insights** · branch `claude/finance-declutter` (no PR — merged directly) · Removed the Net worth / Cash on hand / This month cards and the alert-chip row (to review, bank connection error, stale, large purchase, low balance, over budget, to itemize); those figures live in Accounts, and the Transactions/Accounts tab dots + the bell still flag attention. Dropped the matching overview-only toggles (over budget, large purchase, low balance) from Settings › Finance › Alerts. Insights' Cash flow In/Out/Net row now wraps instead of pushing the page ~80px sideways at phone width. Verified at 360px in headless Chromium on every finance tab. **After deploy + TestFlight:** open Finance on the phone — tabs at the top, no cards/chips; swipe sideways on Insights and confirm it doesn't move.

- **Finance: no more "Requested date range exceeds recommended range of 45 days" banner** · branch `claude/simplefin-window` · The daily bank pull (cron + manual Refresh) now asks SimpleFIN for 44 days instead of 45. Exactly 45 was being flagged as over the limit. The date-range advisory is also dropped from the errors the page shows, including today's cached copy, since the transactions did load. Real connection errors (e.g. "Apple Card … Auth required") still show. Server-side (Netlify functions) only, so **this needs the Netlify deploy; TestFlight alone won't change it.** **After deploy:** open Finance and confirm the 45-day banner is gone. The Apple Card auth message stays until that connection is re-authorized in SimpleFIN.

- **Finance: no category suggestion bubbles under unlabeled transactions** · branch `claude/finance-no-quick-labels` · Removed the row of most-used-category chips (and "More…") under each unlabeled spend in the transaction log. Tapping the transaction opens its card to set the category, as before. Client-only (TestFlight or deploy). Verified in the browser at 360px: unlabeled rows have no chips, and tapping one opens the card with the category picker. **After TestFlight/deploy:** check that the log has no chip rows.

- **Finance: Transactions header = Add · Filter · Bell; filter is a popup window; no bank-message banner** · branch `claude/finance-txn-toolbar` · Add transaction (+) and a new Filter button (funnel icon, accent dot when filters are on) sit left of the notifications bell. Filter opens a window in the same frame as Notifications, with Label, Account and a new **date range** (blank = the viewed month; a range spans every loaded transaction). It has Clear filters and Done. Search and Sort stay above the list. The in-list scan-receipt button and its bulk-scan code are removed; the app's top-right receipt scanner replaces them. The "Couldn't load some transactions — …" banner is removed from Transactions; bank connection messages still show in Accounts (bank-link section + tab dot) and the bell. Client-only. Verified at 360px in headless Chromium: header order, each filter narrows the list, the date range shows September from October, Clear restores, + opens the add form, no sideways scroll, no page errors. **After TestFlight/deploy:** try each filter on the phone, including the native date pickers.


- **Media split: reader + Saved in News, Watch is its own page, Media → Listen** · PR #83 · See MEDIA_SPLIT_DESIGN.md. Back from an article returns you to where you opened it (page, tab, scroll). The article reader and the saved-articles list live in News: one **Saved** view holding stories saved from News, newsletters, extension, URLs, scans and PDFs. A story's menu says **Save**; Mail's action is **Save to News**. Watch is a standalone page on the landing page and in the page menu. Search is split: Watch covers films, shows and videos, and Listen covers podcasts, books and online audio. Media's visible name is **Listen**; the internal keys and the `#media` link are unchanged. Client-only (TestFlight or deploy). Verified: unit suite, build, a happy-dom boot of the unbundled source, and Luke on the deploy preview. Not run: the real-browser `check:boot` (Chromium download blocked in the cloud session). **After TestFlight/deploy:** on the phone, check these:
  - Open a News story, press Back, and land on News.
  - Open an article from Listen's queue, press Back, and land on the queue.
  - Watch opens from the landing page.
  - Save a story and find it in Saved.

- **Finance: the four tabs stay pinned at the top while scrolling** · branch `claude/finance-sticky-tabs` · `.fin-tabs` is `position: sticky` inside the Finance window (its scroller is `#financeMainPage`), with an opaque backing so rows don't show through. CSS only. Verified at 360px in headless Chromium: after scrolling Transactions, Budget and Accounts, the tabs stay at the same spot and are still tappable. **After TestFlight/deploy:** scroll a long Transactions list on the phone and switch tabs without scrolling back up.

- **Finance: "Updated …" moved to the bottom of the Transactions card** · branch `claude/finance-updated-footer` · The bank-data timestamp ("Updated yesterday" / "Updating…") moved from under the card header to a small centered footer at the very bottom of the month's list. Client-only. Verified in headless Chromium at 360px with a stubbed timestamp: it is the card's last element. **After TestFlight/deploy:** scroll to the end of Transactions and look for the line.

