# Settings audit — what's there, what to cut, how to reorganize

Status: **APPROVED DIRECTION (Luke, 2026-10-13); not started.** Read from code on `main` @ `bb2bc33` (2026-10-13). Findings are from reading `index.html` / `app.js`, not from tapping through the app, so "unreachable" means *no code path opens it*; a quick look on the phone should confirm before anything is deleted.

---

## 1. How settings are reached today

There are **four separate systems**, which is most of why it feels cumbersome:

1. **The gear menu** (`#appMenu`). Always shows *User* and *Settings*, then 0–4 page-specific items depending on the current page (`updateSettingsMenuOptions`). Those items mix real settings (Meals, Nutrition) with data views (Workout Logs, Receipts & Price History, Queue) and actions (Import/Export contacts). Labels like "Watch", "Accounts", "Checklist", "Meals" only make sense if you know which page you're on.
2. **The Settings dialog** (`contextSettingsDialog`, "General" panel). A flat grid of 15 buttons plus an Admin grid of 5. Every button opens a sub-panel or closes the dialog and opens another dialog.
3. **Stand-alone dialogs** (Meal Plan Settings, Nutrition, Ingredient Options, Grocery Items, Tags, Auto-Fill Rules, Recurring Tasks, Email, Backup Health, …), each with its own Save/Cancel/Done pattern.
4. **In-page gears and sidebars.** Radio has its own gear; News has a "Sync settings" button; Calendars live in the Calendar sidebar; Weather locations and sports favorites live on their pages.

Plus an **orphaned fifth**: the old full-page Settings (`#settingsMainPage`), only reachable by typing `#settings` in the URL.

---

## 2. Things that are broken or lost (fix regardless of reorganization)

| Finding | Evidence | Impact |
|---|---|---|
| **Light / Dark / Auto has no reachable control.** | The only `themeMode` radios are on the orphaned `#settingsMainPage`. The Settings dialog's handler listens for `contextThemeMode`, but nothing renders that input. | Can't change display mode on the phone. |
| **Household / Personal view switch is unreachable.** | `globalScope` radios exist only on `#settingsMainPage`; no other caller of `setAllScopes`. | Can't flip the whole app's view. |
| **Trash is unreachable.** | `openTrashDialog` is wired only to the orphaned page's button; the dialog's `"trash"` action has no button. | Deleted items can't be recovered from the UI. |
| **Movie Theaters panel title says "Settings".** | Kind `"watch"` is missing from the titles map. | Cosmetic. |
| **"AI Notes" holds unrelated settings.** | That panel also contains Daily briefing, Push notifications, "Suggestions in the assistant" and "Assistant can read Finance". | Settings hidden behind a misleading label. |
| **No build/version shown anywhere.** | ISSUES.md (Media queue entry) already asks for a build stamp in Settings. | Can't tell if the phone runs old code. |

---

## 3. Dead code to delete (no route opens it)

- **`#settingsMainPage`** (whole old Settings page, ~170 lines of markup + `showSettingsApp`). Move theme and view first (§2).
- **`calendarsDialog`** (the iCal-URL calendar editor). Superseded by Google Calendar API sync; only opened from the orphaned page. *Check first: are any calendars still on the legacy iCal path?*
- **`articleSyncSettingsDialog`** and its two buttons (`articleSyncSettingsBtn`, `exArticleSyncSettingsBtn`), which are permanently `hidden`. Sync settings now live in the Settings dialog's "read-sync" panel.
- **`doSettingsDialog`** ("Do settings will live here…"). Its opener button doesn't exist.
- **Settings-dialog panels `eat`, `do`, `play`.** Fully built button grids that nothing opens.
- **`familyMembersDialog`.** Duplicates the members list inside the Household panel; only opened from the orphaned page.
- **Duplicate Voice Commands and newspaper-cookie markup** on the orphaned page.
- **Daily briefing + browser push block** (in "AI Notes"). Already scheduled for removal in IOS_NOTIFICATIONS_DESIGN Phase 2.

