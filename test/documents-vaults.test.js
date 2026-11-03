// Vault keys across devices (documents/vaults.js), end to end against a real Postgres
// with the messaging and Documents migrations and row security: creating vaults,
// granting new devices, removing a device (rotation), the recovery code, and a
// server — or a removed device, or the other member — that misbehaves.

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
  generateBoxKey, createGrant, signVaultSettled,
} from "../documents/crypto/index.js";
import { createDocumentsDatabase, pgliteTransport, USERS, GROUP } from "./documents-pglite-harness.js";

let db;
let members;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createDocumentsDatabase(); members = [USERS.luke, USERS.wife]; }, 60_000);

const scopeMembers = async (scope) => (scope === GROUP ? members : []);
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

// a verifies b (the safety-number scan in the app).
async function verify(a, b) {
  await a.account.resolveDevices([b.userId]);
  await a.account.markVerified(b.userId);
}

async function household() {
  const luke = await phone("luke");
  await luke.vaults.createVault(PERSONAL);
  await luke.vaults.createVault(GROUP);
  const her = await phone("wife");
  await her.vaults.ensureBox();
  await verify(luke, her);
  await verify(her, luke);
  await luke.vaults.grantPending(GROUP);
  await her.vaults.open(GROUP);
  return { luke, her };
}

const keyOf = async (d, scope) => (await d.vaults.keysFor(scope)).key;
const asOwner = (sql, params = []) => db.query(sql, params); // the server itself, no row security
const count = async (sql, params = []) => (await asOwner(sql, params)).rows[0].n;

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

  it("Marijane gets Household once they've verified each other; never Luke's Personal", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.createVault(GROUP);
    const her = await phone("wife");
    await her.vaults.ensureBox();
    // Not verified yet: no grant.
    expect(await luke.vaults.grantPending(GROUP)).toBe(0);
    await verify(luke, her);
    expect(await luke.vaults.grantPending(GROUP)).toBe(1);
    // She hasn't verified Luke: his grant and statement don't count yet.
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "waiting" });
    await verify(her, luke);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
    expect(await keyOf(her, GROUP)).toEqual(await keyOf(luke, GROUP));
    expect(await luke.vaults.grantPending(PERSONAL)).toBe(0);
    expect(await her.vaults.open(PERSONAL)).toMatchObject({ state: "missing" }); // row security hides it
  });
});

