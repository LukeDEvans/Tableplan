// Vault keys, file keys, folder names, rotation (documents/crypto/vault.js, wrap.js).

import { describe, it, expect } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import {
  generateVaultKey, generateFileKey, wrapFileKey, unwrapFileKey, rewrapFileKey,
  encryptFolderName, decryptFolderName, rewrapFolderName, FOLDER_NAME_MAX,
  rotateVault, unlockKeyring, rowVersionAllowed,
} from "../documents/crypto/vault.js";
import { contextBytes, seal, open } from "../documents/crypto/wrap.js";

await loadSodium();

const base = { vaultId: "vault-h", scope: "group-1", keyVersion: 1 };
const refuses = (fn) => expect(fn).toThrow();

describe("wrap.js", () => {
  it("context fields can't be re-split", () => {
    // "ab"+"c" and "a"+"bc" must not encode the same.
    const a = contextBytes("LiveDocs/test/v1", [["x", "ab"], ["y", "c"]]);
    const b = contextBytes("LiveDocs/test/v1", [["x", "a"], ["y", "bc"]]);
    expect(a).not.toEqual(b);
  });
  it("rejects bad labels, ids and versions", () => {
    refuses(() => contextBytes("Other/x/v1", []));
    refuses(() => contextBytes("LiveDocs/x/v1", [["id", "a b"]]));
    refuses(() => contextBytes("LiveDocs/x/v1", [["keyVersion", 0]]));
    refuses(() => contextBytes("LiveDocs/x/v1", [["keyVersion", 1.5]]));
  });
  it("field types are fixed by name: a version given as text is refused", () => {
    refuses(() => contextBytes("LiveDocs/x/v1", [["keyVersion", "1"]]));
    refuses(() => contextBytes("LiveDocs/x/v1", [["fileId", 1]]));
    const vk = generateVaultKey();
    refuses(() => wrapFileKey(vk, generateFileKey(), { ...base, fileId: "f", keyVersion: "1" }));
  });
  it("seal/open: wrong key, wrong context, edits and versions are refused", () => {
    const k = generateVaultKey();
    const ad = contextBytes("LiveDocs/test/v1", [["x", "a"]]);
    const w = seal(k, new Uint8Array([1, 2, 3]), ad);
    expect(open(k, w, ad)).toEqual(new Uint8Array([1, 2, 3]));
    refuses(() => open(generateVaultKey(), w, ad));
    refuses(() => open(k, w, contextBytes("LiveDocs/test/v1", [["x", "b"]])));
    for (let i = 0; i < w.length; i++) { const t = w.slice(); t[i] ^= 1; refuses(() => open(k, t, ad)); }
    refuses(() => open(k, w.subarray(0, 20), ad));
    refuses(() => seal(new Uint8Array(31), new Uint8Array(1), ad));
  });
});

describe("file keys", () => {
  const vk = generateVaultKey();
  const fk = generateFileKey();
  const ctx = { ...base, fileId: "file-1" };
  const w = wrapFileKey(vk, fk, ctx);

  it("round trip", () => expect(unwrapFileKey(vk, w, ctx)).toEqual(fk));

  it("refuse every other place", () => {
    for (const change of [{ vaultId: "vault-p" }, { scope: "u-luke" }, { fileId: "file-2" }, { keyVersion: 2 }]) {
      refuses(() => unwrapFileKey(vk, w, { ...ctx, ...change }));
    }
    refuses(() => unwrapFileKey(generateVaultKey(), w, ctx));
  });

  it("move to Personal and rotation re-wrap", () => {
    const pk = generateVaultKey();
    const to = { vaultId: "vault-p", scope: "u-luke", keyVersion: 1, fileId: "file-1" };
    const moved = rewrapFileKey(vk, w, ctx, pk, to);
    expect(unwrapFileKey(pk, moved, to)).toEqual(fk);
    refuses(() => unwrapFileKey(vk, moved, ctx));
    refuses(() => rewrapFileKey(vk, w, ctx, pk, { ...to, fileId: "file-9" }));
  });

  it("refuse a value that isn't a key", () => {
    refuses(() => wrapFileKey(vk, new Uint8Array(16), ctx));
  });
});

