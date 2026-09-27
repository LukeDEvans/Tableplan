# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

## News intake: email-linked articles → Media bell swipe deck (merged 2026-09-27)
PR: https://github.com/LukeDEvans/Tableplan/pull/7 · spec: NEWS_INTAKE_DESIGN.md

- Articles linked in NYT / Economist / Star Tribune emails become swipe cards behind the
  Media page's 🔔. Right swipe saves the article to Media → Publications; left dismisses it.
  An article is never delivered twice, and nothing older than 7 days is delivered.
- Newsletter → listenable article now runs on every real newsletter from those papers.
- Processed news emails are filed to Apps/AI trash.
- Article scanning moved into Media → Publications (Scan button). The standalone
  Publications page is removed, along with the Home button and the RSS feed code.

**After deploying:**
1. Settings → Mail AI → switch on "NYT / Economist / Star Tribune articles → Media
   notifications". All three are **off by default**, so nothing happens until you do.
2. After the first few real emails, check the Netlify function logs for
   `[news-links] <paper>: N new of M unseen`. `0 of 0` on a newsletter full of articles
   means the link patterns missed (ISSUES.md, "News intake URL/sender patterns").

## Finance: "Use stored transaction history" toggle layout fix (PR #8)
PR: https://github.com/LukeDEvans/Tableplan/pull/8

- Finance › Accounts tab › Accounts card › Bank link: the switch and its label now sit on
  one row (the label used to wrap under the switch on phones). CSS only.
- Also closes the ISSUES.md "verify finance ingest on deployed runtime" item (docs).

**After deploying:** nothing.
