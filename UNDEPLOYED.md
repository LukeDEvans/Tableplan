# Undeployed changes

Work merged to `main` that is **not live yet**. Merging no longer deploys: a production
build runs only when the merge (or a later commit on `main`) has **`[deploy]`** in its
commit message (`scripts/netlify-ignore.sh`). When you deploy, run
[PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md), do the post-deploy steps below, then
empty this list.

Each entry: what shipped · PR · post-deploy steps.

---

_Last deploy: 2026-10-01 #2 (PRs #28, #33, #34–#40)._

- **On-device voices read far too fast** · PR #41 · On-device voice previews and read-aloud now follow Settings → Voice "Speaking speed"; the iOS plugin maps speed onto Apple's speech-rate scale with a gentle curve instead of the old linear one. Post-deploy: **rebuild the iOS app in Xcode** (the Swift plugin change only ships with a native build), then preview an iPhone voice at 1.0× and 1.5× in Settings → Voice. If the speed is still off, tune the `0.35` exponent in `avSpeechRate()` (`ios/App/App/LiveTtsPlugin.swift`).
- **Bottom dock: there from launch; no dots; circular swipe** · PR #42 · The dock is in the page from first paint instead of appearing after sign-in + the cloud load; the dots pill above it is gone; swiping left/right wraps around the slides (player → weather → player …). Post-deploy: on the iPhone, cold-launch the app and confirm the dock is there immediately; swipe both ways several times (it should keep cycling, short drags spring back, a swipe never opens Media/Weather); tap the bar → Media, tap the weather slide → Weather, swipe the player up → Now-Playing.
- **Bottom dock auto-advances** · PR #43 · Every 8 s the next dock slide slides in from the right (player → weather → …); touching/swiping/hovering the dock holds it for 30 s; paused in the background and while Now-Playing is open. Post-deploy: on the iPhone, leave the app idle on any page and watch the dock rotate; tap play and confirm the bar doesn't slide away for ~30 s.
- **Media removed from the landing page + page menu** · PR #44 · Media is reached from the bottom dock's mini-player (tap the bar); its news-article notification dot moved onto the mini-player's art corner. `#media` still routes. Post-deploy: confirm the home links and the page-title menu no longer list Media, tapping the mini-player opens Media, and a pending news suggestion shows the red dot on the mini-player art.
