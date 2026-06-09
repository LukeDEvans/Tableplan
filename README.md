# Eat

Eat is a personal recipe box, weekly meal plan, grocery list, and recipe import tool.

The app is intentionally lightweight: it is mostly static HTML/CSS/JavaScript, with a small local Node helper for imports and Mac backups, Supabase for cloud sync, Netlify for the live app, and a Chrome extension for toolbar imports.

## Current URLs

- Live app: https://effervescent-malabi-e0af55.netlify.app/
- Local app: http://localhost:4174/index.html
- GitHub repo: https://github.com/LukeDEvans/Tableplan

## Local Folder Layout

The convenient local home for Eat is:

```text
/Users/luke/Desktop/Eat
```

It is organized as:

```text
/Users/luke/Desktop/Eat/Project Files
/Users/luke/Desktop/Eat/Backups
/Users/luke/Desktop/Eat/Previous Project Copies
```

Use `Project Files` for the app code, Git repo, SQL files, Chrome extension, and docs. It is a shortcut to the active Codex project folder, so there is still one true project. Use `Backups` for rotating local JSON backups. `Previous Project Copies` holds older Desktop copies kept only as a rollback cushion.

## Main Files

- `index.html` - app markup and dialogs.
- `styles.css` - app styling, including system light/dark mode.
- `app.js` - main browser app logic.
- `server.js` - local helper for localhost, recipe import, local state, and rotating backups.
- `supabase-config.js` - Supabase URL, anon key, and state id.
- `netlify/functions/import-recipe.js` - live import helper for Netlify.
- `netlify/functions/us-holidays.js` - live helper for the public U.S. Holidays calendar.
- `deploy/` - deploy-ready copy used for Netlify.
- `chrome-extension/` - Chrome toolbar extension for importing recipes into Eat.
- `supabase-*.sql` - Supabase setup/migration SQL files.
- `data/tableplan-state.json` - local helper state snapshot.

## How To Run Locally

From this project folder:

```sh
cd "/Users/luke/Desktop/Eat/Project Files"
node server.js
```

Then open:

```text
http://localhost:4174/index.html
```

The local helper must be running for:

- local recipe URL imports
- automatic Mac backups
- Backup Health

## Backups

Localhost writes rotating JSON backups to:

```text
/Users/luke/Desktop/Eat/Backups
```

The helper keeps the 5 newest `eat-backup-*.json` files. New backups include a checksum. In the app, use:

```text
Settings -> Backup Health
```

to confirm the latest backup is readable.

## Restore

Use:

```text
Settings -> Restore Backup
```

Choose a backup JSON from `/Users/luke/Desktop/Eat/Backups`. The current restore mode is intentionally conservative: it previews the backup and merges missing recipes only. It does not replace current data.

## Trash

Recipe deletion is soft-delete by default:

- deleting a recipe moves it to Trash
- Trash is available under Settings
- recipes can be restored or permanently deleted
- trashed recipes are excluded from the Recipe Box, Meal Plan, groceries, and auto-generate

Permanent deletion and other risky actions try to create a local pre-change backup first when running on localhost.

## Cloud Sync

Supabase is the main cloud data store. The app currently stores:

- recipes as Supabase rows
- folders as Supabase rows
- broader app state such as plans, settings, recipe tags, trash, and backup-related state in shared state JSON

Before treating the live app as private, run:

```text
supabase-privacy-rls-hardening.sql
```

That migration removes anonymous table access and restricts the app tables to `mrlukedevans@gmail.com` through Supabase Row Level Security.

Recipe rows include `tags`, `nutrition`, and `cook_log` JSON columns. If setting up a new Supabase project, run the recipe metadata migration:

```sql
alter table public.eat_recipes
add column if not exists tags jsonb not null default '[]'::jsonb;

alter table public.eat_recipes
add column if not exists nutrition jsonb not null default '[]'::jsonb;

alter table public.eat_recipes
add column if not exists cook_log jsonb not null default '[]'::jsonb;

alter table public.eat_recipes
add column if not exists prep_time text not null default '';

alter table public.eat_recipes
add column if not exists cook_time text not null default '';
```

Recipe photos use Supabase Storage. Run this SQL once before uploading photos:

```text
supabase-photo-storage.sql
```

Photos are resized in the browser before upload and stored in the `recipe-photos` bucket. Recipe rows keep only the resulting photo URL.

The app uses Google sign-in. Apple sign-in UI exists, but Apple auth is not functional until an Apple Developer subscription is available.

## Recipe Import

Imports can happen through:

- the in-app import dialog
- the Chrome toolbar extension
- local helper import endpoint
- Netlify function import endpoint

The extension can target Live or Local. Local import is useful for testing without deploying to Netlify.

## Google Store Locations

Grocery List settings can search Google Places for a specific grocery store location. Linked stores save their Google Place ID, address, and location details and include a Directions button that opens Google Maps.

