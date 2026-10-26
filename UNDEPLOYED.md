# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

- **Calendar: phone month view lists the tapped day under the grid** · #170 · Phone only (≤560px): dots in the grid (max three, tasks as a hollow dot), the selected day listed below, + adds an event, the date opens the day view. Reaches the iPhone with the next TestFlight build; the web app on a phone needs a deploy. Post-deploy: on the phone, open Calendar › Month — today is outlined and listed; tap a busy day and check its events, tap one to open it, try + and the date.