describe("a server that lies", () => {
  it("a grant the server made up (signed by an unknown device) is ignored", async () => {
    const { luke, her } = await household();
    const vault = await luke.server.vault(GROUP);
    await luke.vaults.rotate(GROUP);
    // Wipe her real v2 grant and plant a forged one.
    const herMe = await her.account.me();
    await asOwner(`delete from public.doc_vault_grants where device_id = $1 and key_version = 2`, [herMe.deviceId]);
    const box = await her.vaults.ensureBox();
    const g = createGrant({
      granter: { userId: USERS.luke, deviceId: (await luke.account.me()).deviceId, device: generateDevice() }, vaultKey: generateVaultKey(),
      ctx: { vaultId: vault.id, scope: GROUP, keyVersion: 2, recipientUserId: USERS.wife, recipientDeviceId: herMe.deviceId, recipientBoxPub: box.pub },
      removedDeviceIds: [],
    });
    await asOwner(`insert into public.doc_vault_grants (vault_id, key_version, device_id, sealed, granter_user_id, granter_device_id, granter_sig) values ($1, 2, $2, $3, $4, $5, $6)`,
      [vault.id, herMe.deviceId, toB64(g.sealed), USERS.luke, g.granterDeviceId, toB64(g.sig)]);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "waiting", version: 2 });
    // Luke's phone notices she has no valid grant and gives her one.
    expect(await luke.vaults.grantPending(GROUP)).toBe(1);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect(await keyOf(her, GROUP)).toEqual(await keyOf(luke, GROUP));
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

  it("a settled statement signed with a DEVICE key (not the identity) is ignored", async () => {
    const { luke, her } = await household();
    const vault = await luke.server.vault(GROUP);
    const s = await luke.account.signers();
    const st = { userId: USERS.luke, vaultId: vault.id, scope: GROUP, keyVersion: 5, removedDeviceIds: [] };
    const sig = signVaultSettled({ signPriv: s.device.signPriv }, st);
    await asOwner(`insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, sig) values ($1, 5, $2, $3)`, [vault.id, USERS.luke, toB64(sig)]);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
  });

  it("a person the server says is a member, but nobody verified, gets nothing", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(GROUP);
    const intruder = await phone("stranger");
    await intruder.vaults.ensureBox().catch(() => {});
    members = [USERS.luke, USERS.wife, USERS.stranger]; // the server's list grows
    await asOwner(`insert into public.live_group_members (group_id, user_id) values ($1, $2)`, [GROUP, USERS.stranger]);
    await intruder.vaults.ensureBox();
    expect(await luke.vaults.grantPending(GROUP)).toBe(0);
    expect(await count(`select count(*)::int n from public.doc_vault_grants where device_id = $1`, [(await intruder.account.me()).deviceId])).toBe(0);
  });

  it("when a verified person's identity changes (a reset the server could fake), they get nothing until verified again", async () => {
    const { luke, her } = await household();
    const herNew = device("wife");
    await herNew.account.setupPhone({ replaceExisting: true }); // new identity for Marijane
    await herNew.vaults.ensureBox();
    expect(await luke.vaults.grantPending(GROUP)).toBe(0);
    // Her new identity's statements are ignored too: it can't remove Luke's phone or set a version.
    const vault = await luke.server.vault(GROUP);
    const s = await herNew.account.signers();
    const st = { userId: USERS.wife, vaultId: vault.id, scope: GROUP, keyVersion: 7, removedDeviceIds: [(await luke.account.me()).deviceId] };
    await asOwner(`insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, removed_device_ids, sig) values ($1, 7, $2, $3, $4)`,
      [vault.id, USERS.wife, st.removedDeviceIds, toB64(signVaultSettled(s.identity, st))]);
    expect(await luke.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
    expect(her).toBeTruthy();
  });
});