describe("folder names", () => {
  const vk = generateVaultKey();
  const ctx = { ...base, folderId: "folder-1" };

  it("round trip, trimmed and normalized", () => {
    const e = encryptFolderName(vk, "  Café & Co  ", ctx);
    expect(decryptFolderName(vk, e, ctx)).toBe("Café & Co");
  });
  it("refuse other folders and versions", () => {
    const e = encryptFolderName(vk, "Medical", ctx);
    refuses(() => decryptFolderName(vk, e, { ...ctx, folderId: "folder-2" }));
    refuses(() => decryptFolderName(vk, e, { ...ctx, keyVersion: 2 }));
  });
  it("direction overrides and invisible characters are removed", () => {
    expect(decryptFolderName(vk, encryptFolderName(vk, "Tax\u202E\u200Bes\n2025", ctx), ctx)).toBe("Taxes 2025");
    refuses(() => encryptFolderName(vk, "\u202E", ctx));
  });
  it("limits", () => {
    refuses(() => encryptFolderName(vk, "   ", ctx));
    refuses(() => encryptFolderName(vk, 7, ctx));
    expect(() => encryptFolderName(vk, "é".repeat(FOLDER_NAME_MAX), ctx)).not.toThrow();
    refuses(() => encryptFolderName(vk, "x".repeat(FOLDER_NAME_MAX + 1), ctx));
  });
  it("short names all store at the same size", () => {
    const sizes = new Set(["IDs", "Home", "Insurance", "Vehicles & boats"].map((n) => encryptFolderName(vk, n, ctx).length));
    expect(sizes.size).toBe(1);
  });
  it("re-wrap on rotation", () => {
    const r = rotateVault({ vaultId: base.vaultId, scope: base.scope, key: vk, version: 1 });
    const e = rewrapFolderName(vk, encryptFolderName(vk, "Home", ctx), ctx, r.key, { ...ctx, keyVersion: 2 });
    expect(decryptFolderName(r.key, e, { ...ctx, keyVersion: 2 })).toBe("Home");
  });
});

describe("rotation and the keyring", () => {
  const ids = { vaultId: "vault-h", scope: "group-1" };

  function chain(n) {
    const keys = [null, generateVaultKey()];
    const rows = [];
    for (let v = 1; v < n; v++) {
      const r = rotateVault({ ...ids, key: keys[v], version: v });
      expect(r.version).toBe(v + 1);
      keys.push(r.key);
      rows.push(r.oldRow);
    }
    return { keys, rows };
  }

  it("every version is reachable from the newest", () => {
    const { keys, rows } = chain(5);
    const ring = unlockKeyring({ ...ids, current: { key: keys[5], version: 5 }, oldRows: rows });
    for (let v = 1; v <= 5; v++) expect(ring.get(v)).toEqual(keys[v]);
  });

  it("an old key can't reach a newer one", () => {
    const { keys, rows } = chain(3);
    const ring = unlockKeyring({ ...ids, current: { key: keys[2], version: 2 }, oldRows: rows });
    expect([...ring.keys()].sort()).toEqual([1, 2]);
  });

  it("a missing link stops the walk", () => {
    const { keys, rows } = chain(4);
    const ring = unlockKeyring({ ...ids, current: { key: keys[4], version: 4 }, oldRows: rows.filter((r) => r.version !== 2) });
    expect([...ring.keys()].sort()).toEqual([3, 4]);
  });

  it("a planted row (other vault, or a key of the server's choosing) is not trusted", () => {
    const { keys, rows } = chain(3);
    const other = chain(3);
    const planted = rows.map((r) => (r.version === 2 ? { version: 2, wrapped: seal(keys[3], generateVaultKey(), contextBytes("LiveDocs/old-vault-key/v1", [["vaultId", "vault-x"], ["scope", "group-1"], ["oldVersion", 2], ["newVersion", 3]])) } : r));
    const ring = unlockKeyring({ ...ids, current: { key: keys[3], version: 3 }, oldRows: planted });
    expect([...ring.keys()]).toEqual([3]);
    const ring2 = unlockKeyring({ ...ids, current: { key: keys[3], version: 3 }, oldRows: other.rows });
    expect([...ring2.keys()]).toEqual([3]);
    // and a chain for the same keys under another scope label doesn't open either
    const ring3 = unlockKeyring({ vaultId: "vault-h", scope: "u-luke", current: { key: keys[3], version: 3 }, oldRows: rows });
    expect([...ring3.keys()]).toEqual([3]);
  });

  it("duplicate and planted rows don't block the walk", () => {
    const { keys, rows } = chain(4);
    const junk = { version: 2, wrapped: seal(generateVaultKey(), generateVaultKey(), new Uint8Array(1)) };
    const ring = unlockKeyring({ ...ids, current: { key: keys[4], version: 4 }, oldRows: [junk, ...rows, rows[0], { version: 999, wrapped: rows[0].wrapped }, { version: 999, wrapped: rows[1].wrapped }, null, { version: "2" }] });
    for (let v = 1; v <= 4; v++) expect(ring.get(v)).toEqual(keys[v]);
  });

  it("rows below the settled version are refused for display", () => {
    expect(rowVersionAllowed(2, 2)).toBe(true);
    expect(rowVersionAllowed(3, 2)).toBe(true);
    expect(rowVersionAllowed(1, 2)).toBe(false);
    expect(rowVersionAllowed(1)).toBe(true);
    expect(rowVersionAllowed("2", 2)).toBe(false);
    expect(rowVersionAllowed(2, "2")).toBe(false);
  });

  it("rotation makes a different key and refuses bad input", () => {
    const k = generateVaultKey();
    expect(rotateVault({ ...ids, key: k, version: 1 }).key).not.toEqual(k);
    refuses(() => rotateVault({ ...ids, key: k, version: 0 }));
    refuses(() => rotateVault({ ...ids, key: new Uint8Array(32).subarray(1), version: 1 }));
  });
});
