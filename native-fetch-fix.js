// iPhone app: byte uploads around Capacitor's native HTTP (Luke, 2026-11-14).
//
// With CapacitorHttp on (capacitor.config.json; kept for the cross-origin GETs
// weather and places need), Capacitor 6 replaces window.fetch and sends every
// non-GET through the native side. Its body conversion runs a Uint8Array or
// ArrayBuffer through TextDecoder (bytes that aren't UTF-8 come out mangled) and
// turns a plain Blob into "{}". So a receipt photo reached storage corrupted
// ("Could not process image") and a Document upload never matched its signed size.
//
// The fix: a request whose body is raw bytes (Uint8Array / ArrayBuffer / DataView /
// a Blob that isn't a File) goes through the web view's own fetch, which Capacitor
// keeps as window.CapacitorWebFetch. Storage (Supabase, R2) allows the app's origin.
// Everything else is untouched. Imported first by app.js, before any client keeps
// a reference to fetch. No-op in a browser.
export function isRawBytesBody(body) {
  if (!body) return false;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return true;
  if (typeof Blob !== "undefined" && body instanceof Blob && !(typeof File !== "undefined" && body instanceof File)) return true;
  return false;
}

export function installBinaryFetchFix(win = globalThis) {
  const webFetch = win?.CapacitorWebFetch;
  if (typeof webFetch !== "function" || typeof win.fetch !== "function" || win.fetch.__binaryFix) return false;
  const nativeFetch = win.fetch;
  const fixed = function fetch(resource, options) {
    const body = options?.body ?? (resource instanceof Request ? null : undefined);
    return isRawBytesBody(body) ? webFetch.call(win, resource, options) : nativeFetch.call(win, resource, options);
  };
  fixed.__binaryFix = true;
  win.fetch = fixed;
  return true;
}

installBinaryFetchFix();
