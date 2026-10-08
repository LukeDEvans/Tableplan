# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-08 (PRs #72–#76)._

- **News: Sync Settings moved to News; one Sign in or Sign out per paper; NYT sign-in diagnostics** · PR #PRNUM
  - Sync Settings (newspaper sign-ins and subscriber cookies) opens from a new ⚙ button on the News
    page and from the app menu on News. It's gone from Media: Podcast Ad-Block moved to Media →
    Podcasts settings, and the publications list is in Media → Publications (unchanged). The Media
    articles tab no longer has its own Sync Settings gear.
  - In the app, each paper shows its state on this phone and one button: **Sign in** when signed
    out, **Sign out** when signed in ("Checking…" briefly while the phone checks).
  - Star Tribune now has a cookie field too (the old panel only had NYT and Economist).
  - NYT Apple sign-in stalling after Face ID: the sign-in sheet now identifies as Safari, and records
    its steps (host + path only); the server keeps the last attempt's steps (ISSUES.md).
  - **Needs a deploy (the step log is saved by the `gmail` function) and a TestFlight build.**
  - **After deploy + TestFlight:** News → ⚙ → the Economist row shows "Signed in · Sign out", the
    NYT and Star Tribune rows "Not signed in · Sign in". Try NYT → Sign in → Sign in with Apple. If it
    still stalls, tell Claude: it reads `lastTrail` from `mailnewssubs_<user>`. Media → menu has no
    Sync Settings; Media → Podcasts settings has Podcast Ad-Block.
