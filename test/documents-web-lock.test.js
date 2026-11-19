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

// A fake authenticator: PRF(salt) = SHA-256(secret ‖ salt); optional quirks. Like a
// real one it answers only for its own credential id and relying party.
function fakeCredentials({ prfOnCreate = true, prfEnabled = true, cancelGet = false } = {}) {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const prf = async (salt) => new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([...secret, ...new Uint8Array(salt)])));
  const calls = { create: 0, get: 0 };
  const id = crypto.getRandomValues(new Uint8Array(16));
  let rp = null;
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  return {
    calls,
    async create({ publicKey }) {
      calls.create++;
      rp = publicKey.rp.id;
      if (publicKey.authenticatorSelection?.userVerification !== "required") throw new Error("test: user verification must be required");
      const first = prfOnCreate ? await prf(publicKey.extensions.prf.eval.first) : undefined;
      return { rawId: id.slice().buffer, getClientExtensionResults: () => ({ prf: { enabled: prfEnabled, ...(first ? { results: { first } } : {}) } }) };
    },
    async get({ publicKey }) {
      calls.get++;
      if (publicKey.rpId !== rp) throw Object.assign(new Error("wrong relying party"), { name: "SecurityError" });
      if (!publicKey.allowCredentials?.some((c) => same(new Uint8Array(c.id), id))) throw Object.assign(new Error("no such credential"), { name: "NotAllowedError" });
      if (publicKey.userVerification !== "required") throw new Error("test: user verification must be required");
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
    const { key, commit } = await lock.setup();
    expect(lock.configured()).toBe(false); // nothing saved until the store is copied
    commit();
    expect(lock.configured()).toBe(true);
    expect(atob(key).length).toBe(32);
    expect((await lock.unlock()).key).toBe(key);
    expect((await lock.unlock()).key).toBe(key);
    expect(creds.calls).toEqual({ create: 1, get: 2 });
  });

  it("an authenticator that only says PRF is enabled at creation is asked once more for the key", async () => {
    const creds = fakeCredentials({ prfOnCreate: false });
    const { lock } = lockWith(creds);
    const { key, commit } = await lock.setup();
    commit();
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
    (await lock.setup()).commit();
    await expect(lock.unlock()).rejects.toMatchObject({ code: "CANCELLED" });
    lock.forget();
    expect(lock.configured()).toBe(false);
    await expect(lock.unlock()).rejects.toMatchObject({ code: "NOT_SET_UP" });
  });

  it("what's kept in plain storage is the credential id and salt, never the key", async () => {
    const { lock, storage } = lockWith(fakeCredentials());
    const { key, commit } = await lock.setup();
    commit();
    const kept = [...storage.raw.values()].join("");
    expect(kept).toContain("credentialId");
    expect(kept).not.toContain(key);
  });

  it("a setup that's never committed (the copy failed, the tab closed) leaves nothing saved", async () => {
    const { lock, storage } = lockWith(fakeCredentials({ prfOnCreate: false }));
    await lock.setup();
    expect(lock.configured()).toBe(false);
    expect(storage.raw.size).toBe(0);
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

describe("the passkey lock, against a stranger's passkey", () => {
  it("another browser's passkey (another credential) can't unlock this one", async () => {
    const storage = memoryStorage();
    const mine = createPasskeyLock({ userId: "u1", storage, credentials: fakeCredentials(), rpId: "example.test" });
    (await mine.setup()).commit();
    const theirs = fakeCredentials();
    (await createPasskeyLock({ userId: "u1", storage: memoryStorage(), credentials: theirs, rpId: "example.test" }).setup()).commit();
    const other = createPasskeyLock({ userId: "u1", storage, credentials: theirs, rpId: "example.test" });
    await expect(other.unlock()).rejects.toMatchObject({ code: "CANCELLED" });
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