describe("one member can't cut off the other", () => {
  it("Marijane's statement can't remove Luke's devices, and doesn't delete his keys", async () => {
    const { luke, her } = await household();
    const vault = await luke.server.vault(GROUP);
    const s = await her.account.signers();
    const st = { userId: USERS.wife, vaultId: vault.id, scope: GROUP, keyVersion: 1, removedDeviceIds: [(await luke.account.me()).deviceId] };
    await asOwner(`insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, removed_device_ids, sig) values ($1, 1, $2, $3, $4)`,
      [vault.id, USERS.wife, st.removedDeviceIds, toB64(signVaultSettled(s.identity, st))]);
    expect(await luke.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
  });

  it("a higher version with no grant only makes a device wait; it keeps its keys and recovers", async () => {
    const { luke, her } = await household();
    const vault = await luke.server.vault(GROUP);
    const s = await her.account.signers();
    const st = { userId: USERS.wife, vaultId: vault.id, scope: GROUP, keyVersion: 99, removedDeviceIds: [] };
    await asOwner(`insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, sig) values ($1, 99, $2, $3)`, [vault.id, USERS.wife, toB64(signVaultSettled(s.identity, st))]);
    expect(await luke.vaults.open(GROUP)).toMatchObject({ state: "waiting", version: 99 });
    await expect(luke.vaults.keysFor(GROUP)).rejects.toMatchObject({ code: "LOCKED" });
    expect(await luke.vaults.status(GROUP)).toMatchObject({ state: "waiting" });
  });
});

describe("removing a device", () => {
  async function withBrowser() {
    const { luke, her } = await household();
    const br = await linkedBrowser(luke);
    await br.vaults.ensureBox();
    await luke.vaults.grantPending(PERSONAL);
    await luke.vaults.grantPending(GROUP);
    await br.vaults.open(PERSONAL);
    await br.vaults.open(GROUP);
    return { luke, her, br, brDevice: (await br.account.me()).deviceId };
  }

  it("re-keys both vaults, re-wraps every row, cuts the removed browser off, and asks for a new code", async () => {
    const { luke, her, br, brDevice } = await withBrowser();
    const k1 = await keyOf(luke, GROUP);
    const vault = await luke.server.vault(GROUP);
    const folderId = crypto.randomUUID();
    const fileId = crypto.randomUUID();
    const fileKey = generateFileKey();
    await asOwner(`insert into public.doc_folders (id, scope, enc_name, key_version) values ($1, $2, $3, 1)`,
      [folderId, GROUP, toB64(encryptFolderName(k1, "Insurance", { vaultId: vault.id, scope: GROUP, folderId, keyVersion: 1 }))]);
    await asOwner(`insert into public.doc_files (id, scope, folder_id, wrapped_key, key_version, enc_meta, size) values ($1, $2, $3, $4, 1, $5, 10)`,
      [fileId, GROUP, folderId, toB64(wrapFileKey(k1, fileKey, { vaultId: vault.id, scope: GROUP, fileId, keyVersion: 1 })), "A".repeat(200)]);

    const out = await luke.vaults.removeDevice(brDevice, [PERSONAL, GROUP]);
    expect(out).toMatchObject({ rotated: [PERSONAL, GROUP], needsNewCode: true });
    expect(await luke.vaults.needsNewCode()).toBe(true);

    const k2 = await keyOf(luke, GROUP);
    expect(k2).not.toEqual(k1);
    const [file] = (await asOwner(`select wrapped_key, key_version from public.doc_files where id = $1`, [fileId])).rows;
    expect(file.key_version).toBe(2);
    expect(unwrapFileKey(k2, fromB64(file.wrapped_key), { vaultId: vault.id, scope: GROUP, fileId, keyVersion: 2 })).toEqual(fileKey);
    const [folder] = (await asOwner(`select enc_name, key_version from public.doc_folders where id = $1`, [folderId])).rows;
    expect(decryptFolderName(k2, fromB64(folder.enc_name), { vaultId: vault.id, scope: GROUP, folderId, keyVersion: 2 })).toBe("Insurance");

    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect(await keyOf(her, GROUP)).toEqual(k2);
    expect(await br.vaults.open(GROUP)).toMatchObject({ state: "removed" });
    await expect(br.vaults.keysFor(GROUP)).rejects.toMatchObject({ code: "LOCKED" });
    expect(await count(`select count(*)::int n from public.doc_vault_grants where key_version = 2 and device_id = $1`, [brDevice])).toBe(0);
    expect((await luke.server.vault(GROUP)).key_version).toBe(2); // the hint follows
  });

  it("a grant from the removed browser is refused even if the server un-revokes it", async () => {
    const { luke, her, br, brDevice } = await withBrowser();
    await luke.vaults.removeDevice(brDevice, [GROUP]);
    const vault = await luke.server.vault(GROUP);
    const s = await br.account.signers();
    const herDevice = (await her.account.me()).deviceId;
    const herBox = await her.vaults.ensureBox();
    const g = createGrant({ granter: { userId: USERS.luke, deviceId: brDevice, device: s.device }, vaultKey: generateVaultKey(),
      ctx: { vaultId: vault.id, scope: GROUP, keyVersion: 2, recipientUserId: USERS.wife, recipientDeviceId: herDevice, recipientBoxPub: herBox.pub }, removedDeviceIds: [] });
    await asOwner(`delete from public.doc_vault_grants where device_id = $1`, [herDevice]);
    await db.exec("set session_replication_role = replica"); // skip the server's own guard: it's lying
    await asOwner(`update public.msg_devices set revoked_at = null where device_id = $1`, [brDevice]);
    await db.exec("set session_replication_role = origin");
    await asOwner(`insert into public.doc_vault_grants (vault_id, key_version, device_id, sealed, granter_user_id, granter_device_id, granter_sig) values ($1, 2, $2, $3, $4, $5, $6)`,
      [vault.id, herDevice, toB64(g.sealed), USERS.luke, brDevice, toB64(g.sig)]);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "waiting", version: 2 });
  });

  it("junk rows written first (old key, grant, settled) don't stop the rotation", async () => {
    const { luke, her, brDevice } = await withBrowser();
    const vault = await luke.server.vault(GROUP);
    const herDevice = (await her.account.me()).deviceId;
    // The removed browser's session (still Luke) writes junk at the next version first.
    await asOwner(`insert into public.doc_vault_keys_old (vault_id, key_version, wrapped) values ($1, 1, $2)`, [vault.id, "A".repeat(98)]);
    await asOwner(`insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, sig) values ($1, 2, $2, $3)`, [vault.id, USERS.luke, "A".repeat(86)]);
    await asOwner(`insert into public.doc_vault_grants (vault_id, key_version, device_id, sealed, granter_user_id, granter_device_id, granter_sig) values ($1, 2, $2, $3, $4, $5, $6)`,
      [vault.id, herDevice, "A".repeat(200), USERS.luke, (await luke.account.me()).deviceId, "A".repeat(86)]);
    await luke.vaults.removeDevice(brDevice, [GROUP]);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect(await keyOf(her, GROUP)).toEqual(await keyOf(luke, GROUP));
  });

  it("an unreadable file row doesn't stop the removal; it stays hidden", async () => {
    const { luke, br, brDevice } = await withBrowser();
    await asOwner(`insert into public.doc_files (id, scope, wrapped_key, key_version, enc_meta, size) values ($1, $2, $3, 1, $4, 10)`,
      [crypto.randomUUID(), GROUP, "A".repeat(98), "A".repeat(200)]);
    const out = await luke.vaults.removeDevice(brDevice, [GROUP]);
    expect(out.rotated).toEqual([GROUP]);
    expect(await br.vaults.open(GROUP)).toMatchObject({ state: "removed" });
    // and removing again (already removed) just finishes
    expect((await luke.vaults.removeDevice(brDevice, [GROUP])).rotated).toEqual([GROUP]);
  });

  it("only devices of mine can be removed", async () => {
    const { luke, her } = await household();
    await expect(luke.vaults.removeDevice((await her.account.me()).deviceId, [GROUP])).rejects.toMatchObject({ code: "NOT_MINE" });
  });

  it("a linked browser can't remove devices or rotate", async () => {
    const ph = await phone("luke");
    await ph.vaults.createVault(PERSONAL);
    const br = await linkedBrowser(ph);
    await expect(br.vaults.removeDevice((await ph.account.me()).deviceId, [PERSONAL])).rejects.toMatchObject({ code: "NOT_PHONE" });
    await expect(br.vaults.rotate(PERSONAL)).rejects.toMatchObject({ code: "NOT_PHONE" });
  });

  it("an interrupted rotation resumes without a second new key (failing at the settled step)", async () => {
    const ph = await phone("luke");
    await ph.vaults.createVault(PERSONAL);
    const real = ph.server.addSettled;
    ph.server.addSettled = async () => { throw new Error("network"); };
    await expect(ph.vaults.rotate(PERSONAL)).rejects.toThrow(/network/);
    ph.server.addSettled = real;
    expect(await ph.vaults.rotate(PERSONAL)).toMatchObject({ version: 2 });
    expect((await asOwner(`select key_version from public.doc_vault_keys_old`)).rows).toEqual([{ key_version: 1 }]);
    expect((await asOwner(`select key_version from public.doc_vault_settled order by 1`)).rows.map((r) => r.key_version)).toEqual([1, 2]);
  });

  it("…and failing after the settled step (the hint): the next rotation carries on from there", async () => {
    const ph = await phone("luke");
    await ph.vaults.createVault(PERSONAL);
    const real = ph.server.setVaultVersion;
    ph.server.setVaultVersion = async () => { throw new Error("network"); };
    expect(await ph.vaults.rotate(PERSONAL)).toMatchObject({ version: 2 }); // the hint is advisory
    ph.server.setVaultVersion = real;
    expect(await ph.vaults.rotate(PERSONAL)).toMatchObject({ version: 3 });
    expect((await asOwner(`select key_version from public.doc_vault_settled order by 1`)).rows.map((r) => r.key_version)).toEqual([1, 2, 3]);
    expect((await ph.server.vault(PERSONAL)).key_version).toBe(3);
  });

  it("a second removal during an unfinished rotation is included in it", async () => {
    const { luke } = await household();
    const b1 = await linkedBrowser(luke);
    const b2 = await linkedBrowser(luke);
    const ids = [(await b1.account.me()).deviceId, (await b2.account.me()).deviceId];
    const real = luke.server.addSettled;
    luke.server.addSettled = async () => { throw new Error("network"); };
    await expect(luke.vaults.removeDevice(ids[0], [GROUP])).rejects.toThrow(/network/);
    luke.server.addSettled = real;
    await luke.vaults.removeDevice(ids[1], [GROUP]);
    const rows = (await asOwner(`select removed_device_ids from public.doc_vault_settled where key_version = 2`)).rows;
    expect(rows).toHaveLength(1);
    expect([...rows[0].removed_device_ids].sort()).toEqual([...ids].sort());
  });
});

