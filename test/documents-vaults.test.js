// Vault keys across devices (documents/vaults.js), end to end against a real Postgres
// with the messaging and Documents migrations and row security: creating vaults,
// granting new devices, removing a device (rotation), the recovery code, and a
// server that lies.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount } from "../messaging/account.js";
import { toB64, fromB64 } from "../messaging/crypto/bytes.js";
import { generateDevice } from "../messaging/crypto/keys.js";
import { createDocumentsServer } from "../documents/server.js";
import { createDocumentsVaults } from "../documents/vaults.js";
import {
  generateVaultKey, generateFileKey, wrapFileKey, unwrapFileKey, encryptFolderName, decryptFolderName,
  generateBoxKey, createGrant,
} from "../documents/crypto/index.js";
import { createDocumentsDatabase, pgliteTransport, USERS, GROUP } from "./documents-pglite-harness.js";

let db;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createDocumentsDatabase(); }, 60_000);

const scopeMembers = async (scope) => (scope === GROUP ? [USERS.luke, USERS.wife] : []);
const PERSONAL = `u-${USERS.luke}`;

function device(userKey) {
  const userId = USERS[userKey];
  const transport = pgliteTransport(db, userId);
  const msgServer = createMessagingServer(transport);
  const account = createMessagingAccount({ server: msgServer, store: createKeystore(memoryBackend()), userId });
  const server = createDocumentsServer(transport);
  const vaults = createDocumentsVaults({ server, store: createKeystore(memoryBackend()), account, userId, scopeMembers });
  return { userId, account, server, vaults };
}

async function phone(userKey) {
  const d = device(userKey);
  await d.account.setupPhone();
  return d;
}

async function linkedBrowser(ph, userKey = "luke") {
  const b = device(userKey);
  const code = await b.account.startLink({ label: "Chrome" });
  await ph.account.approveLink(code);
  await b.account.finishLink();
  return b;
}

const keyOf = async (d, scope) => (await d.vaults.keysFor(scope)).key;
const asOwner = (sql, params = []) => db.query(sql, params); // the server itself, no row security

describe("creating and receiving vaults", () => {
  it("the phone creates Personal and Household; a linked browser gets them once granted", async () => {
    const ph = await phone("luke");
    expect(await ph.vaults.createVault(PERSONAL)).toMatchObject({ state: "ready" });
    expect(await ph.vaults.createVault(GROUP)).toMatchObject({ state: "ready" });
    const br = await linkedBrowser(ph);
    await br.vaults.ensureBox();
    expect(await br.vaults.open(PERSONAL)).toMatchObject({ state: "waiting" });
    expect(await ph.vaults.grantPending(PERSONAL)).toBe(1);
    expect(await ph.vaults.grantPending(PERSONAL)).toBe(0); // idempotent
    expect(await br.vaults.open(PERSONAL)).toMatchObject({ state: "ready", version: 1 });
    expect(await keyOf(br, PERSONAL)).toEqual(await keyOf(ph, PERSONAL));
  });

  it("only the phone creates vaults; a vault exists once", async () => {
    const ph = await phone("luke");
    const br = await linkedBrowser(ph);
    await expect(br.vaults.createVault(PERSONAL)).rejects.toMatchObject({ code: "NOT_PHONE" });
    await ph.vaults.createVault(PERSONAL);
    await expect(ph.vaults.createVault(PERSONAL)).rejects.toMatchObject({ code: "EXISTS" });
  });

  it("Marijane gets the Household vault, never Luke's Personal one", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.createVault(GROUP);
    const her = await phone("wife");
    await her.vaults.ensureBox();
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "waiting" });
    expect(await luke.vaults.grantPending(GROUP)).toBe(1);
    expect(await luke.vaults.grantPending(PERSONAL)).toBe(0);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
    expect(await keyOf(her, GROUP)).toEqual(await keyOf(luke, GROUP));
    expect(await her.vaults.open(PERSONAL)).toMatchObject({ state: "missing" }); // row security hides it
  });
});

