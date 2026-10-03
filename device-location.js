// device-location.js — the device's position, for local weather.
//
// In the iPhone app this goes through the native LiveLocation plugin
// (CLLocationManager): the app's web view can't use navigator.geolocation
// reliably. In a browser/PWA (or an app build without the plugin) it uses
// navigator.geolocation. Coordinates are only ever passed to the weather lookup;
// nothing here stores them.
import { nativeLocation } from './native-bridge.js';

// "granted" | "denied" | "prompt" (not asked yet, or the browser won't say) |
// "unavailable" (no location support at all). Never shows a prompt.
export async function locationPermission() {
  const native = nativeLocation();
  if (native) {
    try { return (await native.checkPermission())?.location || "prompt"; } catch { return "prompt"; }
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return "unavailable";
  try {
    const p = await navigator.permissions?.query?.({ name: "geolocation" });
    return p?.state || "prompt";
  } catch { return "prompt"; }
}

// The current position as { latitude, longitude }. Shows the permission prompt
// if it hasn't been answered yet. Rejects with an Error whose `denied` is true
// when permission is refused, or `unavailable` when no fix can be had.
export function getDevicePosition({ timeoutMs = 12000, maximumAgeMs = 5 * 60 * 1000 } = {}) {
  const native = nativeLocation();
  const fail = (denied, msg) => Object.assign(new Error(msg), { denied, unavailable: !denied });
  if (native) {
    return withTimeout(
      native.getCurrentPosition().then((r) => ({ latitude: r.latitude, longitude: r.longitude })),
      timeoutMs + 20000, // leave the user time to answer the iOS prompt
    ).catch((err) => { throw fail(err?.code === "DENIED", err?.message || "Couldn't get your location"); });
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.reject(fail(false, "Location isn't available on this device"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(fail(err?.code === 1, err?.message || "Couldn't get your location")),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
    );
  });
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([
    promise.finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error("Timed out getting your location")), ms); }),
  ]);
}
