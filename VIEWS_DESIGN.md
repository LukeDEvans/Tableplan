# Views: Personal, Household, Business — design & plan

Status: **DIRECTION AGREED (Luke, 2026-10-20). Build step 2 (the view shell) built on `claude/views-shell` (§13); not merged or deployed. Steps 1 and 3–9 not started.** Written from the design docs and the decisions in §10; items marked *check in code* still need confirming on `main` before their step is built.

Goal: the app splits into three views, each with its own pages, data and look:
- **Personal** is the user's own space.
- **Household** is shared with everyone in the household.
- **Business** is shared with everyone in the business.

You switch between views by swiping on the view band. For now only Luke (admin) has more than one view; his wife has Household only.

---

## 1. The three views

| View | Pages | Shared with | Page menu |
|---|---|---|---|
| **Personal** | The whole app as it is today (all page groups) | Nobody: always that user's alone | Grouped accordion (PAGE_GROUPS_DESIGN) |
| **Household** | Calendar, Meal Plan, Finance, Shop, Watch, Listen | Every household member | Flat list, no group tabs |
| **Business** | Calendar (more later) | Every business member | Flat list |

The look and UI are the same in all three views, including the dock and the news/scores ticker. What tells the views apart is mainly each view's display settings (colour scheme, light/dark, later festive themes), which are **kept per person, per view** (§6).

---

## 2. Data model

### 2.1 Spaces

Each view is backed by a **space**:

```sql
create table live_spaces (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('personal','household','business')),
  name       text not null,
  created_by uuid references auth.users,
  created_at timestamptz default now()
);
create table live_space_members (
  space_id uuid references live_spaces on delete cascade,
  user_id  uuid references auth.users on delete cascade,
  role     text not null,            -- household: admin|member; business: owner|manager|employee
  primary key (space_id, user_id)
);
-- RLS: members read their own spaces and memberships; only owners/admins change membership. No anon.
```

- **Household = the existing household group** (`live_group`). *Check in code:* if `live_group` already has an id and a members list, Household **reuses it**, either as a view over it or by adding `kind` to it, instead of duplicating it. Its shared data rows stay where they are.
- **Personal** needs no membership row. It is keyed by `user_id` and can never be shared.
- **Business** gets new rows. For now there's one business with Luke as **owner** and only member. The roles exist from day one, so adding employees later doesn't change the shape.

### 2.2 Where data lives

Rule: **every stored item belongs to exactly one space.** No item is ever stored in two places, which means there's no copying, no drift and no merge between views.

- **Household:** today's shared state, unchanged in place (decision 1).
- **Personal:** what is only the user's today. That's Mail, News, Recreate (Explore, Exercise, Leisure), Scores favourites, Weather locations, the user's own calendars and private Finance accounts. *Check in code* which `tableplan_states` sections and tables are already per-user and which are per-group; the migration (§8) is mostly re-labelling.
- **Business:** new and empty. Business calendar events are stored under the business space.

Egress rules carry over from IOS_NOTIFICATIONS_DESIGN §2 and the egress lessons:
- Business gets **its own rows and tables**, never extra keys inside existing hot `tableplan_states` rows.
- Don't bump `STATE_SCHEMA_VERSION`.
- No changes to `mergeStates` tombstone semantics.

### 2.3 Layers: how information flows between views

Personal is a **window** onto everything the user belongs to (decision 2):
- Personal's Calendar shows the user's own events **plus** the Household and Business calendars they've switched on, each in that calendar's own colour.
- Personal's Meal Plan **is** Household's meal plan (decision 22): one plan, owned by Household, shown and edited from Personal. There's no separate personal plan.
- These are **live reads, never copies**. A manager's edit to the business schedule shows up in every employee's Personal view at once.

**Who decides (decision 3):** the receiver opts in, one calendar at a time. For example: "Show *Acme schedule* in my Personal calendar." It's stored in the user's own settings:

```js
personalLayers: { "<spaceId>:<calendarId>": { calendar: true } }
```

