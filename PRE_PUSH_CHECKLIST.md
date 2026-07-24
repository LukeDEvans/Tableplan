# Pre-push checklist

Run through this every time before pushing (push = Netlify deploy). Claude: do
this pass whenever Luke says he's about to push, and report anything that fails.

## 1. Mobile horizontal fit (the recurring one)
On a ~360px-wide viewport (iPhone), **no page may scroll sideways.** A global
guard (`body { overflow-x: hidden }`) hides accidental bleed, but that only
*masks* a too-wide element — check each page actually *lays out* within the
screen, nothing important clipped at the right edge:

- [ ] **Home**, **Meal Plan**, **Shop**, **To-Do**, **Exercise**, **Watch**,
      **Media**, **Mail**, **Finance**, **Stock/Inventory**, **Recreate**,
      **Calendar**, **Explore**, **Health** — open each, confirm no right-edge
      clipping and no horizontal scrollbar on the page body.
- [ ] Long titles/labels ellipsize or wrap — they don't push the panel wide.
      (Watch for grid blowouts: a `grid` track with no `minmax(0, …)`/`min-width:0`
      sizes to its widest child. Use `minmax(0, 1fr)` or `minmax(min(Npx,100%),1fr)`.)
- [ ] Toolbar / header rows (day tabs + notification bell + action buttons) fit;
      the flexible part has `min-width: 0`, fixed buttons are `flex: 0 0 auto`.
- [ ] Intended horizontal-scroll strips (meal-day carousel, day tabs) still
      swipe and snap.

## 2. Data safety
- [ ] No finance data written to localStorage (Supabase-only).
- [ ] New state keys: added to `STATE_SECTIONS`, `defaultState`, the normalizer,
      and (if id-keyed) `mergeStates`. Bump `STATE_SCHEMA_VERSION` if finance keys changed.

## 3. Sanity
- [ ] `node --input-type=module --check < app.js` passes; `<dialog>` tags balanced in index.html.
- [ ] Every new Mail AI feature has a Settings → Mail AI toggle and a server-side flag check.
- [ ] Service worker `CACHE` bumped if shipping client changes that must invalidate cache.

## 4. Deploy hygiene
- [ ] Confirm with Luke before pushing (deploy credit + GitHub push cap).
- [ ] After deploy: any pending post-deploy reminders (finance version-stamp +
      category rebuild, Chase Gmail filter).
