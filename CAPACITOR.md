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

## Coming next (not now)
- **Stage 1:** CORS + Supabase auth + Gmail native OAuth + confirm asset serving.
- **Stage 2:** native background-audio queue + on-device TTS behind `native-bridge.js`.
- **Stage 3:** native Apple Music. **Stage 4:** TestFlight for personal install.
