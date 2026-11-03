// Vault keys on this device (DOCUMENTS_DESIGN.md §3): creating a vault, receiving
// its key, handing it to other devices, rotating it when a device is removed, and
// the printed recovery code.
//
// Builds on the messaging account (messaging/account.js): its devices, certificates
// verified against PINNED identities (resolveDevices), and its signing keys
// (signers). Everything the server returns is checked here before it's used:
//   - a vault's version is the highest one an identity-signed "settled" statement
//     proves (never the server's key_version);
//   - a grant is opened only at a settled version, only if its granter's device is
//     certified by a pinned identity of a person who may hold the scope, and only
//     if neither end is on a removed list;
//   - the recovery key is used only if this person's own identity signed it, at the
//     highest generation this device has seen.
//
// What needs the person's IDENTITY (the phone): creating a vault, rotating it
// (device removal), and the recovery code. Any device holding a vault can grant it.
//
// Store (a messaging/keystore.js keystore of its own):
//   box                 this device's box key pair
//   vault:<scope>       { vaultId, scope, current, settled, removed, keys: { v: key } }
//   rotation:<scope>    a rotation in progress (resumed if interrupted)
//   recoveryGen         highest recovery generation seen for this person

import { toB64, fromB64, equalBytes } from "../messaging/crypto/bytes.js";
import {
  generateVaultKey, rotateVault, unlockKeyring, unwrapFileKey, wrapFileKey, decryptFolderName, encryptFolderName,
  generateBoxKey, signBoxKey, verifyBoxKey, createGrant, openGrant,
  signVaultSettled, verifyVaultSettled, signRecoveryPub, verifyRecoveryPub,
  generateRecoveryCode, deriveRecoveryKeys, wrapAnchor, sealToRecovery, restoreVaultKey,
  newRecoveryParams, encodeRecoveryParams, decodeRecoveryParams,
} from "./crypto/index.js";

export class DocumentsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const personalScope = (userId) => `u-${userId}`;

