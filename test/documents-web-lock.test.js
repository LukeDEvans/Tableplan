// The web lock (documents/web-lock.js) with a stand-in for the browser's WebAuthn:
// the key comes from the passkey's PRF output through HKDF, the same every unlock;
// setup copes with authenticators that only report PRF as enabled; refusals and
// cancels come back as codes; what's kept in plain storage isn't the key.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createPasskeyLock, keyFromPrf, copyStore } from "../documents/web-lock.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
}

// A fake authenticator: PRF(salt) = SHA-256(secret ‖ salt); optional quirks.
function fakeCredentials({ prfOnCreate = true, prfEnabled = true, cancelGet = false } = {}) {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const prf = async (salt) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...secret, ...new Uint8Array(salt)])));
  const calls = { create: 0, get: 0 };
  return {
    calls,
    async create({ publicKey }) {
      calls.create++;
      const first = prfOnCreate ? await prf(publicKey.extensions.prf.eval.first) : undefined;
      return { rawId: new Uint8Array([1, 2, 3, 4]).buffer, getClientExtensionResults: () => ({ prf: { enabled: prfEnabled, ...(first ? { results: { first } } : {}) } }) };
    },
    async get({ publicKey }) {
      calls.get++;
      if (cancelGet) throw Object.assign(new Error("no"), { name: "NotAllowedError" });
      const first = prfEnabled ? await prf(publicKey.extensions.prf.eval.first) : null;
      return { getClientExtensionResults: () => (first ? { prf: { results: { first } } } : {}) };
    },
  };
}

const lockWith = (credentials, storage = memoryStorage()) => ({ storage, lock: createPasskeyLock({ userId: "u1", storage, credentials, rpId: "example.test" }) });

describe("the passkey lock", () => {
  it("setup gives a key, and every unlock gives the same one", async () => {
    const creds = fakeCredentials();
    const { lock } = lockWith(creds);
    expect(lock.configured()).toBe(false);
    const { key } = await lock.setup();
    expect(lock.configured()).toBe(true);
    expect(atob(key).length).toBe(32);
    expect((await lock.unlock()).key).toBe(key);
    expect((await lock.unlock()).key).toBe(key);
    expect(creds.calls).toEqual({ create: 1, get: 2 });
  });

  it("an authenticator that only says PRF is enabled at creation is asked once more for the key", async () => {
    const creds = fakeCredentials({ prfOnCreate: false });
    const { lock } = lockWith(creds);
    const { key } = await lock.setup();
    expect(creds.calls).toEqual({ create: 1, get: 1 });
    expect((await lock.unlock()).key).toBe(key);
  });

  it("no PRF: refused, and nothing is kept", async () => {
    const { lock, storage } = lockWith(fakeCredentials({ prfOnCreate: false, prfEnabled: false }));
    await expect(lock.setup()).rejects.toMatchObject({ code: "NO_PRF" });
    expect(lock.configured()).toBe(false);
    expect(storage.raw.size).toBe(0);
  });

  it("a closed Touch ID prompt is CANCELLED; forget removes the setup", async () => {
    const creds = fakeCredentials({ cancelGet: true });
    const { lock } = lockWith(creds);
    await lock.setup();
    await expect(lock.unlock()).rejects.toMatchObject({ code: "CANCELLED" });
    lock.forget();
    expect(lock.configured()).toBe(false);
    await expect(lock.unlock()).rejects.toMatchObject({ code: "NOT_SET_UP" });
  });

  it("what's kept in plain storage is the credential id and salt, never the key", async () => {
    const { lock, storage } = lockWith(fakeCredentials());
    const { key } = await lock.setup();
    const kept = [...storage.raw.values()].join("");
    expect(kept).toContain("credentialId");
    expect(kept).not.toContain(key);
  });

  it("the store key is HKDF of the PRF output (not the output itself)", async () => {
    const out = crypto.getRandomValues(new Uint8Array(32));
    const k = await keyFromPrf(out);
    expect(k.length).toBe(32);
    expect(Buffer.from(k).equals(Buffer.from(out))).toBe(false);
    expect(Buffer.from(await keyFromPrf(out)).equals(Buffer.from(k))).toBe(true);
  });

  it("refuses an IP address as the relying party (WebAuthn needs a domain)", async () => {
    const g = globalThis.PublicKeyCredential;
    globalThis.PublicKeyCredential = { isUserVerifyingPlatformAuthenticatorAvailable: async () => true };
    try {
      expect(await createPasskeyLock({ userId: "u", storage: memoryStorage(), credentials: fakeCredentials(), rpId: "127.0.0.1" }).supported()).toBe(false);
      expect(await createPasskeyLock({ userId: "u", storage: memoryStorage(), credentials: fakeCredentials(), rpId: "localhost" }).supported()).toBe(true);
    } finally { globalThis.PublicKeyCredential = g; }
  });
});

describe("moving the store", () => {
  it("copies every value", async () => {
    const a = createKeystore(memoryBackend());
    const b = createKeystore(memoryBackend());
    await a.set("vault:g", { keys: { 1: new Uint8Array([9, 9]) } });
    await a.set("owner", "u1");
    await copyStore(a, b);
    expect(await b.get("owner")).toBe("u1");
    expect((await b.get("vault:g")).keys[1]).toEqual(new Uint8Array([9, 9]));
  });
});