---

## 4. Keep, cut, or move — item by item

**Keep (useful, just regroup):** Profile (name, birthday, home address), Notifications/reminders, Pages, Location Services, Voice (read-aloud voice + speed), Mail Reading, Mail AI, Household members/invites, Global Pages, Users, Households, Backup Health, Restore, Export, Calendars, Meal types, Auto-Fill Rules, Nutrition goals, Ingredient Options, Recipe Tags, Grocery Items, Preferred Stores, Inventory rooms, Recurring Tasks, Finance accounts + alerts, Emergency target, Podcast recent window + ad-block, Radio stations, Watch services/tabs/theaters, Hobbies, Newspaper sign-ins.

**Move out of settings (they're data or actions, not settings):**
- Workout Logs, Log Past Date, Receipts & Price History, Podcast Queue, Publications list, Import/Export contacts, AI Action Log, Import from AI Chat → onto their own pages (or a "…" menu there).

**Cut or demote:**
- **Apple Music developer checklist** (Apple portal steps, Netlify env vars) is shown to every user. Move it to a doc; keep only the on/off + sign-in. *Bigger question: is in-app Apple Music still wanted, given the native iOS player direction?*
- **Cookie-paste instructions** (DevTools → Application → Cookies). Keep as a collapsed "Using a browser instead?" under each paper; the phone's native sign-in is the main path.
- **API Usage** → admin only.
- **Mail AI's recipe toggles** (NYT Cooking, Bon Appétit, vegetarian only) are recipe-intake preferences that happen to arrive by email. Either move them to Meal Plan → Recipe sources, or keep them in Mail AI and link from Meal Plan. *The CLAUDE.md rule says every AI email feature has its toggle in Settings → Mail AI, so this is your call.*
- **Weekly Email** → under AI, not top level.
- **Voice Commands** (Siri/Alexa passphrase). *Still used?* If not, cut; if so, it belongs under Connections.

---

## 5. Proposed structure

**Gear menu → just three items:** *This page* (opens Settings scrolled to the current page's section), *Settings*, *Profile*. Nothing else. No more page-dependent lists of ambiguous labels.

**One Settings screen, list-style (like iOS Settings), six groups:**

1. **You**: Profile & sign-out · Display (Light/Dark/Auto) · Notifications · Voice & read-aloud · Location
2. **Household**: Members & invites · Household / Personal view · Pages I see · *Admin:* Global pages, Users, Households
3. **Connections** (one place to see what's linked and what's broken; the Phase 2 connection alerts land here): Google Calendar · Gmail · Bank (SimpleFIN) · Newspaper sign-ins · Apple Music · Siri / voice commands
4. **Pages** (one row per page, in page-menu order, each opening that page's settings):
   - Calendar: calendars, recurring tasks, reminders
   - Meal Plan: meal types, auto-fill rules, nutrition goals, ingredient options, recipe tags, recipe sources
   - Shop: preferred stores, grocery items, checklist; Inventory rooms
   - Finance: accounts, alerts, emergency target
   - News: publications, sports favorites
   - Listen: podcasts (recent window, ad-block), radio stations
   - Watch: services, tabs, theaters
   - Recreate: hobbies, workouts, workout auto-fill
   - Mail: reading, AI features
5. **AI**: Assistant suggestions · Assistant can read Finance / Email · AI notes · Weekly email · API usage (admin)
6. **Data & safety**: Export · Backup health · Restore · Trash · Version (build + "Reload" when newer)

**Conventions for every settings screen:**
- Settings save as you change them (house toggle, `persist()`); no Save/Cancel on preference screens. Keep Save only for forms that edit a list item.
- Back arrow returns to the parent group, not always to the top.
- Every row says in one line what it does; no setup instructions inline.
- Each row shows whose setting it is: **you**, **household**, or **this device** (e.g. reminders and voice are device; meal types are household).
- In-page gears (Radio) open the same Settings page, deep-linked, rather than a separate panel.

---

## 6. A settings agent?

**Yes, one, scoped to the framework and the map, not to page content.** Per-page settings content stays with each domain agent, which already update themselves in every PR (CLAUDE.md "Keeping agents current"). What drifts is the *structure*: orphaned panels, duplicate dialogs, lost controls. One agent plus a registry and a CI check covers that:

- **`SETTINGS_REGISTRY`** (one list): id, label, group, owning page/agent, scope (you / household / device), synced key (ties into `TRACKED_SETTINGS`), and the panel that renders it.
- **CI test, like `architecture-agent-coverage`:** fails when a settings control isn't in the registry, when a registry entry has no route that opens it, or when a synced setting key has no control. That would have caught every §2 and §3 finding.
- **`.claude/agents/settings.md`** owns the settings shell, the registry, the §5 conventions and the CI test. Domain agents add their rows; the settings agent (or the reviewer) checks placement.

Multiple settings agents would overlap with the domain agents. A recurring audit job isn't needed once the CI check exists.

---

## 7. Decisions (Luke, 2026-10-13)

1. **Structure (§5): approved.**
2. **Dead code (§3): approved for removal.**
3. **Display:** Light / Dark / Auto comes back soon, together with **festive theming**. Build the Display screen so seasonal themes slot in beside the mode.
4. **Household / Personal view: keep** in some form. Luke is still working out how household and personal overlap, so the capability (`setAllScopes`, section scopes) stays; whether a switch is exposed now waits on that design.
5. **Legacy iCal calendars:** fine to lose; Luke can re-add any that were still on that path. Delete the iCal dialog and fetch path.
6. **In-app Apple Music: drop for now.** Other music subscriptions may come in about a year; handle them then.
7. **Siri / voice commands:** not used today, but keep the option open depending on what they can do (see §9).
8. **Trash and AI Notes:** Luke leans toward removing both. Open points before doing so are in §9.

Still open: Mail AI recipe toggles (move to Meal Plan, or stay in Mail AI with a link).

## 8. Build order

1. **Delete dead code** (§3) plus the iCal calendar path and in-app Apple Music.
2. **Registry + CI check + settings agent** (§6).
3. **New structure** (§5), group by group, each domain agent moving its own rows. Remove the misfiled settings from "AI Notes" into their groups.
4. **Display + festive theming** (separate design).

## 9. Notes on the open items

**Siri voice commands, what they do today.** A Siri Shortcut sends the dictated sentence plus a household passphrase to `voice-command.js`, which runs it through the same assistant as in-app chat (fast model), with the same memory, and replies with one spoken sentence. It can: add or complete a task, add or remove a grocery item, set a meal, log a meal, add an event, add to the watchlist or mark watched, add a book or update its status, log a workout, add a piano song, and write a note. It can't delete anything. Setup is one Shortcut on the phone. Alexa isn't actually built; only the label mentions it. Recommendation: keep it under Connections as "Siri Shortcut", drop "Alexa" from the copy.

**Trash is the recipe trash.** It only holds deleted recipes (`trashedRecipes`), with restore and delete-forever, and nothing ever empties it automatically. Removing just the screen would leave every deleted recipe in synced state forever. Options: (a) delete recipes permanently after a confirm, and drop trash entirely; or (b) a "Recently deleted" view inside the Recipe Box with automatic purge after 30 days. Recommendation: (b) if recipes get deleted by accident ever; otherwise (a).

**AI Notes is the assistant's memory.** The chat assistant and Siri write notes about preferences, app gaps and patterns (`state.aiNotes`) and read them as context on every request. The panel is the only place to see, edit or clear them. Removing the panel leaves the memory working but invisible; removing the feature makes the assistant forget. Recommendation: keep the memory, and keep a small "What the assistant remembers" row under AI; move the four misfiled settings out.