describe("a server that lies", () => {
  it("a grant the server made up (signed by an unknown device) is refused", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(GROUP);
    const her = await phone("wife");
    const box = await her.vaults.ensureBox();
    const herMe = await her.account.me();
    const vault = await luke.server.vault(GROUP);
    const fake = generateDevice();
    const g = createGrant({
      granter: { userId: USERS.luke, deviceId: (await luke.account.me()).deviceId, device: fake }, vaultKey: generateVaultKey(),
      ctx: { vaultId: vault.id, scope: GROUP, keyVersion: 1, recipientUserId: USERS.wife, recipientDeviceId: herMe.deviceId, recipientBoxPub: box.pub },
      removedDeviceIds: [],
    });
    await asOwner(`insert into public.doc_vault_grants (vault_id, key_version, device_id, sealed, granter_user_id, granter_device_id, granter_sig) values ($1, 1, $2, $3, $4, $5, $6)`,
      [vault.id, herMe.deviceId, toB64(g.sealed), USERS.luke, g.granterDeviceId, toB64(g.sig)]);
    await expect(her.vaults.open(GROUP)).rejects.toThrow(/signature/);
  });

  it("hiding the settled statements doesn't move a device back to an old version", async () => {
    const ph = await phone("luke");
    await ph.vaults.createVault(PERSONAL);
    const br = await linkedBrowser(ph);
    await br.vaults.ensureBox();
    await ph.vaults.grantPending(PERSONAL);
    await br.vaults.open(PERSONAL);
    await ph.vaults.rotate(PERSONAL);
    await br.vaults.open(PERSONAL);
    expect((await br.vaults.keysFor(PERSONAL)).version).toBe(2);
    await asOwner(`delete from public.doc_vault_settled`);
    expect(await br.vaults.open(PERSONAL)).toMatchObject({ state: "ready", version: 2 });
  });

  it("a settled statement signed by a device (not the identity) is ignored", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(GROUP);
    const her = await phone("wife");
    await her.vaults.ensureBox();
    await luke.vaults.grantPending(GROUP);
    await her.vaults.open(GROUP);
    const vault = await luke.server.vault(GROUP);
    await asOwner(`insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, sig) values ($1, 5, $2, $3)`, [vault.id, USERS.luke, "A".repeat(86)]);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
  });
});

