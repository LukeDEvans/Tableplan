# Native iOS app (Capacitor) — Stage 0 runbook

Goal of Stage 0: get the **existing web app** booting inside a native iOS shell on
your iPhone. Nothing native-audio yet — this just proves the foundation and
surfaces the wiring issues we tackle in Stage 1. It does **not** change the web
app or its Netlify deploy; Capacitor is entirely additive.

The web assets are **bundled into the app** (your choice), so the app works
offline and frontend updates ship via an Xcode/TestFlight build — no Netlify
deploy needed for the app itself.

---

## What I already added (in the repo)
- `capacitor.config.json` — `appId: com.mrlukedevans.live`, `appName: "Live"`,
  `webDir: "dist"` (your Vite build output). **Change `appId`** if you want a
  different bundle identifier; it must match what you set in Xcode + register as
  an App ID in the Apple Developer portal.
- `native-bridge.js` — the seam for later stages. In a browser it's inert; in the
  native app `isNativeApp()` is true. Already used to **skip the service worker in
  the native shell** (a SW there fights Capacitor's asset serving and can stop the
  app booting).
- `package.json` scripts: `npm run ios:sync` (build web + copy into iOS) and
  `npm run ios:open` (open Xcode).
- `.gitignore` entries for the generated `ios/` build artifacts.

---

## Prerequisites (one-time, on your Mac)
1. **Xcode** — install from the Mac App Store, open it once to finish setup.
2. **Xcode command-line tools:** `xcode-select --install`
3. **CocoaPods** (Capacitor uses it for iOS): `brew install cocoapods`
   (or `sudo gem install cocoapods`).
4. Your **Apple Developer account** signed into Xcode:
   Xcode → Settings → Accounts → **+** → Apple ID.

## Steps
Run these from the project root (`please-ask-questions-if-i-should`):

```bash
# 1. Install Capacitor (adds the deps to package.json)
npm install @capacitor/core @capacitor/cli @capacitor/ios

# 2. Generate the native iOS project (reads capacitor.config.json)
npx cap add ios

# 3. Build the web app and copy it into the iOS project
npm run ios:sync

# 4. Open the project in Xcode
npm run ios:open
```

Then **in Xcode**:
1. Select the **App** target → **Signing & Capabilities** tab.
2. Set **Team** to your Apple Developer account, and confirm the **Bundle
   Identifier** matches `com.mrlukedevans.live` (or your chosen appId).
3. Plug in your iPhone, select it as the run destination (top bar).
4. Press **▶ (Run / ⌘R)**.
5. First run on the phone: **Settings → General → VPN & Device Management →**
   trust your developer certificate, then reopen the app.

## What to check (and report back)
- ✅ Does the app **boot and render**? Can you navigate the tabs?
- ⚠️ **Sign-in / Supabase:** does logging in work? (Auth redirects in a webview
  can misbehave — a Stage 1 item.)
- ⚠️ **Data loads:** do Finance / Mail / Media pull their data? (These call your
  Netlify functions cross-origin — CORS from the `capacitor://localhost` origin is
  a Stage 1 item.)
- ⚠️ **Gmail specifically will likely fail to authorize** — Google blocks OAuth in
  embedded webviews; moving it to a native auth flow is a planned Stage 1 task.

Tell me exactly what works and what doesn't, and I'll write the Stage 1 fixes
(CORS, auth flow, any SW/asset issues).

---

## After a code change (the update loop)
```bash
npm run ios:sync   # rebuild web + copy into iOS
# then Run again in Xcode (or `npm run ios:open`)
```
No Netlify deploy is involved for the native app.

## TestFlight from GitHub Actions (no Mac needed, works from a phone)

`.github/workflows/ios-testflight.yml` builds the app on a GitHub-hosted Mac and
uploads it to TestFlight. It runs the tests, `npm run ios:sync`, then archives,
signs and uploads. Signing is automatic via an App Store Connect API key (Apple's
cloud-managed certificate), so nothing is exported from a Mac. The build number
is a UTC timestamp (e.g. `20260928.1845`), so it always increases.
`.github/workflows/ios-compile.yml` compiles the app unsigned on every PR/push
that touches native code (`ios/**`, `native-bridge.js`, Capacitor config,
package files), so a Swift error shows up on the PR.

### One-time setup (all doable in a phone browser)
1. **Create the API key.** appstoreconnect.apple.com → Users and Access →
   Integrations → App Store Connect API → Team Keys → **+**.
   - Name it e.g. "GitHub TestFlight".
   - Access: **Admin**. Cloud-managed signing needs Admin; App Manager can
     upload but can't create the distribution certificate.
   - Note the **Key ID** and the **Issuer ID** (shown above the key list).
   - **Download** the `.p8` file. Apple lets you download it only once.
2. **Add GitHub secrets.** github.com → LukeDEvans/Tableplan → Settings →
   Secrets and variables → Actions → *New repository secret*. The GitHub mobile
   app can't edit secrets, so use the website (fine in a phone browser).
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_KEY_P8`: the full text of the `.p8` file, including the
     `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines. A
     base64 of the file also works.
   - *(optional)* `VITE_VAPID_PUBLIC_KEY`: same value as in Netlify, if web
     push should work in the native build.

   On an iPhone: open the downloaded `.p8` in Files, copy its text, and paste
   it into the secret.
3. The app record (bundle ID `com.mrlukedevans.live`, team `6RTNUZR7K5`) must
   already exist in App Store Connect. It does if TestFlight has had a build.

### Sending a build
- **GitHub mobile app:** Tableplan → Actions → *iOS → TestFlight* → **Run
  workflow** (branch: `main`).
- **Website:** the same place, under the Actions tab.
- **Or ask Claude** in a session: "send main to TestFlight". It can start the
  workflow.

About 15–25 min for the build, then 5–15 min of App Store Connect processing
before it appears in TestFlight. If a step fails, the run log shows the
`xcodebuild` errors.

**Cost:** macOS runners use GitHub Actions minutes at 10× the Linux rate on
private repos. The free 2,000 min/month comes to roughly 200 macOS minutes,
about 8–12 TestFlight builds, less whatever the compile check uses.

## Native Apple Music

In the app, Apple Music runs on Apple's native MusicKit (`AppleMusicPlugin.swift`)
instead of MusicKit JS: sign-in is Apple's own permission prompt (no popup), songs
play natively, and music keeps going with the phone locked. The browser/PWA still
uses MusicKit JS. The web side is `music-applemusic-native.js`.

**One-time setup:** developer.apple.com → Certificates, Identifiers & Profiles →
Identifiers → `com.mrlukedevans.live` → **App Services** tab → tick **MusicKit** →
Save. Without it the Apple Music API calls fail with an authorization error.

**Check on the phone after a TestFlight build:** Settings → Apple Music → turn it on
→ Sign in (Apple's prompt appears) → play a Discover song; lock the phone and let it
run into the next song; use the lock-screen play/pause and next buttons.

## Coming next (not now)
- **Stage 1:** CORS + Supabase auth + Gmail native OAuth + confirm asset serving.
- **Stage 2:** native background-audio queue + on-device TTS behind `native-bridge.js`.
- **Stage 3:** native Apple Music. **Stage 4:** TestFlight for personal install.
