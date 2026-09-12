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
// listed in capacitor.config.json's packageClassList). So: import registerPlugin
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
export function nativeAppleMusic() { return null; }  // native MusicKit plugin