describe("removing a device", () => {
  it("re-keys both vaults, re-wraps every row, cuts the removed browser off, and asks for a new code", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.createVault(GROUP);
    const br = await linkedBrowser(luke);
    await br.vaults.ensureBox();
    const her = await phone("wife");
    await her.vaults.ensureBox();
    await luke.vaults.grantPending(PERSONAL);
    await luke.vaults.grantPending(GROUP);
    await br.vaults.open(PERSONAL);
    await br.vaults.open(GROUP);
    await her.vaults.open(GROUP);

    // A folder and a file in Household at version 1.
    const k1 = await keyOf(luke, GROUP);
    const vault = await luke.server.vault(GROUP);
    const folderId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const fileKey = generateFileKey();
    await asOwner(`insert into public.doc_folders (id, scope, enc_name, key_version) values ($1, $2, $3, 1)`,
      [folderId, GROUP, toB64(encryptFolderName(k1, "Insurance", { vaultId: vault.id, scope: GROUP, folderId, keyVersion: 1 }))]);
    await asOwner(`insert into public.doc_files (id, scope, folder_id, wrapped_key, key_version, enc_meta, size) values ($1, $2, $3, $4, 1, $5, 10)`,
      [fileId, GROUP, folderId, toB64(wrapFileKey(k1, fileKey, { vaultId: vault.id, scope: GROUP, fileId, keyVersion: 1 })), "A".repeat(200)]);

    const out = await luke.vaults.removeDevice((await br.account.me()).deviceId, [PERSONAL, GROUP]);
    expect(out).toMatchObject({ rotated: [PERSONAL, GROUP], needsNewCode: true });
    expect(await luke.vaults.needsNewCode()).toBe(true);

    const k2 = await keyOf(luke, GROUP);
    expect(k2).not.toEqual(k1);
    const [file] = (await asOwner(`select wrapped_key, key_version from public.doc_files where id = $1`, [fileId])).rows;
    expect(file.key_version).toBe(2);
    expect(unwrapFileKey(k2, fromB64(file.wrapped_key), { vaultId: vault.id, scope: GROUP, fileId, keyVersion: 2 })).toEqual(fileKey);
    const [folder] = (await asOwner(`select enc_name, key_version from public.doc_folders where id = $1`, [folderId])).rows;
    expect(decryptFolderName(k2, fromB64(folder.enc_name), { vaultId: vault.id, scope: GROUP, folderId, keyVersion: 2 })).toBe("Insurance");

    // Marijane moves to version 2 with the same key; the removed browser can't.
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect(await keyOf(her, GROUP)).toEqual(k2);
    expect(await br.vaults.open(GROUP)).toMatchObject({ state: "removed" });
    await expect(br.vaults.keysFor(GROUP)).rejects.toMatchObject({ code: "LOCKED" });
    expect(await asOwner(`select count(*)::int n from public.doc_vault_grants where key_version = 2 and device_id = $1`, [(await br.account.me()).deviceId]).then((r) => r.rows[0].n)).toBe(0);
  });

  it("a grant from the removed browser is refused even if the server keeps it", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(GROUP);
    const br = await linkedBrowser(luke);
    await br.vaults.ensureBox();
    await luke.vaults.grantPending(GROUP);
    await br.vaults.open(GROUP);
    const her = await phone("wife");
    const herBox = await her.vaults.ensureBox();
    const brDevice = (await br.account.me()).deviceId;
    await luke.vaults.removeDevice(brDevice, [GROUP]);
    // The removed browser signs a grant of a key it chose at version 2, and the server
    // (lying) stores it and un-revokes the browser.
    const vault = await luke.server.vault(GROUP);
    const s = await br.account.signers();
    const herDevice = (await her.account.me()).deviceId;
    const g = createGrant({ granter: { userId: USERS.luke, deviceId: brDevice, device: s.device }, vaultKey: generateVaultKey(),
      ctx: { vaultId: vault.id, scope: GROUP, keyVersion: 2, recipientUserId: USERS.wife, recipientDeviceId: herDevice, recipientBoxPub: herBox.pub }, removedDeviceIds: [] });
    await asOwner(`delete from public.doc_vault_grants where device_id = $1`, [herDevice]);
    await db.exec("set session_replication_role = replica"); // skip the server's own guard: it's lying
    await asOwner(`update public.msg_devices set revoked_at = null where device_id = $1`, [brDevice]);
    await db.exec("set session_replication_role = origin");
    expect((await asOwner(`select revoked_at from public.msg_devices where device_id = $1`, [brDevice])).rows[0].revoked_at).toBeNull();
    await asOwner(`insert into public.doc_vault_grants (vault_id, key_version, device_id, sealed, granter_user_id, granter_device_id, granter_sig) values ($1, 2, $2, $3, $4, $5, $6)`,
      [vault.id, herDevice, toB64(g.sealed), USERS.luke, brDevice, toB64(g.sig)]);
    await expect(her.vaults.open(GROUP)).rejects.toThrow(/removed/);
  });

  it("a box key the server swapped in is never granted to", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(GROUP);
    const her = await phone("wife");
    await her.vaults.ensureBox();
    const herDevice = (await her.account.me()).deviceId;
    const planted = generateBoxKey();
    await asOwner(`update public.doc_device_boxes set box_pub = $1 where device_id = $2`, [toB64(planted.pub), herDevice]);
    expect(await luke.vaults.grantPending(GROUP)).toBe(0);
  });

  it("a linked browser can't remove devices or rotate", async () => {
    const ph = await phone("luke");
    await ph.vaults.createVault(PERSONAL);
    const br = await linkedBrowser(ph);
    await expect(br.vaults.removeDevice((await ph.account.me()).deviceId, [PERSONAL])).rejects.toMatchObject({ code: "NOT_PHONE" });
    await expect(br.vaults.rotate(PERSONAL)).rejects.toMatchObject({ code: "NOT_PHONE" });
  });

  it("an interrupted rotation resumes without a second new key", async () => {
    const ph = await phone("luke");
    await ph.vaults.createVault(PERSONAL);
    const realSettle = ph.server.addSettled;
    ph.server.addSettled = async () => { throw new Error("network"); };
    await expect(ph.vaults.rotate(PERSONAL)).rejects.toThrow(/network/);
    ph.server.addSettled = realSettle;
    expect(await ph.vaults.rotate(PERSONAL)).toEqual({ version: 2 });
    const old = (await asOwner(`select key_version from public.doc_vault_keys_old`)).rows;
    expect(old).toEqual([{ key_version: 1 }]);
    const settled = (await asOwner(`select key_version from public.doc_vault_settled order by 1`)).rows.map((r) => r.key_version);
    expect(settled).toEqual([1, 2]);
  });
});

