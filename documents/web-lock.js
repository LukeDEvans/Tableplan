// The web lock for Documents (Luke, 2026-11-03: "passkey, real encryption"). The
// browser counterpart of the iPhone's DocumentsLock (Face ID): a passkey on this
// computer (Touch ID, Windows Hello) whose PRF output, through HKDF, is the key that
// encrypts Documents' store in this browser. Reading it IS the Touch ID prompt, so
// the lock is encryption, not a screen. Same interface as the native plugin:
// unlock({ reason }) → { key: base64 of 32 bytes }.
//
// What's kept in plain browser storage (localStorage, per account): the passkey's
// credential id and the PRF salt. Neither is secret: without the passkey (and the
// person's fingerprint or PIN) they give nothing.
//
// Browsers without the PRF extension (or without a platform authenticator) can't use
// it: `supported()` says so and the page doesn't offer it.

const CONFIG_KEY = (userId) => `liveDocumentsPasskey:${userId}`;
const HKDF_INFO = "live documents web lock v1";

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "===".slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export class WebLockError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// The key the store uses: HKDF-SHA256 over the passkey's PRF output.
export async function keyFromPrf(prfOutput) {
  const base = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode(HKDF_INFO) }, base, 256);
  return new Uint8Array(bits);
}

export function createPasskeyLock({ userId, userName = "Live", storage = globalThis.localStorage, credentials = globalThis.navigator?.credentials, rpId = globalThis.location?.hostname } = {}) {
  const readConfig = () => { try { const c = JSON.parse(storage.getItem(CONFIG_KEY(userId)) || "null"); return c && c.credentialId && c.salt ? c : null; } catch { return null; } };
  const writeConfig = (c) => { try { storage.setItem(CONFIG_KEY(userId), JSON.stringify(c)); } catch { /* private window */ } };

  // Whether this browser can do it at all: a platform authenticator, and PRF where
  // the browser can say (getClientCapabilities); otherwise setup finds out.
  async function supported() {
    try {
      const P = globalThis.PublicKeyCredential;
      if (!P || !credentials?.create || !rpId || /^[\d.]+$|:/.test(rpId)) return false; // no IP-address relying parties
      if (typeof P.getClientCapabilities === "function") {
        const caps = await P.getClientCapabilities();
        if (caps && caps["extension:prf"] === false) return false;
      }
      return typeof P.isUserVerifyingPlatformAuthenticatorAvailable === "function" ? await P.isUserVerifyingPlatformAuthenticatorAvailable() : false;
    } catch { return false; }
  }

  const prfResult = (cred) => cred?.getClientExtensionResults?.()?.prf;

  // Makes the passkey (one Touch ID prompt; a second for the first key if the
  // authenticator only reports PRF as enabled at creation). Returns { key }.
  async function setup() {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    let cred;
    try {
      cred = await credentials.create({
        publicKey: {
          rp: { name: "Live", id: rpId },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: userName, displayName: `${userName} · Documents` },
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
          timeout: 60000,
          extensions: { prf: { eval: { first: salt } } },
        },
      });
    } catch (e) {
      throw new WebLockError(e?.name === "NotAllowedError" ? "CANCELLED" : "FAILED", e?.name === "NotAllowedError" ? "Cancelled." : (e?.message || "The passkey couldn't be made."));
    }
    const prf = prfResult(cred);
    if (!prf || (prf.enabled !== true && !prf.results?.first)) throw new WebLockError("NO_PRF", "This browser can't lock Documents with a passkey.");
    const config = { credentialId: b64u(cred.rawId), salt: b64u(salt), at: Date.now() };
    if (prf.results?.first) { writeConfig(config); return { key: b64(await keyFromPrf(prf.results.first)) }; }
    writeConfig(config);
    return unlock();
  }

  // The Touch ID prompt. Throws CANCELLED when the person closes it.
  async function unlock() {
    const config = readConfig();
    if (!config) throw new WebLockError("NOT_SET_UP", "No passkey lock on this browser.");
    let cred;
    try {
      cred = await credentials.get({
        publicKey: {
          rpId,
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          allowCredentials: [{ type: "public-key", id: fromB64u(config.credentialId) }],
          userVerification: "required",
          timeout: 60000,
          extensions: { prf: { eval: { first: fromB64u(config.salt) } } },
        },
      });
    } catch (e) {
      throw new WebLockError(e?.name === "NotAllowedError" ? "CANCELLED" : "FAILED", e?.name === "NotAllowedError" ? "Cancelled." : (e?.message || "Couldn't unlock."));
    }
    const first = prfResult(cred)?.results?.first;
    if (!first) throw new WebLockError("NO_PRF", "The passkey didn't return its key.");
    return { key: b64(await keyFromPrf(first)) };
  }

  return {
    supported,
    configured: () => Boolean(readConfig()),
    setup,
    unlock,
    forget: () => { try { storage.removeItem(CONFIG_KEY(userId)); } catch { /* nothing kept */ } },
  };
}

// Copies every value of one store into another (turning the lock on or off moves
// Documents' store to a database encrypted with the other key).
export async function copyStore(from, to) {
  for (const key of await from.keys("")) {
    const value = await from.get(key);
    if (value !== null) await to.set(key, value);
  }
}

export const WEB_LOCKED_DB = "live-documents-pk";
