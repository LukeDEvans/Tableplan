# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Listen: one queue and player per person** · #237 · LISTEN_QUEUE_DESIGN.md. Positions, played marks and queue edits move to the person's own `u-<uid>:listen` row; the queue fills from the home library (Personal for Luke). Needs a **TestFlight build** too.
  Post-deploy: reload every open web tab (an old tab keeps writing positions to the media rows). In the API logs, look for one `tableplan_states?id=in.(…:media,…:media)&select=id,podcastProgress:state->…` read per device and a new `u-<uid>:listen` row for Luke and for Marijane. On the phone, start an episode in Personal, switch to Household and let it finish: it should be gone from the queue in both views.
