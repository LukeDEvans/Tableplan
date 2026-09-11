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
export function nativeTts() { return null; }         // AVSpeechSynthesizer / Android TTS plugin
export function nativeAppleMusic() { return null; }  // native MusicKit plugin