// scopeMembers(scope) → user ids who may hold the scope (Household: the group's
// members; the app knows them). Personal is always just its owner.
export function createDocumentsVaults({ server, store, account, userId, scopeMembers, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  // Personal scopes ("u-<uid>") belong to exactly one person, whatever scopeMembers says.
  const membersOf = async (scope) => (/^u-[0-9a-f-]{36}$/i.test(scope) ? [scope.slice(2).toLowerCase()] : [...new Set(await scopeMembers(scope))]);

  async function signers() { return account.signers(); }

  // ---- box key ----------------------------------------------------------------------------

  async function ensureBox() {
    const s = await signers();
    let box = await store.get("box");
    if (!box || box.deviceId !== s.deviceId) {
      box = { deviceId: s.deviceId, ...generateBoxKey() };
      await store.set("box", box);
    }
    const rows = await server.boxes([userId]);
    if (!rows.some((r) => r.device_id === s.deviceId)) {
      const sig = signBoxKey(s.device, { userId, deviceId: s.deviceId, boxPub: box.pub });
      await server.addBox({ device_id: s.deviceId, user_id: userId, box_pub: toB64(box.pub), box_sig: toB64(sig) });
    }
    return box;
  }

  // ---- trust helpers --------------------------------------------------------------------------

  // Verified live devices of these people, keyed by device id.
  async function verifiedDevices(userIds) {
    const { people } = await account.resolveDevices(userIds);
    const out = new Map();
    for (const uid of userIds) for (const d of people[uid]?.devices || []) out.set(d.deviceId, d);
    return { people, devices: out };
  }

  // Settled statements that verify against a pinned identity of a member.
  async function provenSettled(vault, scope, members) {
    const rows = await server.settled(vault.id);
    const signers = [...new Set(rows.map((r) => r.signer_user_id))].filter((u) => members.includes(u));
    const { people } = signers.length ? await account.resolveDevices(signers) : { people: {} };
    const out = [];
    for (const r of rows) {
      const ident = people[r.signer_user_id]?.identitySignPub;
      if (!ident) continue;
      const statement = { userId: r.signer_user_id, vaultId: vault.id, scope, keyVersion: r.key_version, removedDeviceIds: r.removed_device_ids || [] };
      if (verifyVaultSettled(ident, statement, fromB64(r.sig))) out.push(statement);
    }
    return out;
  }

  async function saveVault(v) { await store.set(`vault:${v.scope}`, v); return v; }
  const localVault = (scope) => store.get(`vault:${scope}`);

  function keyAt(v, version) {
    const k = v?.keys?.[version];
    return k ? fromB64(k) : null;
  }

  // ---- creating a vault (phone) ---------------------------------------------------------------

  async function createVault(scope) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Set up Documents on your phone first.");
    if (!(await membersOf(scope)).includes(userId)) throw new DocumentsError("NOT_MEMBER", "You can't hold this scope.");
    if (await server.vault(scope)) throw new DocumentsError("EXISTS", "This vault already exists.");
    const box = await ensureBox();
    const vaultId = newId();
    const key = generateVaultKey();
    await server.createVault(vaultId, scope);
    const v = await saveVault({ vaultId, scope, current: 1, settled: 1, removed: [], keys: { 1: toB64(key) } });
    await grantTo(v, key, 1, [{ userId, deviceId: s.deviceId, boxPub: box.pub }], s);
    await settle(v, 1, [], s);
    return status(scope);
  }

  // ---- opening a vault on this device ------------------------------------------------------------

  // Returns { state: "missing" | "waiting" | "ready", vaultId, version }.
  async function open(scope) {
    const vault = await server.vault(scope);
    if (!vault) return { state: "missing" };
    const members = await membersOf(scope);
    if (!members.includes(userId)) throw new DocumentsError("NOT_MEMBER", "You can't hold this scope.");
    let v = (await localVault(scope)) || { vaultId: vault.id, scope, current: 0, settled: 0, removed: [], keys: {} };
    if (v.vaultId !== vault.id) throw new DocumentsError("VAULT_CHANGED", "This vault was replaced on the server.");

    const proven = await provenSettled(vault, scope, members);
    const settled = Math.max(v.settled || 0, ...proven.map((p) => p.keyVersion));
    const removed = [...new Set([...(v.removed || []), ...proven.flatMap((p) => p.removedDeviceIds)])];
    v = { ...v, settled, removed };
    if (!settled) return { state: "waiting", vaultId: vault.id };
    const me = await signers();
    if (removed.includes(me.deviceId)) {
      // This device was removed: forget the vault's keys here.
      await store.remove(`vault:${scope}`);
      return { state: "removed", vaultId: vault.id };
    }

    if (!keyAt(v, settled)) {
      const s = me;
      const box = await ensureBox();
      const g = await server.myGrant(vault.id, settled, s.deviceId);
      if (!g) { await saveVault(v); return { state: "waiting", vaultId: vault.id, version: settled }; }
      if (!members.includes(g.granter_user_id)) throw new DocumentsError("BAD_GRANT", "That key came from someone outside this vault.");
      const { devices } = await verifiedDevices([g.granter_user_id]);
      const granter = devices.get(g.granter_device_id);
      if (!granter || granter.userId !== g.granter_user_id) throw new DocumentsError("BAD_GRANT", "That key came from a device this phone doesn't trust.");
      const key = openGrant({
        grant: { sealed: fromB64(g.sealed), sig: fromB64(g.granter_sig), granterUserId: g.granter_user_id, granterDeviceId: g.granter_device_id },
        ctx: { vaultId: vault.id, scope, keyVersion: settled, recipientUserId: userId, recipientDeviceId: s.deviceId, recipientBoxPub: box.pub },
        box, granterSignPub: granter.signPub, removedDeviceIds: removed,
      });
      v.keys = { ...v.keys, [settled]: toB64(key) };
    }
    v.current = Math.max(v.current || 0, settled);
    // Older versions for rows a rotation hasn't re-wrapped yet.
    const missingOlder = Array.from({ length: settled - 1 }, (_, i) => i + 1).some((n) => !v.keys[n]);
    if (missingOlder) {
      const ring = unlockKeyring({ vaultId: vault.id, scope, current: { key: keyAt(v, settled), version: settled }, oldRows: (await server.oldKeys(vault.id)).map((r) => ({ version: r.key_version, wrapped: fromB64(r.wrapped) })) });
      for (const [n, k] of ring) v.keys[n] = toB64(k);
    }
    await saveVault(v);
    await topUpRecovery(v);
    return { state: "ready", vaultId: vault.id, version: settled };
  }

  async function status(scope) {
    const v = await localVault(scope);
    return v && keyAt(v, v.settled) ? { state: "ready", vaultId: v.vaultId, version: v.settled } : { state: v ? "waiting" : "none" };
  }

  // The keys the files layer needs: current key and version, plus older versions
  // (to re-wrap only). Rows below `settled` must not be shown (rowVersionAllowed).
  async function keysFor(scope) {
    const v = await localVault(scope);
    if (!v || !keyAt(v, v.settled)) throw new DocumentsError("LOCKED", "This device doesn't hold this vault yet.");
    const keys = new Map(Object.entries(v.keys).map(([n, k]) => [Number(n), fromB64(k)]));
    return { vaultId: v.vaultId, scope, version: v.settled, settled: v.settled, key: keys.get(v.settled), keys };
  }

  // ---- granting ----------------------------------------------------------------------------------

  async function grantTo(v, key, version, recipients, s) {
    const rows = recipients.map((r) => {
      const g = createGrant({
        granter: { userId, deviceId: s.deviceId, device: s.device }, vaultKey: key,
        ctx: { vaultId: v.vaultId, scope: v.scope, keyVersion: version, recipientUserId: r.userId, recipientDeviceId: r.deviceId, recipientBoxPub: r.boxPub },
        removedDeviceIds: v.removed || [],
      });
      return { vault_id: v.vaultId, key_version: version, device_id: r.deviceId, sealed: toB64(g.sealed), granter_user_id: userId, granter_device_id: s.deviceId, granter_sig: toB64(g.sig) };
    });
    await server.addGrants(rows);
    return rows.length;
  }

  // Devices of the scope's members that don't hold the key yet: verified certificate,
  // verified box key, not removed. Returns how many were granted.
  async function grantPending(scope, { version, key } = {}) {
    const s = await signers();
    const v = await localVault(scope);
    const ver = version || v?.settled;
    const k = key || keyAt(v, ver);
    if (!v || !k) throw new DocumentsError("LOCKED", "This device doesn't hold this vault yet.");
    const members = await membersOf(scope);
    const [{ devices }, boxes, granted] = await Promise.all([verifiedDevices(members), server.boxes(members), server.grantsAt(v.vaultId, ver)]);
    const have = new Set(granted.map((g) => g.device_id));
    const recipients = [];
    for (const b of boxes) {
      const d = devices.get(b.device_id);
      if (!d || d.userId !== b.user_id || have.has(b.device_id) || (v.removed || []).includes(b.device_id)) continue;
      const boxPub = fromB64(b.box_pub);
      if (!verifyBoxKey(d.signPub, { userId: d.userId, deviceId: d.deviceId, boxPub }, fromB64(b.box_sig))) continue;
      recipients.push({ userId: d.userId, deviceId: d.deviceId, boxPub });
    }
    return recipients.length ? grantTo(v, k, ver, recipients, s) : 0;
  }

  // ---- settled statements and rotation (phone) -----------------------------------------------------

  async function settle(v, version, removed, s) {
    const statement = { userId, vaultId: v.vaultId, scope: v.scope, keyVersion: version, removedDeviceIds: removed };
    const sig = signVaultSettled(s.identity, statement);
    await server.addSettled({ vault_id: v.vaultId, key_version: version, signer_user_id: userId, removed_device_ids: [...new Set(removed)], sig: toB64(sig) });
  }

  // New key version for `scope`; `removedDeviceIds` are added to the removed list.
  // Order (each step resumable): old key row → grants → re-wrap rows → settled →
  // vault version → recovery. Readers only move once the settled statement exists,
  // and by then every row is at the new version.
  async function rotate(scope, removedDeviceIds = []) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Only your phone can do this.");
    await open(scope);
    let v = await localVault(scope);
    if (!v || !keyAt(v, v.settled)) throw new DocumentsError("LOCKED", "This device doesn't hold this vault yet.");
    let r = await store.get(`rotation:${scope}`);
    if (!r || r.from !== v.settled) {
      const next = rotateVault({ vaultId: v.vaultId, scope, key: keyAt(v, v.settled), version: v.settled });
      r = { from: v.settled, version: next.version, key: toB64(next.key), oldWrapped: toB64(next.oldRow.wrapped), removed: [...new Set([...(v.removed || []), ...removedDeviceIds])], step: 0 };
      await store.set(`rotation:${scope}`, r);
    }
    const newKey = fromB64(r.key);
    v = { ...v, removed: r.removed, keys: { ...v.keys, [r.version]: r.key } };
    await saveVault(v);
    if (r.step < 1) {
      if (!(await server.oldKeys(v.vaultId)).some((o) => o.key_version === r.from)) await server.addOldKey(v.vaultId, r.from, r.oldWrapped);
      r.step = 1; await store.set(`rotation:${scope}`, r);
    }
    if (r.step < 2) {
      await grantPending(scope, { version: r.version, key: newKey });
      r.step = 2; await store.set(`rotation:${scope}`, r);
    }
    if (r.step < 3) {
      const ring = new Map(Object.entries(v.keys).map(([n, k]) => [Number(n), fromB64(k)]));
      for (const f of await server.fileKeys(scope)) {
        if (f.key_version === r.version) continue;
        const from = ring.get(f.key_version);
        if (!from) continue; // can't open it either; it stays hidden below the settled version
        const fk = unwrapFileKey(from, fromB64(f.wrapped_key), { vaultId: v.vaultId, scope, fileId: f.id, keyVersion: f.key_version });
        await server.rewrapFile(f.id, toB64(wrapFileKey(newKey, fk, { vaultId: v.vaultId, scope, fileId: f.id, keyVersion: r.version })), r.version);
      }
      for (const f of await server.folderNames(scope)) {
        if (f.key_version === r.version) continue;
        const from = ring.get(f.key_version);
        if (!from) continue;
        const name = decryptFolderName(from, fromB64(f.enc_name), { vaultId: v.vaultId, scope, folderId: f.id, keyVersion: f.key_version });
        await server.rewrapFolder(f.id, toB64(encryptFolderName(newKey, name, { vaultId: v.vaultId, scope, folderId: f.id, keyVersion: r.version })), r.version);
      }
      r.step = 3; await store.set(`rotation:${scope}`, r);
    }
    if (r.step < 4) {
      if (!(await server.settled(v.vaultId)).some((x) => x.key_version === r.version)) await settle(v, r.version, r.removed, s);
      r.step = 4; await store.set(`rotation:${scope}`, r);
    }
    const vault = await server.vault(scope);
    if (vault && vault.key_version < r.version) await server.setVaultVersion(v.vaultId, r.version);
    await saveVault({ ...v, current: r.version, settled: r.version });
    await store.remove(`rotation:${scope}`);
    await topUpRecovery(await localVault(scope));
    return { version: r.version };
  }

  // Phone: remove a device of mine, re-key every vault it could open, and require a
  // new recovery code (§3.4). Returns the scopes rotated.
  async function removeDevice(deviceId, scopes) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Only your phone can remove a device.");
    if (deviceId === s.deviceId) throw new DocumentsError("IS_THIS_DEVICE", "This phone can't remove itself.");
    await account.removeDevice(deviceId);
    const rotated = [];
    for (const scope of scopes) {
      if (!(await localVault(scope))) continue;
      await rotate(scope, [deviceId]);
      rotated.push(scope);
    }
    await store.set("needsNewCode", true);
    return { rotated, needsNewCode: true };
  }

  // ---- recovery (phone) ---------------------------------------------------------------------------

  async function verifiedRecoveryKey() {
    const row = await server.recoveryKey(userId);
    if (!row) return null;
    const s = await signers();
    const params = decodeRecoveryParams(fromB64(row.params));
    const statement = { userId, recoveryPub: fromB64(row.recovery_pub), params, generation: row.generation };
    if (!verifyRecoveryPub(s.identitySignPub, statement, fromB64(row.sig))) return null;
    const seen = (await store.get("recoveryGen")) || 0;
    if (row.generation < seen) return null;
    if (row.generation > seen) await store.set("recoveryGen", row.generation);
    return statement;
  }

  // After a key change, the new key is sealed to my recovery key (if I have one), so a
  // restore reaches it. Any of my devices can do this; it needs no code.
  async function topUpRecovery(v) {
    if (!v || !keyAt(v, v.settled)) return;
    const rk = await verifiedRecoveryKey();
    if (!rk) return;
    const wraps = await server.recoveryWraps(userId);
    if (wraps.some((w) => w.vault_id === v.vaultId && w.key_version >= v.settled)) return;
    const sealed = sealToRecovery(rk.recoveryPub, keyAt(v, v.settled), { userId, vaultId: v.vaultId, scope: v.scope, keyVersion: v.settled });
    await server.addRecoveryWrap({ user_id: userId, vault_id: v.vaultId, key_version: v.settled, kind: "sealed", wrapped: toB64(sealed) });
  }

  // Makes a new recovery code covering every vault this device holds. Returns the code
  // to show and print once; it's never stored.
  async function newRecoveryCode(scopes) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Make the recovery code on your phone.");
    const held = [];
    for (const scope of scopes) {
      const v = await localVault(scope);
      if (v && keyAt(v, v.settled)) held.push(v);
    }
    if (!held.length) throw new DocumentsError("NOTHING", "Set up Documents first.");
    const code = generateRecoveryCode();
    const params = newRecoveryParams();
    const keys = deriveRecoveryKeys(code, params);
    const existing = await server.recoveryKey(userId);
    const generation = Math.max(existing?.generation || 0, (await store.get("recoveryGen")) || 0) + 1;
    const statement = { userId, recoveryPub: keys.recoveryPub, params, generation };
    const row = { recovery_pub: toB64(keys.recoveryPub), params: toB64(encodeRecoveryParams(params)), sig: toB64(signRecoveryPub(s.identity, statement)), generation };
    if (existing) await server.replaceRecoveryKey(userId, row);
    else await server.addRecoveryKey({ user_id: userId, ...row });
    await store.set("recoveryGen", generation);
    for (const v of held) {
      await server.removeRecoveryWraps(userId, v.vaultId);
      await server.addRecoveryWrap({ user_id: userId, vault_id: v.vaultId, key_version: v.settled, kind: "anchor", wrapped: toB64(wrapAnchor(keys.anchorKey, keyAt(v, v.settled), { userId, vaultId: v.vaultId, scope: v.scope, keyVersion: v.settled })) });
    }
    await store.remove("needsNewCode");
    return { code, generation, vaults: held.map((v) => v.scope) };
  }

  // On a new phone (messaging set up afresh): unlock each vault from the code, then
  // re-key it under this phone's identity (the old devices are gone) and make a new
  // code. A SHORT restore (newer keys couldn't be proven) is reported and no new code
  // is made, so the old sheet still reaches what it can.
  async function restore(codeText, scopes) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Restore on your phone.");
    const row = await server.recoveryKey(userId);
    if (!row) throw new DocumentsError("NO_RECOVERY", "No recovery code was set up for Documents.");
    const keys = deriveRecoveryKeys(codeText, decodeRecoveryParams(fromB64(row.params)));
    const wraps = await server.recoveryWraps(userId);
    const results = [];
    for (const scope of scopes) {
      const vault = await server.vault(scope);
      if (!vault) continue;
      const mine = wraps.filter((w) => w.vault_id === vault.id);
      const anchors = mine.filter((w) => w.kind === "anchor");
      if (!anchors.length) { results.push({ scope, state: "not-covered" }); continue; }
      const anchor = anchors.sort((a, b) => b.key_version - a.key_version)[0];
      const out = restoreVaultKey({
        keys, base: { userId, vaultId: vault.id, scope },
        anchor: { keyVersion: anchor.key_version, wrapped: fromB64(anchor.wrapped) },
        sealed: mine.filter((w) => w.kind === "sealed").map((w) => ({ keyVersion: w.key_version, sealed: fromB64(w.wrapped) })),
        oldRows: (await server.oldKeys(vault.id)).map((r) => ({ version: r.key_version, wrapped: fromB64(r.wrapped) })),
      });
      const short = !out.complete || out.version < vault.key_version;
      const keysByVersion = { [out.version]: toB64(out.key) };
      const ring = unlockKeyring({ vaultId: vault.id, scope, current: { key: out.key, version: out.version }, oldRows: (await server.oldKeys(vault.id)).map((r) => ({ version: r.key_version, wrapped: fromB64(r.wrapped) })) });
      for (const [n, k] of ring) keysByVersion[n] = toB64(k);
      await saveVault({ vaultId: vault.id, scope, current: out.version, settled: out.version, removed: [], keys: keysByVersion });
      results.push({ scope, state: short ? "short" : "restored", version: out.version, vaultVersion: vault.key_version });
    }
    const restored = results.filter((r) => r.state === "restored" || r.state === "short");
    // Re-key under this phone's identity, removing every other device of mine.
    const others = (await account.myDevices()).filter((d) => !d.thisDevice).map((d) => d.deviceId);
    for (const r of restored) r.rekey = await rotateFromRestore(r.scope, others);
    const anyShort = results.some((r) => r.state === "short");
    const code = anyShort ? null : (await newRecoveryCode(restored.map((r) => r.scope))).code;
    return { results, code };
  }

  // Rotation after a restore: like rotate(), but the settled version on the server may
  // be ahead of what this phone could prove (a short restore); the new version is
  // placed after the server's.
  async function rotateFromRestore(scope, removedDeviceIds) {
    const v = await localVault(scope);
    const vault = await server.vault(scope);
    if (vault.key_version > v.settled) {
      // Can't rotate past versions this phone can't open; leave it for a device that can.
      return { skipped: true };
    }
    return rotate(scope, removedDeviceIds);
  }

  return {
    ensureBox, createVault, open, status, keysFor, grantPending,
    rotate, removeDevice, newRecoveryCode, restore,
    needsNewCode: async () => Boolean(await store.get("needsNewCode")),
    personalScope: () => personalScope(userId),
  };
}
