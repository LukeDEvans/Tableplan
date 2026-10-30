import { Capacitor as CapCore, registerPlugin } from '@capacitor/core';

// native-bridge.js — the seam between the web app and the Capacitor native shell.
//
// In a plain browser or the PWA, EVERY check here is false/"web" and the app uses
// its existing web paths unchanged — so importing this is zero-risk. Inside the
// Capacitor iOS/Android app, `window.Capacitor` is present and these report the
// native runtime, which is where the later stages plug native capabilities
// (background-audio queue, on-device TTS, native Apple Music) in behind web
// fallbacks. Stage 0 uses only isNativeApp()/nativePlatform(); the capability
// getters below are stubs that return null until their plugin is wired, so callers
// always fall back to the web implementation.

export function isNativeApp() {
  try {
    const C = globalThis.Capacitor;
    return !!(C && typeof C.isNativePlatform === "function" && C.isNativePlatform());
  } catch { return false; }
}

// "ios" | "android" | "web"
export function nativePlatform() {
  try {
    const C = globalThis.Capacitor;
    return (C && typeof C.getPlatform === "function" && C.getPlatform()) || "web";
  } catch { return "web"; }
}

// ── Capability seams (Stage 2+) ───────────────────────────────────────────────
// Each returns null until its native plugin is registered; a null result means
// "no native path — use the existing web engine/speechSynthesis/MusicKit JS".
export function nativeAudio() { return null; }       // background-audio queue plugin
// Native on-device TTS (AVSpeechSynthesizer via the LiveTts plugin): getVoices,
// speak/pause/resume/stop, and addListener("ttsFinish"|"ttsRange"|"ttsNext").
// null in a browser/PWA → callers fall back to the Web Speech API path.
//
// A native plugin is NOT auto-added to Capacitor.Plugins, and the *injected* native
// bridge global does not expose registerPlugin — that function lives in the
// @capacitor/core module, which the app must import and bundle. registerPlugin()
// builds the proxy that routes method/addListener calls to the native plugin, using
// the plugin header the native runtime injects (present only once the plugin is
// registered — the app's own plugins are registered in code by
// ios/App/App/MainViewController.swift, because `cap sync` rewrites
// capacitor.config.json's packageClassList with npm plugins only). So: import registerPlugin
// from @capacitor/core, call it once (cached), and only return the proxy when the
// native side actually registered the plugin — otherwise null → Web Speech fallback.
let _liveTts;
export function nativeTts() {
  if (_liveTts !== undefined) return _liveTts;
  try {
    // Native shell only. On web there is no native plugin to route to.
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _liveTts = null;
      return _liveTts;
    }
    const p = registerPlugin("LiveTts");
    // isPluginAvailable checks the native-injected plugin header, so this is true
    // only when LiveTtsPlugin is actually registered in the running app.
    _liveTts = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("LiveTts")) ? p : null;
  } catch { _liveTts = null; }
  return _liveTts;
}
// Native Apple Music (MusicKit via the AppleMusic plugin): sign-in, the Apple
// Music API and playback. null in a browser/PWA → MusicKit JS as before.
let _appleMusic;
export function nativeAppleMusic() {
  if (_appleMusic !== undefined) return _appleMusic;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _appleMusic = null;
      return _appleMusic;
    }
    const p = registerPlugin("AppleMusic");
    _appleMusic = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("AppleMusic")) ? p : null;
  } catch { _appleMusic = null; }
  return _appleMusic;
}
// Native subscriber-article reader (ArticleReader plugin): login / extract /
// logout, used by article-native-reader.js's flow in app.js. null in a
// browser/PWA → the server fetch (fetch-article) as before.
let _articleReader;
export function nativeArticleReader() {
  if (_articleReader !== undefined) return _articleReader;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _articleReader = null;
      return _articleReader;
    }
    const p = registerPlugin("ArticleReader");
    _articleReader = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("ArticleReader")) ? p : null;
  } catch { _articleReader = null; }
  return _articleReader;
}
// Native receipt camera (DocumentScanner plugin — Apple's VisionKit document
// camera): finds the receipt's edges, straightens + crops, multi-page, nothing
// saved to Photos. null in a browser/PWA (or an older app build without the
// plugin) → the header scanner's <input capture> camera as before.
let _documentScanner;
export function nativeDocumentScanner() {
  if (_documentScanner !== undefined) return _documentScanner;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _documentScanner = null;
      return _documentScanner;
    }
    const p = registerPlugin("DocumentScanner");
    _documentScanner = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("DocumentScanner")) ? p : null;
  } catch { _documentScanner = null; }
  return _documentScanner;
}