- Household and Business never show Personal items.
- Personal items leave Personal only when the user shares a specific item. *(Item sharing isn't built in v1; nothing leaves Personal.)*
- Editing a layered event from Personal edits it in its home space, and only if the user's role there allows it.

### 2.4 Specific areas

- **Recipes (decision 4):** there's one recipe box, owned by Household. Personal's Meal Plan reads it. Mail AI recipe intake, the website-photo backfill and Recently deleted all target Household.
- **Finance (decision 5):** each account is assigned to Household or Personal. Joint accounts go in Household and personal accounts in Personal, and Personal can show Household accounts as a layer.
  - Alerts follow the account.
  - SimpleFIN stays one connection per user; only where each account *shows* changes.
  - *Check:* the finance durable store and backups key correctly per space.
- **Google calendars (decision 6):** each linked calendar is assigned to a view.
  - Defaults: calendars shared with the household go to Household, and the user's own primary goes to Personal.
  - Existing linked calendars are assigned once during migration, defaulting to Household (that's where they are today).
  - `gcal_links` gains a `space_id` column.
- **Reminders:** they stay per-user in `live_notification_prefs`, keyed by event id. That already works across views.
- **Watch & Listen (decision 16):** fully shared in Household. That means one watchlist, one queue and **shared play positions**: whoever played last sets where the other resumes (decision 21). Personal keeps Luke's own lists.
- **Tasks (decision 20):** they hang off the Calendar. Household's Calendar holds shared Tasks and Personal holds the user's own. Personal can show Household Tasks as a layer, the same way it shows calendars.
- **Mail AI recipe toggles (decision 23):** they stay in Settings → Mail AI, and Meal Plan settings links to them. Recipes they bring in land in Household's recipe box.

---

## 3. Who sees what

| User | Views | Swipe |
|---|---|---|
| Luke (admin) | Personal, Household, Business | Yes |
| Wife | Household only | No |

- **For now multi-view is admin-only.** It's gated by a server-checked flag, not just hidden UI. Spaces a user isn't a member of are never fetched.
- The wife's app shows the **"Household" band** in the cursive font, with no chevrons and no swiping (decision 12). Her page list is Household's six pages, which covers everything she uses (decision 13).
- **Business is visible to Luke from day one** with an empty Calendar (decision 19).

---

## 4. Switching views

**Order on screen:** Household | Personal | Business, and it's **cyclical**.
- Finger moves **right**: the view to the left slides in (Personal → Household → Business → Personal).
- Finger moves **left**: the opposite direction (decision 8).

**Where swipes count (decision 9):** only on the **view band**. Swipes anywhere else keep their normal meaning:
- card rows scroll as usual;
- iOS's edge-swipe "back" is untouched;
- the page dropdown's accordion is unaffected.

The band is shown:
- on the **landing page**, below the LDE sailboat logo;
- on any **page, while the page dropdown menu is open**, where it replaces that page's own band in the header.

In both places it uses the cursive font of the page-menu tabs and the Meal Plan.

**Fallbacks (decision 10):**
- **‹ ›** chevrons on either side of the view name;
- the **left/right arrow keys** on the laptop, active on the landing page or while the page menu is open.

**Starting view (decision 11):**
- The app reopens in the **last view used**, saved per device in localStorage.
- First launch and new devices open in Personal. The wife always opens in Household.

**Switching:**
- The new view's display settings apply immediately, including its colour scheme. That's the main cue that you've moved.
- Switching from a page lands on that page in the new view if it exists there. Otherwise it lands on the new view's landing page.
- Playback in the dock continues across switches.

**Links, routes and notifications (decision 17):**
- Every route carries its view, e.g. `#household/calendar`, `#personal/news`.
- Old routes without a view (`#calendar`, `#leisure`, notification URLs already scheduled on phones) open in **Personal**, or in the item's own view when the item is known.
- A reminder or link pointing at another view **switches automatically** and opens the item.

---

## 5. Shared chrome

- **The dock** is the same in every view and its contents don't change.
- **The ticker** is the same in every view.
  - In Personal, tapping a game opens the Scores page, as today.
  - In Household and Business, tapping opens a **small game card** (a pop-up with the score and details) and stays in the current view (decision 15). The wife can use it too.
  - *Check:* the ticker's data source must not depend on Personal's Scores page being loaded.

---

## 6. Display settings per view

Display settings are kept **per person, per view**, synced across that person's devices (decision 14):

```js
display: {
  personal:  { scheme, mode: "light"|"dark"|"auto", festive },
  household: { … },
  business:  { … }
}
```

- This is where the Light/Dark/Auto control comes back (SETTINGS_AUDIT §7.3).
- The Display screen is built per view from the start, so festive themes slot in beside the mode.
- Defaults are three clearly different schemes, so the views are distinguishable before anyone customises them.
- The setting is registered in `SETTINGS_REGISTRY` with scope **you**. The registry also gains a `view` column.

---

## 7. Settings

- Settings opens **for the current view**:
  - *Pages* shows that view's pages;
  - *Display* shows that view's scheme;
  - page settings appear only for pages in that view.
- Household and Business settings are shared with members. Only admins/owners can change them.
- The old Household/Personal scope switch (`setAllScopes`, `globalScope`, section scopes) is **retired** (decision 18). Old scope values are read once by the migration (§8), then removed.
- New screens:
  - **Calendar → "Show in my Personal calendar"**: the list of Household and Business calendars with a switch for each (the layer opt-in).
  - **Finance → Accounts**: a view picker per account.
  - **Google Calendar**: a view picker per linked calendar.
  - **Admin → Spaces**: the business name and its members/roles (just Luke for now).

---

## 8. Migration (one time, admin-run)

1. Create Luke's Business space with Luke as owner.
2. Mark the existing household group as the **Household** space. No shared data moves.
3. For each data area, decide whether it's Household or Personal, using today's per-user/per-group split and any old section `scope` values.
   - Show Luke **one confirmation screen** listing what lands where before anything is written.
4. Assign existing Google calendars and Finance accounts. Both default to Household, and Luke can move any to Personal on the same screen.
5. Retire the scope switch.

The migration must be **safe with older clients**. Older TestFlight builds don't know about views. They must keep reading and writing Household data exactly as today, and must never see or overwrite Personal or Business data.
- That means Personal and Business data lives in **new rows/tables** that old clients never load. Existing shared rows stay in place.
- *Check:* any field stripping, like the `calendar/model.js` whitelist or the recipe row column lists. A new field on an existing row is at risk; a new row isn't.

---

## 9. Build order

1. **Spaces + access:** tables, RLS, the admin-only gate, Business space for Luke. One migration (gated, applied via the Supabase MCP after Luke's OK).
2. **View shell:**
   - the band on the landing page and in the open page menu;
   - swipe on the band, chevrons and arrow keys;
   - the cyclical order and remembering the last view;
   - per-view page lists (Household and Business flat);
   - routes with a view prefix and the old-route fallback.
   - At this step all three views still show the same data. It's a UI-only step, so the gestures and the look can be felt early.
3. **Display per view:** the Display screen, three default schemes, and Light/Dark/Auto back.
4. **Data split + migration (§8):** Personal vs Household, the confirmation screen, retiring the scope switch.
5. **Business calendar:** events stored under the business space; it appears in the Calendar's calendar list.
6. **Layers:** Personal Calendar showing opted-in Household/Business calendars and Household Tasks; editing in the home space. Personal's Meal Plan page points at Household's plan.
7. **Per-item assignment:** a view picker for Google calendars and Finance accounts.
8. **Ticker game card** in Household/Business.
9. **TestFlight build** (routes, band and gestures change).

---

## 10. Decisions (Luke, 2026-10-20)

1. Today's shared data **becomes Household**. Personal starts with what was only Luke's.
2. Personal is a **window**: Household/Business show there as live layers, not copies.
3. Flow between views: the **receiver opts in**, per calendar.
4. **One recipe box**, owned by Household.
5. Finance: each account is **assigned to a view**.
6. Google calendars: each is **assigned to a view**.
7. Business: build the members/roles model now, **Luke only**.
8. Swipe: **finger right → Household** (order Household | Personal | Business).
9. Swipes count **on the band only**.
10. Fallbacks: **chevrons** and **arrow keys** (no dots, no tap-to-cycle).
11. Opens in the **last view used**.
12. Wife: **"Household" band, no swipe**.
13. Wife's pages: Household's six are enough.
14. Display: **per person, per view**, synced.
15. Ticker tap outside Personal: **small game card**.
16. Watch & Listen in Household: **fully shared**, including play positions.
17. Links to another view: **switch automatically**.
18. Old scope switch: **retired**.
19. Business: **visible now**, empty Calendar.
20. Tasks: **shared in Household, own in Personal**, with Household Tasks available as a layer in Personal.
21. Watch & Listen play positions: **shared, last played wins**.
22. Meal Plan: **one plan, Household's**, shown and edited from Personal.
23. Mail AI recipe toggles: **stay in Mail AI**, with a link from Meal Plan settings. This closes the SETTINGS_AUDIT open item.
24. Business roles: **decided later**. Keep owner/manager/employee in the data now; define permissions with a security review before the first invite.

## 11. Open

- **Business permissions** (decision 24): what a manager vs an employee can do. Decide before anyone else is invited.
- **Wife's Personal view:** she has none for now. If she gets one later, her current per-user items (reminders, display) carry over without migration.

## 12. Tests

- Unit:
  - the view order and cyclical swipe;
  - route parsing with and without a view prefix;
  - the last-view fallback;
  - per-view page lists;
  - layer filtering (opted-in only; Personal never leaks into Household/Business);
  - display settings resolving per person and view.
- RLS checks (PGlite with stubbed `auth`, as for the notification prefs):
  - a non-member can't read a space;
  - the wife can't read Personal or Business rows;
  - only owners change membership.
- Old-client safety: a simulated older client's save leaves Personal and Business data untouched.
- QA (390px and 360px):
  - swipe on the band from the landing page and from the open page menu;
  - chevrons and arrow keys;
  - swipes elsewhere don't switch views;
  - the wife's account shows only Household;
  - a reminder for a Household event switches views;
  - the ticker card in Household.
- Egress: no view code reads another space's rows. Check the Supabase API logs for 48h after each deploy.

## 13. As built: the view shell (step 2, branch `claude/views-shell`, 2026-10-20)

Every view still shows the same data. Nothing here touches Supabase tables, `mergeStates` semantics or `STATE_SCHEMA_VERSION`.

- **`views.js`** (pure): the order, labels, each view's pages, who has which views, the starting view, the cyclical step, swipe detection, the `view/` route prefix, and per-view display prefs. Unit-tested in `test/views.test.js`.
- **The band** (`index.html` `#homeViewBand`, `#headerViewBand`; styles under "Views: the view band" in `styles.css`):
  - under the landing logo, always shown;
  - in the header while the page menu is open, in place of the page title. Tapping the name closes the menu, as the title did.
  - Swipes count on the band only: a horizontal drag of at least 36 px, clearly more sideways than vertical. Finger right steps left (Personal → Household → Business → Personal).
  - ‹ › chevrons, and the arrow keys on the landing page or with the menu open (never while typing or in a dialog).
  - The name slides out the way the finger went; reduced motion skips it.
- **Pages:** Personal keeps the six groups. Household (Calendar, Meal Plan, Finance, Shop, Watch, Listen) and Business (Calendar) list pages flat (`setFlatPageGroups` in `page-groups.js`). Tasks isn't listed in Household; it's still reached from the Calendar.
- **Switching** lands on the same page when the new view has it, otherwise on the landing page. Opening a page the view doesn't hold (the dock's weather, a link, a reminder) moves the admin to Personal; someone with Household only stays put.
- **Who:** the admin (the server's group role, or local dev) has all three; everyone else has Household only, with the band and no chevrons. Until the role loads, the device's last-known list stands in, so a cold start doesn't flash the wrong view.
- **Last view:** `live-view-v1` on the device (account-scoped, cleared on sign-out). A boot-time guess never overwrites it.
- **Routes:** for the admin, `#household/shop`, `#business`, …; old routes without a view still work. One-view people get no prefix.
- **Display per view:** Personal (or someone's only view) keeps `state.displayPrefs`. The admin's Household and Business looks are `state.viewDisplayPrefs` (`recreate` section, stamped per view in `TRACKED_SETTINGS`), defaulting to the **Household** and **Urban Greens** themes with the person's own mode. Settings › Display edits the view on screen and says which. The iPhone icon follows the primary view only, so switching views never triggers iOS's icon notice.
- **QA:** `npm run qa:views` (62 checks at 390 px and 360 px, including the household-member case); `qa:page-groups` still 47/47; boot check passes; full `npm test`.
- **Not verified:** the iPhone app (touch on WebKit, the band beside the header's buttons on a real phone); the Great Vibes font in the screenshots (the sandbox can't reach Google Fonts, so a serif stood in).
- **Known gap:** an older app build re-saving the `recreate` section drops `viewDisplayPrefs` (it lists that section's keys itself), which resets the Household and Business looks to their defaults. Logged in ISSUES.md.
