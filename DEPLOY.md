# Deploy Tableplan

## 1. Require Supabase sign-in

Run `supabase-auth-migration.sql` in the Supabase SQL Editor. This removes anonymous database access and allows signed-in Supabase users to read and save the app state.

## 2. Deploy to Netlify

1. Go to https://app.netlify.com/drop
2. Drag this project folder into the Netlify drop area.
3. Open the Netlify site URL after the deploy finishes.

Netlify will serve `index.html`, `styles.css`, `app.js`, and `supabase-config.js`. The local helper files are blocked by `netlify.toml`.

## 3. Add the deployed URL to Supabase Auth

1. In Supabase, go to Authentication > URL Configuration.
2. Set Site URL to your Netlify URL.
3. Add the same URL to Redirect URLs.

## 4. Sign in

Open the deployed app, click Sign in, enter your email, and use the magic link from your email. Use the same sign-in flow on your iPhone.

After your first successful sign-in, disable public signups in Supabase Auth settings if you want only your existing account to use the app.
