// Cheap unread check for the menu badge (MESSAGING_DESIGN.md §9): is anything waiting
// in this device's inbox? Reads one id — no crypto, so libsodium isn't loaded just to
// draw a dot. Called on app focus and every 2 minutes while the app is visible;
// never while hidden.

import { createMessagingServer, createRestTransport } from "./server.js";
import { createKeystore, idbBackend } from "./keystore.js";

let storePromise = null;

export async function messagingWaiting({ baseUrl, headers, getRawWrapKey }) {
  try {
    if (typeof indexedDB === "undefined") return false;
    if (!storePromise) storePromise = idbBackend({ getRawWrapKey }).then(createKeystore);
    const store = await storePromise;
    const account = await store.get("account");
    if (!account || account.state !== "ready") return false;
    const server = createMessagingServer(createRestTransport({ baseUrl, headers }));
    return await server.hasWaiting(account.deviceId, (await store.get("cursor")) || 0);
  } catch {
    return false;
  }
}
