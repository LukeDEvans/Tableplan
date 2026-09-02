# QA_ACCOUNT_SWITCH.md — Cross-account boundary verification

Manual two-account browser procedure that verifies an authenticated account
switch never carries one account's data into another. Run it after any change to
the sign-out / sign-in / hydration / state-reset path.

**Fix under test:** commits `86b2b18` + `3938414` — authenticated sign-out now
clears the account-scoped local boundary (localStorage + `live-music` IndexedDB),
cancels any pending write, and reloads, so a subsequent sign-in starts clean.
See [auth-account-reset.js](auth-account-reset.js) and `toggleAuth` in `app.js`.

---

## What this manual test covers that the automated tests do NOT

| Automated (green, in `npx vitest run`) | This manual test |
|---|---|
| `finance-sync.test.js` — the pure merge / boot-empty / tombstone logic in isolation | The **real auth lifecycle**: `onAuthStateChange` → `verifyOtp` → in-place re-hydration → the actual `window.location.reload()` |
| `auth-account-reset.test.js` — `clearLocalAccountState` removes the listed keys; **contract test** that every app.js localStorage key is classified | The **real browser stores**: that localStorage *and* IndexedDB (`live-music`) are actually gone after sign-out on a real device |
| — | The **real Supabase rows**: that B's cloud sections contain zero A-records, and A's cloud survives round-trip |
| — | **Timing/debounce**, the reload actually firing, and the end-to-end "**B sees none of A's data**" outcome |

The unit/contract tests prove the *pieces* are correct; this test proves the
*assembled system* upholds the invariant against live accounts and a live
database. Only this test can catch an integration-level miss (a store the code
never releases, or the reload not firing).

## Prerequisites

- **Two real invited accounts**, A and B (sign-in is invite-only; both must
  already exist). Two email inboxes you can read OTP codes from.
- One browser, **one tab**, normal (non-incognito) profile — the vulnerable path
  is same-tab, no manual reload.
- DevTools open (Application ▸ Local Storage + IndexedDB; Console; Network).
- **Cloud inspection**, one of:
  - **(Authoritative)** Supabase SQL editor on `tableplan_states`, or
  - **(No-DB)** a second device / different browser profile to sign in as B/A
    cleanly (fresh, no local mirror) — the cloud is whatever a fresh device sees
    after hydrate.
- A note of A's `group_id` and B's `group_id` if you'll use SQL (the state row
  `id` = `<group_id>:<section>`).

## Marker setup (do this as Account A first)

Create data with a **greppable unique prefix** so one search finds any leak. Sign
in as A, then add:

| Domain | Create (Account A) | Why this domain |
|---|---|---|
| **Finance** | A budget group named `ZZZ-A-BUDGET` with one category `ZZZ-A-CAT` | The original P0; finance is cloud-only (mirror strips it) — the highest-risk path |
| **Finance (authoritative key)** *(optional, needs transactions)* | Rename a merchant or label a txn to `ZZZ-A-LABEL` | Exercises `FINANCE_LOCAL_AUTHORITATIVE_KEYS`, which the boot-empty guard intentionally *skips* — pre-fix this leaked even with the guard |
| **Tasks** | A to-do `ZZZ-A-TASK` | Ordinary synced section |
| **Meal plan** | A recipe `ZZZ-A-RECIPE`, placed in a meal slot | Deep-merged section |
| **Media** | Save an article/note titled `ZZZ-A-ARTICLE` | Also exercises the content-store path |
| **Travel** | A trip `ZZZ-A-TRIP` | Specifically re-tests the `tableplan-trips-v1` backup vector |
| **Music** *(review-hardening check)* | Upload one local audio file, note its title `ZZZ-A-SONG` | Verifies the `live-music` IndexedDB purge |
| **Home AI briefing** *(review-hardening check, if reachable)* | Generate today's home AI briefing | Verifies the `briefing_ai_<date>` prefix sweep |

After creating each, **wait ~5 seconds** (let the debounced sync push) and confirm
no Network errors. In DevTools ▸ Application, confirm `tableplan-state-v1` and
`tableplan-trips-v1` exist under Local Storage, and `live-music` exists under
IndexedDB.

## Core procedure

- [ ] **Step 1 — Baseline A (cloud landed).** Still as A, reload once manually and
      confirm all `ZZZ-A-*` markers reappear (proves they're in A's cloud, not
      just local).

- [ ] **Step 2 — Sign out of A.** Profile ▸ **Log Out** (or the auth button).
  - **Expected (after fix):** the page **reloads** and lands on the lock gate
    ("This is a private app. Sign in to continue.").
  - In DevTools ▸ Application immediately after: `tableplan-state-v1`,
    `tableplan-trips-v1`, `eat-calendars-v1`, `live-section-scopes-v1`,
    `live-shadow-sections-v1`, `live-chat-history`, `live_watch_search_scope`,
    `live-explore-last-trip`, `live-travel-mode-trip`, and any `briefing_ai_*`
    are **gone**; `live-music` IndexedDB is **deleted**. Device-neutral keys
    (`live_local_dev`, `live_push_subscribed`, `live-playback-speed-v1`,
    `cadence-view-mode/zoom`) **remain**.

