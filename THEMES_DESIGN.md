# THEMES_DESIGN.md — Display mode + themes

Decisions (Luke, 2026-10-14):

- **Two separate choices: Mode and Theme.** Mode is Light / Dark / Auto. Theme is Classic,
  Household, Urban Greens, Halloween, or Seasonal. Every theme has both a light and a dark version, so Auto works
  inside any theme.
- **Per person.** Stored in `state.displayPrefs` (`{ mode, theme, icon }`) in the personal
  `recreate` section, stamped field by field (`TRACKED_SETTINGS`, `"fields"`). One
  person's choice never changes what anyone else in the household sees. The old
  household-wide `config.themeMode` is only the fallback mode until a person picks one.
- **Seasonal is opt-in.** The default theme is Classic. Seasonal means Halloween for all of
  October and Classic the rest of the year (`SEASONS` in `theme.js`; add more seasons there).
- **Visibility first.** Every text/fill pair a theme defines must reach WCAG AA (4.5:1).
  `test/theme-contrast.test.js` enforces this for every theme in its `CHECKED` list, and
  every new theme goes in that list. Danger red must also differ from the accent hue by at
  least 25°, so a warning never reads as decoration.
- **Seasonal app icon (iPhone).** Halloween uses an all-orange logo on black
  (`AppIconHalloween`). The icon follows the active theme unless the person turns off
  "Change the app icon too". iOS always shows its own short notice when the icon changes,
  so the app only asks when the icon really differs.
- **Halloween is orange, black and purple** (Luke, 2026-10-14). Orange stays the accent
  (fills, links, highlights, today). Purple (`--purple`, also `--window-border`) outlines
  windows and buttons and tints the dock: `#6a35a0` in light, `#a77bff` in dark.
- **Household and Urban Greens** (Luke, 2026-10-20). Both are pickable; **Classic stays
  the default.** Their names may change in a follow-up.
  - **Household:** navy accent (`#24395e`; dusty blue `#9fbad6` in dark), dusty blue
    window outlines, blush page backdrop and dark-mode outlines, sage soft highlights
    (`--accent-soft`, `--sun`, `--purple`). Dock: navy with a blush edge.
  - **Urban Greens** (`urbangreens`): from the Urban Greens logo — green `#78bb34`, gray
    `#7e7e7e` — plus black and white. Light mode uses a deeper green (`#3d7517`) for text
    and fills so it reaches 4.5:1 on white; dark mode uses the logo green itself. Window
    outlines are black (light) / gray (dark). Dock: black with a logo-green edge.
  - No alternate iPhone icon or favicon for either yet.

## How it works

- `theme.js` is pure apart from `applyResolvedTheme()`. `resolveTheme(prefs, { systemDark, now })`
  turns the prefs into `{ scheme, palette, themeColor, icon, favicon }`.
- **Auto is resolved in JS.** CSS only ever sees `data-theme="light" | "dark"` (plus
  `data-palette="<theme>"` when not Classic), on both `<html>` and `<body>`. There is one
  dark rule set. The old CSS copy for Auto had drifted (74 dark fixes against 55 Auto ones)
  and was removed. `app.js` re-applies on the device's light/dark change and when the app
  returns to the foreground, which is also when Seasonal re-checks the date. No timers.
- **A theme only redefines tokens.** Each one is a `/* theme:<name>:light */` and a
  `/* theme:<name>:dark */` block in `styles.css`, read by the contrast test.
  `--on-accent` / `--on-tomato` are the text colors on accent and danger fills. Classic
  leaves them unset, and each rule's fallback keeps Classic's look.
- **Shared surface tokens that only dark modes set.** `--paper` (menus, the mail sidebar,
  the article reader, … written as `var(--paper, #fff)`) and `--card` (raised cards
  written as `var(--card, <cream>)`). Light mode leaves them unset so each fallback keeps
  its look; dark modes set them so those surfaces don't stay white under light text.
- **The mail reading surface stays white in dark mode** and carries the light version of
  the theme's tokens (`.mail-thread-panel` in `styles.css`), so chips and buttons on it
  read on white. The contrast test checks it.
- Theme extras that aren't tokens (the orange home logo, the dock) sit right under the
  theme's blocks in `styles.css`.
- Browser chrome follows the theme through `<meta name="theme-color">`, and the browser tab
  through the favicon. A home-screen web app's icon can't change; only the iPhone app's can.
- iPhone: `ios/App/App/AppIconPlugin.swift` (`AppIcon` plugin: `get` / `set`), registered in
  `MainViewController.swift`; the alternate icon set is listed in
  `ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`. `nativeAppIcon()` in `native-bridge.js` is
  null in a browser or an older app build.

- **Cold start (2026-10-15).** The person's last resolved theme is kept on the device in
  `live-display-v1` (account-scoped, cleared on sign-out). The inline script at the top of
  `<body>` in `index.html` applies it before first paint, and `currentDisplayPrefs` uses it
  until the cloud prefs load. The iPhone icon is never changed before then
  (`markDisplayPrefsKnown`, after hydration or a choice made on this device), so a cold
  start can't reset the icon and set it back.

## Adding a theme

1. Add it to `THEMES` (label, theme-color for light and dark, swatch) and, if it's seasonal,
   to `SEASONS` in `theme.js`.
2. Add `/* theme:<name>:light */` and `/* theme:<name>:dark */` token blocks to `styles.css`.
   Keep one value per line.
3. Add the name to `CHECKED` in `test/theme-contrast.test.js` and make it pass.
4. Optional: an alternate iPhone icon (a new `.appiconset`, the build setting, and the
   plugin's `allowed` list) and a favicon.
5. Look at it: Calendar, Meal Plan, Shop, Finance and News at phone width, light and dark.
   Freeze CSS transitions when screenshotting a theme switch headlessly, or the shots catch
   colors mid-transition.

## Known gaps

`styles.css` still has many hard-coded colors (about 1,100) that no theme reaches. The
everyday surfaces (cards, dialogs, menus, buttons, the five main pages) are all
token-based and checked. Less-used screens may still show Classic colors inside a theme.
Logged in ISSUES.md for a page-by-page sweep.