describe("the recovery code", () => {
  it("restores both vaults on a new phone, re-keys them under the new identity with every old device removed, and makes a new code", async () => {
    const { luke, her } = await household();
    const br = await linkedBrowser(luke);
    const brDevice = (await br.account.me()).deviceId;
    const { code, generation } = await luke.vaults.newRecoveryCode([PERSONAL, GROUP]);
    expect(code).toMatch(/^([A-Z2-9]{4}-){7}[A-Z2-9]{4}$/);
    expect(generation).toBe(1);
    await luke.vaults.rotate(PERSONAL); // a later rotation is sealed to the recovery key
    const personalKey = await keyOf(luke, PERSONAL);
    const oldPhone = (await luke.account.me()).deviceId;

    const fresh = device("luke");
    await fresh.account.setupPhone({ replaceExisting: true });
    await asOwner(`update public.doc_vaults set key_version = key_version + 1`); // the hint can't fool it
    const out = await fresh.vaults.restore(code.toLowerCase(), [PERSONAL, GROUP]);
    expect(out.results).toEqual([
      expect.objectContaining({ scope: PERSONAL, state: "restored", version: 2 }),
      expect.objectContaining({ scope: GROUP, state: "restored", version: 1 }),
    ]);
    expect(out.code).toMatch(/^([A-Z2-9]{4}-){7}/);
    expect(out.code).not.toBe(code);
    expect((await fresh.vaults.keysFor(PERSONAL)).version).toBe(3);
    expect((await fresh.vaults.keysFor(PERSONAL)).keys.get(2)).toEqual(personalKey);
    const removed = (await asOwner(`select removed_device_ids from public.doc_vault_settled where key_version = 3`)).rows[0].removed_device_ids;
    expect(removed).toEqual(expect.arrayContaining([oldPhone, brDevice]));
    // Marijane follows Luke's new identity once she's verified it again.
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 1 });
    await verify(her, fresh);
    await verify(fresh, her);
    await fresh.vaults.grantPending(GROUP);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect(await keyOf(her, GROUP)).toEqual(await keyOf(fresh, GROUP));
    // The old sheet no longer works.
    const again = device("luke");
    await again.account.setupPhone({ replaceExisting: true });
    await expect(again.vaults.restore(code, [PERSONAL])).rejects.toMatchObject({ code: "WRONG_CODE" });
  });

  it("a wrong code is refused with a clear message; no wraps means 'not covered', not a crash", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    const { code } = await luke.vaults.newRecoveryCode([PERSONAL]);
    const fresh = device("luke");
    await fresh.account.setupPhone({ replaceExisting: true });
    await expect(fresh.vaults.restore("AAAA-AAAA", [PERSONAL])).rejects.toThrow(/32 characters/);
    await asOwner(`delete from public.doc_recovery_wraps`);
    expect(await fresh.vaults.restore(code, [PERSONAL])).toEqual({ results: [{ scope: PERSONAL, state: "not-covered" }], code: null });
  });

  it("a recovery key the server swapped in isn't sealed to; the next code still works", async () => {
    const luke = await phone("luke");
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.newRecoveryCode([PERSONAL]);
    await luke.vaults.newRecoveryCode([PERSONAL]);
    // Swap in a key of the server's own (bad signature, next generation — the table insists on +1).
    await asOwner(`update public.doc_recovery_keys set recovery_pub = $1, generation = generation + 1`, ["B".repeat(43)]);
    const before = await count(`select count(*)::int n from public.doc_recovery_wraps where kind = 'sealed'`);
    await luke.vaults.rotate(PERSONAL);
    expect(await count(`select count(*)::int n from public.doc_recovery_wraps where kind = 'sealed'`)).toBe(before);
    const { generation } = await luke.vaults.newRecoveryCode([PERSONAL]);
    expect(generation).toBe(4);
  });
});