Each store also has an ordered layout under `Settings -> Grocery List -> right-click store -> Edit`. New stores begin with Produce, Bakery, Deli, Dairy, Dry Goods, Frozen, Household, and Other. Grocery items use broad category matching until they are manually dragged into a store section. That correction is then remembered for the normalized item at that specific store. Store layouts and learned placements are included in synced state and JSON backups.

Grocery generation matches with a canonical item name while displaying a friendly catalog name. It merges capitalization, punctuation, simple singular/plural differences, comma ordering, preparation wording, and common synonyms such as chickpeas/garbanzo beans and scallions/green onions. Compatible quantities are added; incompatible units remain together as a readable sum. Right-click a generated grocery item to teach a merge or preserve a distinct product, and right-click a Grocery Items catalog entry to manage aliases or its matching preference. These learned choices are synced and included in backups.

## Family Food Health

Eat includes a date-based Food Health dashboard for Luke, Marijane, and Sophia. One food-log entry feeds both estimated daily nutrition totals and the selected health checklist. Foods can come from recipes, grocery items, manual entries, or leftovers and can be logged as a full, half, or custom serving. Recipe nutrition is copied into an immutable snapshot when logged, so editing a recipe later does not silently rewrite prior days; a logged recipe can be recalculated manually when desired.

The built-in Daily Dozen template is inspired by Dr. Greger's Daily Dozen / NutritionFacts.org and is presented as a personal tracker, not medical advice. Recipe pages can suggest possible categories from tagged ingredients, but uncertain servings are never finalized without confirmation. Right-click a Grocery Items catalog entry or generated grocery item and choose `Daily Dozen tags` to attach one or more categories with confidence and notes.

`Settings -> Food Health Settings` selects a checklist per family member, enables or hides items, changes targets, and optionally adds personal estimated-nutrition targets. Sophia has no adult nutrition targets by default. The 21 Tweaks and Maximally LDL-Lowering templates are deliberately empty placeholders until their exact items are reviewed; the app does not invent or auto-fill those checklists. Custom checklist items can be added directly in settings.

Food logs, nutrition snapshots, generic checklist entries, per-person settings, legacy Daily Dozen progress, and grocery tag corrections are stored in shared state and included in JSON backup restore.

## Meal Plan Servings

Serving counts have three separate meanings:

- A recipe's `defaultServings` is its saved yield and is not changed by planning or food logging.
- A meal-plan recipe entry stores `plannedServings`, which defaults to the recipe yield and describes how much will be cooked for that occurrence.
- A Food Health log stores the serving multiplier actually eaten by each person.

Changing planned servings scales that meal-plan entry's ingredients by `plannedServings / defaultServings`. Grocery generation and estimated meal-plan nutrition use the scaled amount. Older meal plans that stored only a recipe ID remain compatible and use the recipe's default yield until a planned serving count is saved.

## Receipts And Price History

`Settings -> Receipts & Price History` scans grocery receipt photos through the existing server-side OpenAI image flow. OCR results always open as an editable draft before saving. The review includes store, purchase date, subtotal, discounts, tax, fees, total, raw receipt text, corrected item name, category, quantity, unit, line price, discount, and OCR confidence.

Corrected item names and categories become mappings for similar raw receipt text in future scans. Saving creates receipt-derived price history records per item, store, and date. Grocery estimates use only those historical records and explicit manual estimates; the interface labels them as past-receipt estimates rather than live prices.

Receipt scanning uses `OPENAI_API_KEY`, the same server-side secret used by cookbook scanning. For localhost, start the helper from a shell where that variable is available. For Netlify, keep it in the site environment variables; never place it in browser code or `supabase-config.js`.

Nutrition estimation uses USDA FoodData Central. Add this server-side environment variable to the shell running localhost and to Netlify:

```text
USDA_FDC_API_KEY
```

Get a FoodData Central API key from the USDA and keep it out of browser code and `supabase-config.js`. Run `supabase-nutrition-estimates.sql` in Supabase so structured estimates and ingredient matches are retained in recipe rows. Saved ingredient corrections are also kept in shared state and backups. The estimates are informational recipe calculations, not medical guidance, and the app labels them as estimates.

The provider boundary is intentionally separate so an optional Edamam Nutrition Analysis adapter can be added later without changing the recipe UI or stored estimate model.

When price routing is enabled, the grocery list compares complete store combinations. It minimizes the estimated merchandise total plus a configurable cost for each additional store, rather than sending every item to its individually cheapest store. Explicit store assignments still take priority. Receipt records, learned mappings, history, and pricing settings are included in synced state and JSON backup restore.

Until a current price or remembered store exists, an item is assigned to the first store in Grocery List settings. Reorder stores to change that default. Dragging an item to another store remembers the correction for future lists.

## State History

Run `supabase-state-history.sql` once in the Supabase SQL editor. It creates an append-only history table and stores the previous account state before every cloud update, retaining the 100 newest versions. This protects meal plans, Auto-Fill Rules, tasks, calendars, grocery settings, and other account-wide data from an accidental whole-state overwrite.

Localhost also writes a protected safety snapshot before replacing meaningful browser data with a different shared state. Protected snapshots use the `eat-safety-*.json` filename and are retained separately from the five rotating everyday backups. Identical snapshots are deduplicated.

