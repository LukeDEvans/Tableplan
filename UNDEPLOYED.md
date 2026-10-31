# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Watch: cross episodes off, services from the right, plainer seasons and Next** · #203 ·
  Posters show only the title (year/seasons stay in the panel); episodes are crossed off by
  tapping (no check boxes); services start at the right with "Other services" last; the
  season menu says only "Season N" (no bar, no "All"); NEXT shows "S1 E1" beside it and a
  plain ✓. Post-deploy: open a show on the phone and cross an episode off and back.
- **Watch: hide the NEXT box** · #204 · The show panel no longer shows the Next-episode
  line (code kept behind `WATCH_SHOW_NEXT_BOX`); a season that's loading keeps the
  episode list's height so the screen doesn't move. Post-deploy: open a show — no NEXT box.
- **Watch: services as links under the year line; light panel; one season box** · #205 ·
  Services / Other services are plain links in the theme's link colour, left-aligned with
  Other services first, right under the year line; the panel is the light surface and the
  season menu heads one box with its episodes. Post-deploy: open a show in light and dark.
