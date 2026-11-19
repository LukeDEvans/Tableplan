// Signing out (or switching accounts) forgets secure messages on this device
// (MESSAGING_DESIGN.md §18 finding 2): the device is removed from the account while
// the session token still works, so it stops receiving ciphertext; then the local
// store is deleted, and on iPhone the Keychain key that encrypted it. No crypto
// needed, so libsodium isn't loaded for this.
//
// On the phone this means messaging must be set up again after signing back in —
// which replaces the security code and removes the linked devices (§3 reset).

import { createMessagingServer, createRestTransport } from "./server.js";
import { createKeystore, idbBackend, messagingStoreExists, deleteMessagingStore } from "./keystore.js";

export async function forgetMessagingOnThisDevice({ baseUrl, headers, getRawWrapKey = async () => null, destroyKey = async () => {}, beforeDelete = async () => {} }) {
  try {
    if (await messagingStoreExists()) {
      const backend = await idbBackend({ getRawWrapKey });
      const store = createKeystore(backend);
      const account = await store.get("account").catch(() => null);
      if (account?.deviceId && account.state === "ready") {
        await createMessagingServer(createRestTransport({ baseUrl, headers })).removeDevice(account.deviceId).catch(() => {});
      }
      backend.close();
    }
  } catch { /* forgetting continues regardless */ }
  await beforeDelete(); // the Messages tab and the badge close their connections
  await deleteMessagingStore();
  await destroyKey().catch(() => {});
}
