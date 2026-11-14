# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Listen: one queue and player per person** · #237 · LISTEN_QUEUE_DESIGN.md. Positions, played marks and queue edits move to the person's own `u-<uid>:listen` row; the queue fills from the home library (Personal for Luke). Needs a **TestFlight build** too.
  Post-deploy: reload every open web tab (an old tab keeps writing positions to the media rows). In the API logs, look for one `tableplan_states?id=in.(…:media,…:media)&select=id,podcastProgress:state->…` read per device and a new `u-<uid>:listen` row for Luke and for Marijane. On the phone, start an episode in Personal, switch to Household and let it finish: it should be gone from the queue in both views.
- **News: the Front page leads with the day's biggest events** · #238 · NEWS_FRONT_PAGE_DESIGN.md. Top stories are ranked from how much the papers are writing about one event (stories, recency, papers, live blog); a newsletter's first link no longer pins a story. Server only: no TestFlight build, no migration.
  Post-deploy: open News on the phone — the lead card and the dock ticker should show the biggest current story, with "Lead story" on it. In the API logs, one `news_articles?select=id,url,title,subtitle,paper,section,origin,published_at,lead_at` read per Front page open (at most one per 5 minutes per warm function). If the order looks wrong, set `NEWS_FRONT_RANK_DISABLED=1` in Netlify to go back to newsletter leads.
- **News: NPR as a paper, BBC / AP as ranking signals, and a check when News opens** · #PRNUM · NEWS_FRONT_PAGE_DESIGN.md §9–§11. Server work is live with the deploy; the **Papers** entry for NPR and "Open in NPR's app" need a **TestFlight build**. No migration, no new env var.
  Post-deploy: after the next hourly run read `newsfeeds_status` — the nine `feeds.npr.org` feeds and the three `signal: true` feeds (two BBC, one Flipboard/AP) should be `ok`; fix or drop any that aren't. Check the `news_signals` row has `items` and a fresh `checkedAt`. Open News twice within ten minutes: the API logs should show one `tableplan_states?on_conflict=id` claim and one round of feed reads, not two. Open an NPR story in the reader. Switches if needed: `NEWS_NPR_DISABLED=1`, `NEWS_OPEN_CHECK_DISABLED=1`.
