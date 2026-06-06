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