// Native local notifications (@capacitor/local-notifications — the npm package is a
// dependency so `cap sync` adds its native pod; JS reaches it through this proxy
// rather than the package's web fallback). Used for event reminders
// (calendar/reminders-native.js). null in a browser/PWA, or in an app build from
// before the plugin was added → reminders stay in-app toasts as before.
let _localNotifications;
export function nativeLocalNotifications() {
  if (_localNotifications !== undefined) return _localNotifications;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _localNotifications = null;
      return _localNotifications;
    }
    const p = registerPlugin("LocalNotifications");
    _localNotifications = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("LocalNotifications")) ? p : null;
  } catch { _localNotifications = null; }
  return _localNotifications;
}

// Dutch practice audio (LiveLanguagePlugin.swift): speaks with the best Dutch
// voice, recognizes speech and records for shadowing (language-speech.js).
// null in a browser/PWA, or in an app build from before the plugin was added →
// the Web Speech API instead.
let _language;
export function nativeLanguage() {
  if (_language !== undefined) return _language;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _language = null;
      return _language;
    }
    const p = registerPlugin("LiveLanguage");
    _language = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("LiveLanguage")) ? p : null;
  } catch { _language = null; }
  return _language;
}

// Encrypted messaging's store key (MessagingKeysPlugin.swift): a 32-byte key kept in
// this phone's Keychain that encrypts messaging's IndexedDB store
// (messaging/keystore.js). null in a browser/PWA → a non-extractable WebCrypto key
// kept in IndexedDB instead; null in an app build from before the plugin → same.
let _messagingKeys;
export function nativeMessagingKeys() {
  if (_messagingKeys !== undefined) return _messagingKeys;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _messagingKeys = null;
      return _messagingKeys;
    }
    const p = registerPlugin("MessagingKeys");
    _messagingKeys = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("MessagingKeys")) ? p : null;
  } catch { _messagingKeys = null; }
  return _messagingKeys;
}

// One-shot QR scanner (QrScanPlugin.swift) for linking devices and verifying a
// contact's security code. null in a browser/PWA or an older build → the
// messaging UI offers paste instead.
let _qrScan;
export function nativeQrScan() {
  if (_qrScan !== undefined) return _qrScan;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _qrScan = null;
      return _qrScan;
    }
    const p = registerPlugin("QrScan");
    _qrScan = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("QrScan")) ? p : null;
  } catch { _qrScan = null; }
  return _qrScan;
}

// Base64 JPEG pages from the native scanner → File objects the scan pipeline
// takes. Decoded by hand: fetch(data:) can be intercepted by CapacitorHttp.
export function scannedPagesToFiles(pages, stamp = Date.now()) {
  return (Array.isArray(pages) ? pages : []).filter((b) => typeof b === "string" && b).map((b64, i) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
    return new File([bytes], `receipt-${stamp}-${i + 1}.jpg`, { type: "image/jpeg" });
  });
}

// In-app sign-in sheet (WebAuth plugin — Apple's ASWebAuthenticationSession) for
// third-party accounts Google-style providers refuse inside an embedded web view
// (Gmail connect). null in a browser/PWA or an app build without the plugin.
let _webAuth;
export function nativeWebAuth() {
  if (_webAuth !== undefined) return _webAuth;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _webAuth = null;
      return _webAuth;
    }
    const p = registerPlugin("WebAuth");
    _webAuth = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("WebAuth")) ? p : null;
  } catch { _webAuth = null; }
  return _webAuth;
}

// Receipt share token for the Share Extension (ShareToken plugin — shared
// keychain group): set({ token }), clear(), status() → { present }. null in a
// browser/PWA or an app build from before the extension existed.
// receipt-share-token.js decides when to mint / store / clear.
let _shareToken;
export function nativeShareToken() {
  if (_shareToken !== undefined) return _shareToken;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _shareToken = null;
      return _shareToken;
    }
    const p = registerPlugin("ShareToken");
    _shareToken = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("ShareToken")) ? p : null;
  } catch { _shareToken = null; }
  return _shareToken;
}

// Home-screen icon (AppIcon plugin): get() → { name }, set({ name }) where name
// "" = the default icon, "AppIconHalloween" = the seasonal one. null in a
// browser/PWA or an app build from before the plugin existed. theme.js decides
// which icon the chosen theme wants.
let _appIcon;
export function nativeAppIcon() {
  if (_appIcon !== undefined) return _appIcon;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _appIcon = null;
      return _appIcon;
    }
    const p = registerPlugin("AppIcon");
    _appIcon = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("AppIcon")) ? p : null;
  } catch { _appIcon = null; }
  return _appIcon;
}

