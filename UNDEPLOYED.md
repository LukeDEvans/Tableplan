# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Themes: Household and Urban Greens** · #138 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). Two new themes in Settings › Display, each with light and dark: Household (navy, dusty blue, blush, sage) and Urban Greens (the logo's green and gray, with black and white). Classic stays the default. No migration, no new env vars.
  Post-deploy:
  1. Settings › Display: pick Household, then Urban Greens, in Light and Dark — Calendar, Meal Plan, Shop, Finance and News read clearly.
  2. Open an email in Dark mode with each theme — the white reading surface keeps readable buttons and links.
- **Page menus: groups slide open and closed** · #137 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). Tapping a group heading slides the old group shut while the new one slides open (~0.2s), with the pages fading in. Off when the phone's Reduce Motion is on. No migration, no new env vars.
  Post-deploy:
  1. Landing page: tap Plan, then Inform — Plan slides closed while Inform slides open. Same in the page menu.
  2. Tap the open heading — it slides shut.
- **Page menus: no arrows on the group headings** · #136 · **TestFlight build** (client-only; the laptop needs a Netlify deploy). The Plan / Inform / Resource / Media / Message / Recreate headings on the landing page and in the page menu no longer show a ▾ arrow; tapping them still opens and closes the group. No migration, no new env vars.
  Post-deploy:
  1. Landing page and page menu: headings are plain words; tapping one opens it and closes the other.
