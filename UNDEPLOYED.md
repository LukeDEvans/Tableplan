# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Music search: Apple Music only** · #158 · **TestFlight build** (client-only; Luke: iPhone only, no Netlify deploy needed for this). Internet Archive and Musopen are no longer searched, so results come straight from Apple Music. Music already saved from them still plays. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Listen › Music, search anything: Apple Music results in a second or two, no "Free & open sources" section.

- **Music search no longer sticks on "Searching…"** · #156 · **Netlify deploy + TestFlight build** (client-only). Each source in Listen › Music search gets 12 s; one that doesn't answer is named in the note ("… unavailable — showing the rest") and the others' results show. No migration, no new env vars.
  Post-deploy:
  1. iPhone, Listen › Music, search "beethoven": results appear within about 12 s.
  2. Note which source the line above the results names (if any) and add it to the ISSUES.md entry so that source gets fixed.

- **Flat menus; shorter Personal list; Scores back in News** · #155 · **Netlify deploy + TestFlight build** (client-only). No group headings in any view; the landing box back to its old width. Personal lists Overview, Calendar, News, Finance, Watch, Listen, Mail, Explore, Exercise, Leisure. Meal Plan and Shop only in Household; Tasks only inside the Calendar; Weather only from the dock; Scores back in News → Sports. No migration, no new env vars.
  Post-deploy:
  1. Landing (Personal): a plain list, no Plan / Inform / … headings; the white box hugs the links; no sideways scroll.
  2. News → Sports: Scores and Stories tabs; tables and team schedules open from Scores. A ticker game opens there.
  3. Weather from the dock still opens; Tasks from the Calendar still opens.
  4. Household: Calendar, Meal Plan, Finance, Shop, Watch, Listen as before.

- **Business calendar: only its own events** · #154 · **Netlify deploy + TestFlight build** (client-only). The Business calendar no longer shows Bills, Meal Plan, Exercise, Tasks or Birthdays (entries the Calendar adds from other pages), and its sidebar drops their switches. Personal and Household unchanged. No migration, no new env vars.
  Post-deploy:
  1. Business calendar: empty (nothing added there yet); sidebar has no Meal Plan / Exercise / Tasks / Birthdays / Bills rows.
  2. Personal calendar: Bills and the rest still show as before.
- **Watch redraws when the view changes** · #154 · same deploy. Switching views from Watch (or any change merged from another device) now redraws the Watch list; it used to keep the previous view's list until you left the page.
  Post-deploy:
  1. On Watch in Personal, open the page menu, swipe to Household, tap Watch: the list is Household's (empty today), not yours.
