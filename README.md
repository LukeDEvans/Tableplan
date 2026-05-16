# Eat

Eat is a personal recipe box, weekly meal plan, grocery list, pantry tracker, and recipe import tool.

The app is intentionally lightweight: it is mostly static HTML/CSS/JavaScript, with a small local Node helper for imports and Mac backups, Supabase for cloud sync, Netlify for the live app, and a Chrome extension for toolbar imports.

## Current URLs

- Live app: https://effervescent-malabi-e0af55.netlify.app/
- Local app: http://localhost:4174/index.html
- GitHub repo: https://github.com/LukeDEvans/Tableplan

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
/Users/luke/Desktop/Eat
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

Choose a backup JSON from `/Users/luke/Desktop/Eat`. The current restore mode is intentionally conservative: it previews the backup and merges missing recipes only. It does not replace current data.

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

The app uses Google sign-in. Apple sign-in UI exists, but Apple auth is not functional until an Apple Developer subscription is available.

## Recipe Import

Imports can happen through:

- the in-app import dialog
- the Chrome toolbar extension
- local helper import endpoint
- Netlify function import endpoint

The extension can target Live or Local. Local import is useful for testing without deploying to Netlify.

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
- Several days of backups exist in `/Users/luke/Desktop/Eat`.
