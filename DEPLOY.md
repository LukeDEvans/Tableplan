# Deploy Tableplan

## 1. Require Supabase sign-in

Run `supabase-auth-migration.sql` in the Supabase SQL Editor. This removes anonymous database access and allows signed-in Supabase users to read and save the app state.

## 2. Deploy to Netlify

The project now uses Vite as a build step. You must build before deploying.

```bash
npm install        # first time only
npm run build      # produces dist/
```

Then:

1. Go to https://app.netlify.com/drop
2. Drag the **`dist/`** folder into the Netlify drop area.
3. Open the Netlify site URL after the deploy finishes.

If the Netlify site is connected to the GitHub repo, Netlify will run `npm run build` automatically on each push (configured in `netlify.toml`).

## 3. Add the deployed URL to Supabase Auth

1. In Supabase, go to Authentication > URL Configuration.
2. Set Site URL to your Netlify URL.
3. Add the same URL to Redirect URLs.

## 4. Sign in

Open the deployed app, click Sign in, enter your email, and use the magic link from your email. Use the same sign-in flow on your iPhone.

After your first successful sign-in, disable public signups in Supabase Auth settings if you want only your existing account to use the app.

## 5. Optional weekly review email

The app includes a Netlify Scheduled Function for a weekly Eat email. It will not send until the required environment variables are configured in Netlify.

In Netlify, go to Site configuration > Environment variables and add:

```text
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
```

Optional:

```text
WEEKLY_REVIEW_TO=mrlukedevans@gmail.com
WEEKLY_REVIEW_FROM=Eat <onboarding@resend.dev>
EAT_APP_URL=https://effervescent-malabi-e0af55.netlify.app/
WEEKLY_REVIEW_TRIGGER_SECRET=choose-a-private-test-secret
```

The function is scheduled for Thursdays at 14:00 UTC. One weekly function run is tiny compared with ordinary deploy/build usage.

## 6. Optional recipe photos

Run `supabase-photo-storage.sql` in the Supabase SQL Editor before using recipe photo uploads. This creates the `recipe-photos` Storage bucket and allows only `mrlukedevans@gmail.com` to upload, update, or delete photo objects.
