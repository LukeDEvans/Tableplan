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

// The app's URL scheme the Gmail callback returns to (gmail-callback NATIVE_RETURN).
export const APP_CALLBACK_SCHEME = "com.mrlukedevans.live";

// Reads the status the server put on the app-scheme return URL.
export function parseAppCallback(url) {
  try {
    const u = new URL(String(url || ""));
    if (u.protocol !== `${APP_CALLBACK_SCHEME}:`) return { status: "unknown" };
    return { status: u.searchParams.get("status") || "unknown", reason: u.searchParams.get("reason") || "" };
  } catch { return { status: "unknown" }; }
}
