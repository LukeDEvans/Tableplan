// A self-test of the Documents crypto core that runs wherever the app runs —
// Chrome, the laptop app and the iPhone's web view (DOCUMENTS_DESIGN.md §14). Used
// by scripts/qa-documents-crypto.mjs in headless Chromium, and later from the
// Documents page's ⋯ menu on the phone.

import { loadSodium } from "../../messaging/crypto/sodium.js";
import { utf8, fromUtf8, equalBytes } from "../../messaging/crypto/bytes.js";
import { generateDevice } from "../../messaging/crypto/keys.js";
import { generateVaultKey, generateFileKey, wrapFileKey, unwrapFileKey, encryptFolderName, decryptFolderName, rotateVault, unlockKeyring } from "./vault.js";
import { encryptBlob, decryptBlob } from "./file.js";
import { encryptMeta, decryptMeta } from "./meta.js";
import { generateBoxKey, signBoxKey, verifyBoxKey, createGrant, openGrant } from "./grants.js";
import { generateRecoveryCode, parseRecoveryCode, deriveRecoveryKeys, wrapAnchor, sealToRecovery, restoreVaultKey } from "./recovery.js";
import { newRecoveryParams } from "./recovery-params.js";

export async function runDocumentsCryptoSelfTest({ argon = true } = {}) {
  const started = Date.now();
  const checks = [];
  const check = (name, fn) => {
    try {
      const ok = fn();
      checks.push({ name, ok: ok !== false });
    } catch (e) {
      checks.push({ name, ok: false, error: String(e && e.message || e) });
    }
  };

  await loadSodium();

  const scope = "self-test-scope";
  const vaultId = "self-test-vault";
  const vaultKey = generateVaultKey();
  const fileKey = generateFileKey();
  const ctx = { vaultId, scope, fileId: "f1", keyVersion: 1 };

  check("file key wraps and unwraps", () => equalBytes(unwrapFileKey(vaultKey, wrapFileKey(vaultKey, fileKey, ctx), ctx), fileKey));
  check("wrapped file key refuses another file", () => {
    const w = wrapFileKey(vaultKey, fileKey, ctx);
    try { unwrapFileKey(vaultKey, w, { ...ctx, fileId: "f2" }); return false; } catch { return true; }
  });

  const big = new Uint8Array(300_000);
  for (let i = 0; i < big.length; i += 65536) crypto.getRandomValues(big.subarray(i, Math.min(i + 65536, big.length)));
  check("300 KB document round trip", () => equalBytes(decryptBlob(fileKey, "f1", "content", encryptBlob(fileKey, "f1", "content", big)), big));
  check("tampered document refused", () => {
    const blob = encryptBlob(fileKey, "f1", "content", big);
    blob[blob.length - 5] ^= 1;
    try { decryptBlob(fileKey, "f1", "content", blob); return false; } catch { return true; }
  });
  check("truncated document refused", () => {
    const blob = encryptBlob(fileKey, "f1", "content", big);
    try { decryptBlob(fileKey, "f1", "content", blob.subarray(0, blob.length - 1000)); return false; } catch { return true; }
  });
  check("metadata round trip", () => decryptMeta(fileKey, "f1", encryptMeta(fileKey, "f1", { v: 1, rev: 1, name: "Passport – Luke", mime: "application/pdf", pages: 2 })).name === "Passport – Luke");
  check("folder name round trip", () => decryptFolderName(vaultKey, encryptFolderName(vaultKey, "IDs & Records", { vaultId, scope, folderId: "d1", keyVersion: 1 }), { vaultId, scope, folderId: "d1", keyVersion: 1 }) === "IDs & Records");

  check("rotation keeps old version reachable", () => {
    const r = rotateVault({ vaultId, scope, key: vaultKey, version: 1 });
    const ring = unlockKeyring({ vaultId, scope, current: { key: r.key, version: 2 }, oldRows: [r.oldRow] });
    return equalBytes(ring.get(1), vaultKey) && !equalBytes(r.key, vaultKey);
  });

  const granterDev = generateDevice();
  const box = generateBoxKey();
  const gctx = { vaultId, scope, keyVersion: 1, recipientUserId: "u2", recipientDeviceId: "d2", recipientBoxPub: box.pub };
  check("box key signature verifies", () => verifyBoxKey(granterDev.signPub, { userId: "u2", deviceId: "d2", boxPub: box.pub }, signBoxKey(granterDev, { userId: "u2", deviceId: "d2", boxPub: box.pub })));
  check("vault grant opens on the right device", () => {
    const g = createGrant({ granter: { userId: "u1", deviceId: "d1", device: granterDev }, vaultKey, ctx: gctx, removedDeviceIds: [] });
    return equalBytes(openGrant({ grant: g, ctx: gctx, box, granterSignPub: granterDev.signPub, removedDeviceIds: [] }), vaultKey);
  });

  check("recovery code format and check", () => {
    const c = generateRecoveryCode();
    return /^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/.test(c) && parseRecoveryCode(c.toLowerCase()).length === 32;
  });
  if (argon) {
    check("recovery restore (Argon2id)", () => {
      const code = generateRecoveryCode();
      const params = newRecoveryParams();
      const keys = deriveRecoveryKeys(code, params);
      const base = { userId: "u1", vaultId, scope };
      const anchor = { keyVersion: 1, wrapped: wrapAnchor(keys.anchorKey, vaultKey, { ...base, keyVersion: 1 }) };
      const r = rotateVault({ vaultId, scope, key: vaultKey, version: 1 });
      const sealed = [{ keyVersion: 2, sealed: sealToRecovery(keys.recoveryPub, r.key, { ...base, keyVersion: 2 }) }];
      const out = restoreVaultKey({ keys: deriveRecoveryKeys(code, params), base, anchor, sealed, oldRows: [r.oldRow] });
      return out.version === 2 && out.complete && equalBytes(out.key, r.key);
    });
  }
  check("utf8 sanity", () => fromUtf8(utf8("Ü")) === "Ü");

  return { ok: checks.every((c) => c.ok), checks, ms: Date.now() - started };
}