General Settings includes a `Use location` preference. Enabling it requests browser location permission once and limits store searches to 50 km around the device location. The coordinates are held only in the current browser session and are not saved in Supabase or backups; only the on/off preference is saved.

Enable `Places API (New)` in the Google Cloud project, then add this Netlify environment variable:

```text
GOOGLE_MAPS_API_KEY
```

For compatibility, the app also accepts the Netlify variable name:

```text
Google_Maps
```

The existing `SUPABASE_SERVICE_ROLE_KEY` is also used by the Netlify function to verify the signed-in user before making Google Places requests. Store search is restricted to:

```text
mrlukedevans@gmail.com
```

That can be overridden with:

```text
GOOGLE_PLACES_ALLOWED_EMAIL
```

Localhost uses the protected Netlify function with the current Supabase sign-in, so the Google key does not need to be stored on the Mac. The local helper also accepts `GOOGLE_MAPS_API_KEY` or `Google_Maps` if a fully local Places request is needed later.

Restrict the Google key to `Places API (New)` and set a conservative daily quota in Google Cloud. The key stays in the local helper or Netlify environment and is never written into browser code.

## Meal Plan Auto Rules

Auto Rules live under:

```text
Settings -> Auto Rules
```

They are shown in a meal-plan-like grid. A slot can be blank, set to a specific recipe, set to a folder, or set to `Do not fill`.

Folder rules can include child folders.

Recipes tagged `protected` are excluded from auto-generate, including exact recipe Auto Rules suggestions and fills.

## Recipe Tags

```text
Settings -> Tags
```

Recipe tags are managed in Settings and assigned inside the recipe editor. The built-in `protected` tag cannot be deleted.

## Active Cooking

Clean recipe view has a `Let's cook!` button. It adds a cooking thumbnail below the date range, closes the recipe window, and starts a timer from the recipe time. Clicking the thumbnail opens the active recipe view, which pins the selected serving count, labels each instruction as Step 1, Step 2, and so on, and marks a step complete when the step text is clicked or tapped. Ingredients and Instructions can collapse independently.

When an active recipe is marked done, Eat asks whether to log that cook. Choosing yes adds an entry to that recipe's Log & Notes with the date cooked, serving count, elapsed cooking time, and any notes typed during that cook. Choosing no stops the timer without adding a log entry.

The edit recipe window also includes Log & Notes, where entries can be added, removed, or adjusted after cooking.

Recipes now track prep time and cook time separately. Older recipes with only a single time value keep that value as the prep time until edited.

## Weekly Email Review

Netlify includes a scheduled function at:

```text
netlify/functions/weekly-review.js
```

It is scheduled for Thursdays at 14:00 UTC, which is Thursday morning in Central time. The email summarizes the week in review, active cooks or cook logs that may need notes, and whether the upcoming Friday-to-Friday meal plan is published.

Required Netlify environment variables:

```text
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
```

Optional Netlify environment variables:

```text
SUPABASE_URL
WEEKLY_REVIEW_TO
WEEKLY_REVIEW_FROM
EAT_APP_URL
WEEKLY_REVIEW_TRIGGER_SECRET
```

The function will skip sending if required keys are missing. Manual URL testing requires `WEEKLY_REVIEW_TRIGGER_SECRET`; scheduled Netlify runs do not.

The email layout can be adjusted in the app:

```text
Settings -> Weekly Email
```

That editor saves the subject prefix, intro line, closing note, and which weekly sections are included. The text supports `{reviewRange}`, `{upcomingRange}`, and `{appUrl}` placeholders.

## Holidays

Meal Plan can show U.S. holidays beside the date. Localhost uses `/api/holidays`; Netlify uses `/.netlify/functions/us-holidays`. Holiday results are cached in the browser for display, and the helper endpoint can cache live responses through normal HTTP caching.

## Deployment Notes

Netlify is connected to GitHub. To avoid using Netlify build/deploy credits unnecessarily, test locally first and push only when ready.

## Mobile Scanning

Cookbook recipes and receipts can use either the phone's rear camera or normal image upload. Both flows accept multiple images and provide previews with rotate, edge-trim, remove, and client-side compression controls before OCR.

The web app intentionally stops short of recreating a full document scanner. If Live later becomes a native iOS app, use Apple VisionKit `VNDocumentCameraViewController` for automatic edge detection, perspective correction, and multi-page document scanning.

Before pushing, sync deploy files if needed:

```sh
cp app.js deploy/app.js
cp styles.css deploy/styles.css
cp index.html deploy/index.html
```

Then commit and push through Git.

## Safety Checklist Before Deleting Old Recipe Sources

Do not treat Eat as the only archive until these are true:

- `supabase-privacy-rls-hardening.sql` has been run successfully in Supabase.
- Backup Health shows the latest backup is readable.
- Restore Backup has been tested with a backup file.
- Recipes added from live app, localhost, iPhone, and Chrome extension all appear in the same Recipe Box.
- Several days of backups exist in `/Users/luke/Desktop/Eat/Backups`.
