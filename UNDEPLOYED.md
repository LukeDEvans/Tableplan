# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Finance: moving accounts between Household and Personal (step 3)** · #232 · **needs a Netlify
  deploy to do anything** (the server action; the app's screen stays hidden until the server
  answers that it can move accounts). The database guard is already applied (2026-11-12).
  **In the deploy commit:** set `STATE_SCHEMA_VERSION` to 8 (held at 7 until then, see the note
  at the constant), and set `FINANCE_MOVE_ENABLED=1` in Netlify first; make a TestFlight build
  from the same commit for both phones. Post-deploy: Household › Finance › Accounts shows
  "Personal accounts" for Luke only; tick an account, **Review the move**, read the report, and
  confirm only if it looks right (FINANCE_SPLIT_DESIGN.md §8.6 has the checks to run after).
- **News: newspaper sign-in hints no longer suggest Apple** · #231 · **TestFlight build**
  (text only; the laptop needs a Netlify deploy). Sync Settings, the reader and the sign-in sheet
  say to use email and password, not Apple or Google. Post-TestFlight: none.
- **Sign-in: authenticator code and Face ID to open the iPhone app** · #222 · **TestFlight build**
  for the phone (web code only, no Swift change); **the laptop needs a Netlify deploy**. Settings ›
  Sign-in → Authenticator code: set up once (Add to Passwords on iPhone/Mac, or scan the QR); after
  that a new sign-in on any device stops at "One more step" until the 6-digit code is entered. Face
  ID to open the iPhone app is per phone and **on by default** (asks on open and after 5 minutes
  away; falls back to the phone's passcode; a phone with no passcode isn't locked; switch in
  Settings › Sign-in). A failed Google/Apple sign-in on the website now says why. Luke OK'd the
  merge 2026-11-11. Not yet run against real Supabase or on a phone. Still open (ISSUES.md): the
  code is enforced by the app, not the database (migration held for Luke); Google/Apple providers
  need a look in Supabase. No migration, no env vars. Post-TestFlight: open the app (Face ID
  asks); leave 5+ minutes and come back; Settings › Sign-in → set up the code, sign out, sign in
  (the code step appears; a wrong code shows a message). Marijane's phone will ask for Face ID too.
