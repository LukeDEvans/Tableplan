# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Dutch learning build** (LANGUAGE_PRACTICE.md §8–19) · #171 · Add words (paste from Rosetta Stone), spaced-repetition flashcards, Match upgrade (due words, Listen mode), de/het, Listen, Sentences, Speak; new `LiveLanguage` iOS plugin + mic/speech-recognition strings.
  Post-deploy: (1) TestFlight build (`npm run ios:sync`, Xcode) — the plugin and Info.plist need it. (2) On the phone: Leisure › Dutch → Speak: allow the mic and speech prompts, say a word → "Understood"; play your recording; then check a podcast still plays normally. (3) On the laptop: paste a Rosetta Stone lesson in Add words; check it appears first and on the phone after a refresh. (4) Supabase API logs (`service: api`) 48h: the personal `recreate` row is written once per practice round, not per tap.
