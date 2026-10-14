# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-13 (Google Calendar Phase 1, reminders, share-sheet receipts)._

- **Share sheet: Amazon order-summary PDFs → Finance** · PR #97 · "Live" now appears in the share sheet for a PDF (Amazon → order → Order Summary → Save). The extension reads the PDF's text on the phone (PDFKit) and sends it; a scanned PDF goes as page images. The server reads summary text with an invoice-specific prompt and a 40,000-character limit. **The TestFlight build adds the PDF option and already works against the live server; this deploy only improves the read** (summary prompt, longer text). Verified: server tests, full suite, the iOS compile check. **After TestFlight (+ deploy):** in Amazon open an order → Order Summary → Save → Live; check "Added to Finance" with the right total, then Finance → Insights → Receipts shows the items. If Live isn't in that sheet, Amazon shared a link: use Print → pinch out on the preview → Share → Live, and tell Claude which one it was.

- **Reminders switch you can actually find** · PR #99 · The "Reminders on this iPhone" switch was only in a Settings dialog the phone can't reach. It's now at gear → Settings → **Notifications** (and in the calendar's Add Calendar window). In a browser it shows the browser's notification permission. Client-only: **a TestFlight build is enough**, no deploy needed. Verified: `scripts/qa-reminders.mjs` (24/24, including gear → Settings → Notifications), full suite, boot check. **After TestFlight:** gear → Settings → Notifications → Turn on.

- **Profile redesign + Home + diet & allergies + photo** · PR #100 · Profile opens read-only with a small Edit button (About, Food, Household, Account). Home is a city search; the picked city becomes Weather's "Home" place (first, and the fallback when the phone's location isn't available) and store/restaurant search use it when location is off. Per-person diets/allergies (`state.memberDiets`, eat section) show a heads-up on conflicting recipes and go to the assistant. Profile photo: 256px JPEG in the public `avatars` bucket, version in auth metadata, cached per device. **Migration applied 2026-10-14** (`migrations/2026-10-13-profile-avatars.sql`: bucket + 4 own-folder policies, verified). Verified: `scripts/qa-profile.mjs` 47 checks (light + dark, 360px), full suite, boot check. Not verified: real photo upload, iPhone photo picker/HEIC, the recipe heads-up in a browser. **Client-only, so TestFlight or a deploy both work; ship both phones on the new build soon** — older builds drop `memberDiets` when they save the eat section (own entries are restored from auth metadata; a child's are not). **After deploy/TestFlight:** add a photo and check it on the other device; set Home and check Weather shows "Home"; set an allergy and open a recipe with that ingredient.
