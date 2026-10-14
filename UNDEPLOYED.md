# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

**Dock ticker — headlines and followed teams' games** · #109 · A strip along the top of the bottom dock (⅓ of its height), one item at a time: News's lead stories, then every game of a followed team (before noon yesterday's + today's, from noon today's + tomorrow's). Tap a story → reader; tap a game → News → Sports → Scores on that day, expanded. Web + iPhone app code (no server or DB change), so it needs a deploy for the browser and a TestFlight build for the phone.
- After deploy / TestFlight: the strip shows above the weather / player slides with real headlines, then your teams' games (follow at least one team in News → Sports → Scores → Teams).
- Before noon it shows yesterday's results; after noon tomorrow's games instead.
- Tap a game → Scores opens on that day with it expanded; tap a headline → the reader opens and closing it returns you.
- During a live game the score updates within ~30 s; windows (notifications, Finance review, Meal Plan trash…) still stop above the dock, now above the strip too.

**Dock ticker: patina in light mode, team logos** · #110 · Light mode strip is patina with midnight-blue text (dark mode unchanged); each team's logo sits beside its abbreviation. Web + iPhone app code.
- After deploy / TestFlight: in light mode the strip is patina with midnight-blue text; in dark mode it stays dock blue.
- A game shows both teams' logos next to their abbreviations (ESPN logos — not testable in the sandbox).

_Last deploy: 2026-10-14 (Apple Music restored)._