// Email attachments in Quick Look (AttachmentPreview plugin): open({ url, token,
// messageId, attachmentId, filename, mimeType }) downloads and shows the file;
// openData({ data, filename, mimeType }) shows base64 bytes. null in a
// browser/PWA or an app build from before the plugin existed → the web viewer.
let _attachmentPreview;
export function nativeAttachmentPreview() {
  if (_attachmentPreview !== undefined) return _attachmentPreview;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _attachmentPreview = null;
      return _attachmentPreview;
    }
    const p = registerPlugin("AttachmentPreview");
    _attachmentPreview = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("AttachmentPreview")) ? p : null;
  } catch { _attachmentPreview = null; }
  return _attachmentPreview;
}

// The iPhone app runs at capacitor://localhost, so app.js's canUseLocalBackend()
// (a hostname check) is TRUE there and URL helpers pick their local-dev-server
// paths (/api/<name>, served by server.js on a laptop). The live site only routes
// a few of those, so the rest 404'd in the app (weather "outside NWS coverage",
// location/store search, scans, imports…). app.js's native fetch shim sends every
// /api/<name> through this: it becomes the deployed function's real path.
// Kept as /api/: v2 functions whose config.path IS /api/<name>.
const NATIVE_API_KEEP = new Set(["chat", "clean-recipe", "push-subscribe"]);
// Local route name → deployed function name, where they differ.
const NATIVE_API_ALIASES = { calendars: "google-calendar" };
export function nativeApiPath(path) {
  const m = /^\/api\/([a-z0-9-]+)(.*)$/i.exec(String(path || ""));
  if (!m) return path;
  const [, name, rest] = m;
  if (NATIVE_API_KEEP.has(name)) return path;
  return `/.netlify/functions/${NATIVE_API_ALIASES[name] || name}${rest}`;
}

// Native device location (LiveLocation plugin, CLLocationManager): checkPermission,
// requestPermission, getCurrentPosition. null in a browser/PWA, or in an app build
// from before the plugin existed → callers use navigator.geolocation.
let _location;
export function nativeLocation() {
  if (_location !== undefined) return _location;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _location = null;
      return _location;
    }
    const p = registerPlugin("LiveLocation");
    _location = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("LiveLocation")) ? p : null;
  } catch { _location = null; }
  return _location;
}

// The app's URL scheme the Gmail callback returns to (gmail-callback NATIVE_RETURN).
export const APP_CALLBACK_SCHEME = "com.mrlukedevans.live";

// Where the app's own Apple / Google sign-in (Supabase OAuth) returns to, inside
// the WebAuth sheet. Must be listed in Supabase → Authentication → URL
// Configuration → Redirect URLs (as com.mrlukedevans.live://**), or Supabase sends
// the sheet to the website instead and the sign-in never comes back.
export const APP_AUTH_CALLBACK_URL = `${APP_CALLBACK_SCHEME}://auth-callback`;

// Reads the app-scheme URL Supabase's OAuth sign-in ends on. Returns one of
//   { kind: "code", code }                         PKCE flow (?code=)
//   { kind: "tokens", accessToken, refreshToken }  implicit flow (#access_token=)
//   { kind: "error", message }                     the provider or Supabase refused
//   { kind: "unknown" }                            anything else (not our scheme…)
export function parseOAuthCallback(url) {
  let u;
  try { u = new URL(String(url || "")); } catch { return { kind: "unknown" }; }
  if (u.protocol !== `${APP_CALLBACK_SCHEME}:`) return { kind: "unknown" };
  const query = u.searchParams;
  const hash = new URLSearchParams(String(u.hash || "").replace(/^#/, ""));
  const pick = (k) => hash.get(k) || query.get(k) || "";
  const error = pick("error");
  if (error) return { kind: "error", message: pick("error_description") || error };
  const code = query.get("code");
  if (code) return { kind: "code", code };
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "tokens", accessToken, refreshToken };
  return { kind: "unknown" };
}

// Reads the status the server put on the app-scheme return URL.
export function parseAppCallback(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== `${APP_CALLBACK_SCHEME}:`) return { status: "unknown" };
    return { status: u.searchParams.get("status") || "unknown", reason: u.searchParams.get("reason") || "" };
  } catch { return { status: "unknown" }; }
}

// Hand-off to another app (LinkOut plugin): open({ appUrls, webUrl }) →
// { opened: "app" | "web" | "none" }. null in a browser/PWA or an app build
// from before the plugin existed → link-out.js opens the website instead.
let _linkOut;
export function nativeLinkOut() {
  if (_linkOut !== undefined) return _linkOut;
  try {
    if (!(CapCore && typeof CapCore.isNativePlatform === "function" && CapCore.isNativePlatform())) {
      _linkOut = null;
      return _linkOut;
    }
    const p = registerPlugin("LinkOut");
    _linkOut = (CapCore.isPluginAvailable && CapCore.isPluginAvailable("LinkOut")) ? p : null;
  } catch { _linkOut = null; }
  return _linkOut;
}