describe("the recovery code", () => {
  it("restores both vaults on a new phone, re-keys them under the new identity, and makes a new code", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.createVault(GROUP);
    const her = await phone("wife");
    await her.vaults.ensureBox();
    await luke.vaults.grantPending(GROUP);
    await her.vaults.open(GROUP);
    const { code, generation } = await luke.vaults.newRecoveryCode([PERSONAL, GROUP]);
    expect(code).toMatch(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    expect(generation).toBe(1);
    await luke.vaults.rotate(PERSONAL); // a later rotation is sealed to the recovery key
    const personalKey = await keyOf(luke, PERSONAL);

    // Phone lost. New phone, messaging set up afresh (new identity).
    const fresh = device("luke");
    await fresh.account.setupPhone({ replaceExisting: true });
    const out = await fresh.vaults.restore(code.toLowerCase(), [PERSONAL, GROUP]);
    expect(out.results).toEqual([
      expect.objectContaining({ scope: PERSONAL, state: "restored", version: 2 }),
      expect.objectContaining({ scope: GROUP, state: "restored", version: 1 }),
    ]);
    expect(out.code).toMatch(/^([A-Z2-9]{4}-){7}/);
    expect(out.code).not.toBe(code);
    // Re-keyed under the new phone: Personal at 3, Household at 2.
    expect((await fresh.vaults.keysFor(PERSONAL)).version).toBe(3);
    expect((await fresh.vaults.keysFor(PERSONAL)).keys.get(2)).toEqual(personalKey);
    // Marijane follows Luke's new identity to Household version 2.
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect(await keyOf(her, GROUP)).toEqual(await keyOf(fresh, GROUP));
    // The old sheet no longer works: a second restore with it fails.
    const again = device("luke");
    await again.account.setupPhone({ replaceExisting: true });
    await expect(again.vaults.restore(code, [PERSONAL])).rejects.toThrow(/recovery record|couldn't open/);
  });

  it("a wrong code is refused with a clear message", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.newRecoveryCode([PERSONAL]);
    const fresh = device("luke");
    await fresh.account.setupPhone({ replaceExisting: true });
    await expect(fresh.vaults.restore("AAAA-AAAA", [PERSONAL])).rejects.toThrow(/32 characters/);
  });

  it("the recovery key only counts if this person's identity signed it, at the newest generation", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.newRecoveryCode([PERSONAL]);
    await luke.vaults.newRecoveryCode([PERSONAL]);
    // The server swaps in a recovery key of its own (bad signature) — rotation must not seal to it.
    await asOwner(`update public.doc_recovery_keys set recovery_pub = $1, generation = 9`, ["B".repeat(43)]);
    const before = (await asOwner(`select count(*)::int n from public.doc_recovery_wraps where kind = 'sealed'`)).rows[0].n;
    await luke.vaults.rotate(PERSONAL);
    expect((await asOwner(`select count(*)::int n from public.doc_recovery_wraps where kind = 'sealed'`)).rows[0].n).toBe(before);
  });
});