- [ ] **Step 3 — Sign in as B via OTP, same tab, NO manual reload.** Click the
      gate's Sign-in button → enter **B's** email → **Send code** → paste B's OTP
      → **Verify code**. Let hydration finish (the "Syncing…" cover clears).

- [ ] **Step 4 — Inspect B's in-memory/UI state.** Search each domain's UI for
      `ZZZ-A-`:
  - **Expected (after fix):** **zero** `ZZZ-A-*` markers anywhere — no A budget
    group, task, recipe, article, trip, song, or briefing. B sees only B's data.
  - Console: run `JSON.stringify(Object.values(localStorage)).includes("ZZZ-A-")`
    → **expect `false`**.

- [ ] **Step 5 — Verify B's CLOUD is uncontaminated.** Push has fired for B by now
      (make one trivial B edit, e.g. add task `ZZZ-B-TASK`, wait ~5s). Then:
  - **SQL method:**
    `select id from tableplan_states where id like '<B_group_id>:%' and state::text like '%ZZZ-A-%';`
    → **expect 0 rows.** (And `... like '%ZZZ-B-%'` → expect ≥1, proving B's own
    writes work.)
  - **No-DB method:** on the **second device**, sign in as B → **expect no
    `ZZZ-A-*`**, and `ZZZ-B-TASK` present.

- [ ] **Step 6 — Round-trip back to A.** Sign out of B (page reloads → gate) →
      sign in as **A** via OTP.
  - **Expected:** all `ZZZ-A-*` markers intact; **no `ZZZ-B-*`** anywhere in A's
    UI.
  - **SQL:**
    `... where id like '<A_group_id>:%' and state::text like '%ZZZ-B-%';`
    → **expect 0 rows**; `%ZZZ-A-%` → still present. Confirms the fix is
    bidirectional and A's data was never damaged.

## Step 7 — Pending-write / debounce sub-test

Checks that an **unsynced** A edit at sign-out time cannot ride into B.

- [ ] Sign in as A. Make a distinctive edit — add task `ZZZ-A-PENDING`.
- [ ] **Within ~1 second, before it syncs** (watch Network — no PATCH to
      `tableplan_states` yet), immediately click **Log Out**.
- [ ] Sign in as B (OTP, same tab).
  - **Expected (after fix):** `ZZZ-A-PENDING` appears **nowhere** in B (UI,
    localStorage, or B's cloud rows). The fix `clearTimeout`s the debounce and
    clears the mirror before reload.
  - **Also expected / accepted trade-off:** `ZZZ-A-PENDING` may be **absent from
    A's cloud too** (an unsynced local edit is discarded on sign-out — the
    accepted "sign-out drops local offline data" behavior). Confirm by signing
    back into A: the *pre-existing* `ZZZ-A-*` markers are intact; only the last
    unsynced edit made in the debounce window is gone. **Not a defect** — the
    point of this sub-test is that it did **not** leak to B.

> Note: if the debounce already *fired* (a PATCH is mid-flight) when you sign out,
> that write lands in **A's** rows (`stateId` is still A's until reload) — also
> correct.

## Expected results — before vs after the fix

| Check | **Before fix** (buggy) | **After fix** (`86b2b18`+`3938414`) |
|---|---|---|
| Step 2 sign-out | No reload; localStorage/IndexedDB retain A's data | Reload; account-scoped local stores cleared |
| Step 4 B's UI | Shows A's budget/tasks/recipe/article/trip merged in | **No `ZZZ-A-*`** anywhere |
| Step 4 music/briefing | B's library lists `ZZZ-A-SONG`; B's home shows A's briefing | Neither present |
| Step 5 B's cloud rows | Contain `ZZZ-A-*` records | **0 rows** matching `ZZZ-A-` |
| Step 6 back to A | A intact **but** now also polluted with `ZZZ-B-*` | A intact; **no `ZZZ-B-*`** |
| Step 7 pending edit | `ZZZ-A-PENDING` can appear in B | Absent from B (and discarded from A) |

## Pass criteria

**PASS** iff: Step 2 reload + local stores cleared; Steps 4–5 show zero `ZZZ-A-`
in B's UI, localStorage, and cloud; Step 6 shows A intact with zero `ZZZ-B-`;
Step 7 shows no leak of the pending edit. Any `ZZZ-A-` marker surfacing in B (UI
or cloud) is a **FAIL**.

## Known limitation this test does NOT cover

**Multi-tab** — leave a second tab open as A during the switch and the leak can
still occur (the reload only affects the tab that signed out). That is a separate,
still-open scoped follow-up, out of scope for the fix under test here. To confirm
it is *unchanged* (not worsened): the single-tab procedure above must still PASS;
a separate two-tab repro is its own task.
