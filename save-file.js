// save-file.js — hand a generated file (CSV, vCard, MusicXML, export zip) to the
// user. Browsers get an ordinary download. The iOS app's web view (WKWebView)
// ignores `<a download>` for blob URLs, so there the file goes to the share sheet
// (Save to Files / AirDrop / Mail) — the same route "Export my data" already used.
//
// Returns "shared" | "downloaded" | "cancelled". A dismissed share sheet is not an
// error (AbortError → "cancelled").

import { isNativeApp } from "./native-bridge.js";

export function chooseSaveRoute({ native, canShareFiles }) {
  return native && canShareFiles ? "share" : "download";
}

export async function saveFile(blob, fileName, { title = fileName, env = globalThis } = {}) {
  const file = typeof env.File === "function" ? new env.File([blob], fileName, { type: blob.type || "application/octet-stream" }) : null;
  const canShareFiles = !!(file && env.navigator?.canShare?.({ files: [file] }));
  if (chooseSaveRoute({ native: isNativeApp(), canShareFiles }) === "share") {
    try {
      await env.navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e?.name === "AbortError") return "cancelled";
      throw e;
    }
  }
  const url = env.URL.createObjectURL(blob);
  const a = env.document.createElement("a");
  a.href = url;
  a.download = fileName;
  env.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => env.URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
