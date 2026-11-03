// Vault keys on this device (DOCUMENTS_DESIGN.md §3, §19): creating a vault,
// receiving its key, handing it to other devices, rotating it when a device is
// removed, and the printed recovery code.
//
// Builds on the messaging account (messaging/account.js): its devices, certificates
// verified against PINNED identities (resolveDevices), and its signing keys
// (signers()). Nothing the server says is taken on trust:
//
// WHO IS TRUSTED. Me, and other people whose pinned identity I have VERIFIED (the
// safety-number scan) and which hasn't changed since. A member list from the server
// can't add anyone: an unverified or changed person gets no grant from this device,
// and their grants and statements are ignored. (requireVerified is turned off only
// in tests.)
//
// VERSIONS. A vault's version is what identity-signed "settled" statements from
// trusted people prove — never the server's key_version, which is only a hint.
//   floor   = highest proven version: rows below it are never shown;
//   settled = highest version this device holds the key for.
// If floor > settled, the device waits for a grant at the floor (old rows hidden).
// A statement can't make a device delete its keys unless it's MY identity's.
//
// REMOVALS are per signer: a statement by person S removes only S's devices
// ("S:device" entries), so one member can't cut off the other's devices.
//
// GRANTS. Opened only at a proven version, only from a trusted person's certified
// device that isn't removed. Anyone with write access can add rows (tables have
// surrogate keys), so every check looks for a row that VERIFIES, never just one
// that exists.
//
// What needs the person's IDENTITY (the phone): creating a vault, rotating it, the
// recovery code. Any trusted device holding a vault can grant it.
//
// Store (its own keystore):
//   box                this device's box key pair
//   vault:<scope>      { vaultId, scope, settled, floor, removed: ["user:device"], keys: { v: key } }
//   rotation:<scope>   a rotation in progress (resumed if interrupted)
//   recoveryGen        highest recovery generation seen for this person
//   sealed:<vault>:<v> this device already sealed version v to the recovery key

import { toB64, fromB64, equalBytes } from "../messaging/crypto/bytes.js";
import {
  generateVaultKey, rotateVault, unlockKeyring, unwrapFileKey, wrapFileKey, decryptFolderName, encryptFolderName,
  generateBoxKey, signBoxKey, verifyBoxKey, createGrant, openGrant, verifyGrantSignature,
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
const PERSONAL_RE = /^u-([0-9a-f-]{36})$/i;
const entry = (user, device) => `${user}:${device}`;

// scopeMembers(scope) → user ids who may hold a Household scope (from the app; only
// a hint — see WHO IS TRUSTED). Personal scopes belong to exactly one person.
export function createDocumentsVaults({ server, store, account, userId, scopeMembers, requireVerified = true, newId = () => crypto.randomUUID() }) {
  const membersOf = async (scope) => {
    const m = PERSONAL_RE.exec(scope);
    return m ? [m[1].toLowerCase()] : [...new Set(await scopeMembers(scope))];
  };

  const signers = () => account.signers();

  // ---- trust -------------------------------------------------------------------------------

  // The TRUSTED among userIds: { people: { uid: person }, devices: Map(deviceId → device) }.
  async function trusted(userIds) {
    const ids = [...new Set(userIds)];
    if (!ids.length) return { people: {}, devices: new Map() };
    const { people } = await account.resolveDevices(ids);
    const out = {};
    const devices = new Map();
    for (const uid of ids) {
      const p = people[uid];
      if (!p || !p.identitySignPub) continue;
      if (uid !== userId && (p.changed || p.blocked || (requireVerified && !p.verified))) continue;
      out[uid] = p;
      for (const d of p.devices) devices.set(d.deviceId, d);
    }
    return { people: out, devices };
  }

  // Settled statements that verify against a trusted member's pinned identity.
  async function provenSettled(vaultId, scope, members) {
    const rows = await server.settled(vaultId);
    const { people } = await trusted(rows.map((r) => r.signer_user_id).filter((u) => members.includes(u)));
    const out = [];
    for (const r of rows) {
      const ident = people[r.signer_user_id]?.identitySignPub;
      if (!ident) continue;
      const statement = { userId: r.signer_user_id, vaultId, scope, keyVersion: r.key_version, removedDeviceIds: r.removed_device_ids || [] };
      if (verifyVaultSettled(ident, statement, fromB64(r.sig))) out.push(statement);
    }
    return out;
  }

  // ---- local vault record ---------------------------------------------------------------------

  const localVault = (scope) => store.get(`vault:${scope}`);
  async function saveVault(v) { await store.set(`vault:${v.scope}`, v); return v; }
  const keyAt = (v, n) => (v?.keys?.[n] ? fromB64(v.keys[n]) : null);
  const oldRows = async (vaultId) => (await server.oldKeys(vaultId)).map((r) => ({ version: r.key_version, wrapped: fromB64(r.wrapped) }));

  // ---- box key ----------------------------------------------------------------------------

  async function ensureBox() {
    const s = await signers();
    let box = await store.get("box");
    if (!box || box.deviceId !== s.deviceId) {
      box = { deviceId: s.deviceId, ...generateBoxKey() };
      await store.set("box", box);
    }
    const rows = await server.boxes([userId]);
    if (!rows.some((r) => r.device_id === s.deviceId && r.box_pub === toB64(box.pub))) {
      const sig = signBoxKey(s.device, { userId, deviceId: s.deviceId, boxPub: box.pub });
      await server.addBox({ device_id: s.deviceId, user_id: userId, box_pub: toB64(box.pub), box_sig: toB64(sig) });
    }
    return box;
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
    const v = await saveVault({ vaultId, scope, settled: 1, floor: 1, removed: [], keys: { 1: toB64(key) } });
    await grantTo(v, key, 1, [{ userId, deviceId: s.deviceId, boxPub: box.pub }], s);
    await settle(v, 1, [], s);
    return status(scope);
  }

  // ---- opening a vault on this device ------------------------------------------------------------

  // { state: "missing" | "waiting" | "removed" | "ready", vaultId, version }
  async function open(scope) {
    const vault = await server.vault(scope);
    if (!vault) return { state: "missing" };
    const members = await membersOf(scope);
    if (!members.includes(userId)) throw new DocumentsError("NOT_MEMBER", "You can't hold this scope.");
    let v = (await localVault(scope)) || { vaultId: vault.id, scope, settled: 0, floor: 0, removed: [], keys: {} };
    if (v.vaultId !== vault.id) throw new DocumentsError("VAULT_CHANGED", "This vault was replaced on the server.");
    const s = await signers();

    const proven = await provenSettled(vault.id, scope, members);
    const removed = new Set(v.removed || []);
    for (const p of proven) for (const d of p.removedDeviceIds) removed.add(entry(p.userId, d));
    v = { ...v, removed: [...removed], floor: Math.max(v.floor || 0, v.settled || 0, ...proven.map((p) => p.keyVersion)) };
    if (removed.has(entry(userId, s.deviceId))) {
      // Only my own identity's statement can name my devices (removals are per signer).
      await store.remove(`vault:${scope}`);
      return { state: "removed", vaultId: vault.id };
    }
    if (!v.floor) { await saveVault(v); return { state: "waiting", vaultId: vault.id }; }

    if (!keyAt(v, v.floor)) {
      const box = await ensureBox();
      const want = v.floor;
      const grants = await server.myGrants(vault.id, want, s.deviceId);
      const { devices } = await trusted(grants.map((g) => g.granter_user_id).filter((u) => members.includes(u)));
      let key = null;
      for (const g of grants) {
        const granter = devices.get(g.granter_device_id);
        if (!granter || granter.userId !== g.granter_user_id) continue;
        if (removed.has(entry(g.granter_user_id, g.granter_device_id))) continue;
        try {
          key = openGrant({
            grant: { sealed: fromB64(g.sealed), sig: fromB64(g.granter_sig), granterUserId: g.granter_user_id, granterDeviceId: g.granter_device_id },
            ctx: { vaultId: vault.id, scope, keyVersion: want, recipientUserId: userId, recipientDeviceId: s.deviceId, recipientBoxPub: box.pub },
            box, granterSignPub: granter.signPub, removedDeviceIds: [],
          });
          break;
        } catch { /* a junk or foreign row: try the next */ }
      }
      if (!key) { await saveVault(v); return { state: "waiting", vaultId: vault.id, version: want }; }
      v.keys = { ...v.keys, [want]: toB64(key) };
      v.settled = want;
    }
    // Older versions, for rows a rotation hasn't re-wrapped yet.
    if (Array.from({ length: v.settled - 1 }, (_, i) => i + 1).some((n) => !v.keys[n])) {
      const ring = unlockKeyring({ vaultId: vault.id, scope, current: { key: keyAt(v, v.settled), version: v.settled }, oldRows: await oldRows(vault.id) });
      for (const [n, k] of ring) v.keys[n] = toB64(k);
    }
    await saveVault(v);
    await topUpRecovery(v);
    return { state: "ready", vaultId: vault.id, version: v.settled };
  }

  async function status(scope) {
    const v = await localVault(scope);
    if (!v) return { state: "none" };
    return keyAt(v, v.settled) && v.settled >= (v.floor || 0) ? { state: "ready", vaultId: v.vaultId, version: v.settled } : { state: "waiting", vaultId: v.vaultId };
  }

  // The keys the files layer needs. `settled` is the version below which rows must
  // not be shown (rowVersionAllowed); older keys are only for re-wrapping.
  async function keysFor(scope) {
    const v = await localVault(scope);
    if (!v || !keyAt(v, v.settled) || v.settled < (v.floor || 0)) throw new DocumentsError("LOCKED", "This device doesn't hold this vault yet.");
    const keys = new Map(Object.entries(v.keys).map(([n, k]) => [Number(n), fromB64(k)]));
    return { vaultId: v.vaultId, scope, version: v.settled, settled: v.settled, key: keys.get(v.settled), keys };
  }

  // ---- granting ----------------------------------------------------------------------------------

  async function grantTo(v, key, version, recipients, s) {
    const rows = recipients.map((r) => {
      const g = createGrant({
        granter: { userId, deviceId: s.deviceId, device: s.device }, vaultKey: key,
        ctx: { vaultId: v.vaultId, scope: v.scope, keyVersion: version, recipientUserId: r.userId, recipientDeviceId: r.deviceId, recipientBoxPub: r.boxPub },
        removedDeviceIds: [],
      });
      return { vault_id: v.vaultId, key_version: version, device_id: r.deviceId, sealed: toB64(g.sealed), granter_user_id: userId, granter_device_id: s.deviceId, granter_sig: toB64(g.sig) };
    });
    await server.addGrants(rows);
    return rows.length;
  }

  // Trusted members' certified devices without a VALID grant at `version`: verified
  // box key, not removed. Returns how many were granted.
  async function grantPending(scope, { version, key, removed: extraRemoved = [] } = {}) {
    const s = await signers();
    const v = await localVault(scope);
    const ver = version || v?.settled;
    const k = key || keyAt(v, ver);
    if (!v || !k) throw new DocumentsError("LOCKED", "This device doesn't hold this vault yet.");
    const removed = new Set([...(v.removed || []), ...extraRemoved]);
    const members = await membersOf(scope);
    const [{ devices }, boxes, existing] = await Promise.all([trusted(members), server.boxes(members), server.grantsAt(v.vaultId, ver)]);
    const boxOf = new Map();
    for (const b of boxes) {
      const d = devices.get(b.device_id);
      if (!d || d.userId !== b.user_id || removed.has(entry(d.userId, d.deviceId))) continue;
      const boxPub = fromB64(b.box_pub);
      if (verifyBoxKey(d.signPub, { userId: d.userId, deviceId: d.deviceId, boxPub }, fromB64(b.box_sig))) boxOf.set(d.deviceId, boxPub);
    }
    const valid = new Set();
    for (const g of existing) {
      const granter = devices.get(g.granter_device_id);
      const recipient = devices.get(g.device_id);
      const boxPub = boxOf.get(g.device_id);
      if (!granter || !recipient || !boxPub || granter.userId !== g.granter_user_id) continue;
      if (removed.has(entry(g.granter_user_id, g.granter_device_id))) continue;
      const ok = verifyGrantSignature({
        grant: { sealed: fromB64(g.sealed), sig: fromB64(g.granter_sig), granterUserId: g.granter_user_id, granterDeviceId: g.granter_device_id },
        ctx: { vaultId: v.vaultId, scope, keyVersion: ver, recipientUserId: recipient.userId, recipientDeviceId: g.device_id, recipientBoxPub: boxPub },
        granterSignPub: granter.signPub,
      });
      if (ok) valid.add(g.device_id);
    }
    const recipients = [...boxOf].filter(([deviceId]) => !valid.has(deviceId)).map(([deviceId, boxPub]) => ({ userId: devices.get(deviceId).userId, deviceId, boxPub }));
    return recipients.length ? grantTo(v, k, ver, recipients, s) : 0;
  }

  // ---- settled statements and rotation (phone) -----------------------------------------------------

  // removedIds: devices of MINE only (removals are per signer).
  async function settle(v, version, removedIds, s) {
    const statement = { userId, vaultId: v.vaultId, scope: v.scope, keyVersion: version, removedDeviceIds: [...new Set(removedIds)] };
    const sig = signVaultSettled(s.identity, statement);
    await server.addSettled({ vault_id: v.vaultId, key_version: version, signer_user_id: userId, removed_device_ids: statement.removedDeviceIds, sig: toB64(sig) });
  }

  const myRemovedIds = (v) => (v.removed || []).filter((e) => e.startsWith(`${userId}:`)).map((e) => e.slice(userId.length + 1));

  // New key version for `scope`, adding `removeIds` (devices of MINE) to the removed
  // list. Steps, each resumable and each checked by a row that VERIFIES (never one
  // that merely exists): old key row → grants → re-wrap rows → settled → hint.
  async function rotate(scope, removeIds = []) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Only your phone can do this.");
    await open(scope);
    let v = await localVault(scope);
    if (!v || !keyAt(v, v.settled)) throw new DocumentsError("LOCKED", "This device doesn't hold this vault yet.");
    let r = await store.get(`rotation:${scope}`);
    if (r && r.from === v.settled && r.step < 4) {
      r.removed = [...new Set([...r.removed, ...removeIds])]; // a second removal joins this rotation
    } else if (!(r && r.version === v.settled && r.step >= 4 && !removeIds.length)) {
      if ((v.floor || 0) > v.settled) throw new DocumentsError("WAITING", "This phone needs the newest key first.");
      const next = rotateVault({ vaultId: v.vaultId, scope, key: keyAt(v, v.settled), version: v.settled });
      r = { from: v.settled, version: next.version, key: toB64(next.key), oldWrapped: toB64(next.oldRow.wrapped), removed: [...new Set([...myRemovedIds(v), ...removeIds])], step: 0, skipped: 0 };
    }
    await store.set(`rotation:${scope}`, r);
    const newKey = fromB64(r.key);
    v = { ...v, keys: { ...v.keys, [r.version]: r.key }, removed: [...new Set([...(v.removed || []), ...r.removed.map((d) => entry(userId, d))])] };
    await saveVault(v);

    if (r.step < 1) {
      const ring = unlockKeyring({ vaultId: v.vaultId, scope, current: { key: newKey, version: r.version }, oldRows: await oldRows(v.vaultId) });
      const reached = ring.get(r.from);
      if (!reached || !equalBytes(reached, keyAt(v, r.from))) await server.addOldKey(v.vaultId, r.from, r.oldWrapped);
      r.step = 1; await store.set(`rotation:${scope}`, r);
    }
    if (r.step < 2) {
      await grantPending(scope, { version: r.version, key: newKey });
      r.step = 2; await store.set(`rotation:${scope}`, r);
    }
    if (r.step < 3) {
      const ring = new Map(Object.entries(v.keys).map(([n, k]) => [Number(n), fromB64(k)]));
      let skipped = 0;
      for (const f of await server.fileKeys(scope)) {
        if (f.key_version === r.version) continue;
        try {
          const fk = unwrapFileKey(ring.get(f.key_version), fromB64(f.wrapped_key), { vaultId: v.vaultId, scope, fileId: f.id, keyVersion: f.key_version });
          await server.rewrapFile(f.id, toB64(wrapFileKey(newKey, fk, { vaultId: v.vaultId, scope, fileId: f.id, keyVersion: r.version })), r.version);
        } catch { skipped++; } // a row that doesn't open stays hidden below the new version
      }
      for (const f of await server.folderNames(scope)) {
        if (f.key_version === r.version) continue;
        try {
          const name = decryptFolderName(ring.get(f.key_version), fromB64(f.enc_name), { vaultId: v.vaultId, scope, folderId: f.id, keyVersion: f.key_version });
          await server.rewrapFolder(f.id, toB64(encryptFolderName(newKey, name, { vaultId: v.vaultId, scope, folderId: f.id, keyVersion: r.version })), r.version);
        } catch { skipped++; }
      }
      r.skipped = skipped;
      r.step = 3; await store.set(`rotation:${scope}`, r);
    }
    if (r.step < 4) {
      const done = (await provenSettled(v.vaultId, scope, [userId]))
        .some((p) => p.keyVersion === r.version && r.removed.every((d) => p.removedDeviceIds.includes(d)));
      if (!done) await settle(v, r.version, r.removed, s);
      r.step = 4; await store.set(`rotation:${scope}`, r);
    }
    await saveVault({ ...v, settled: r.version, floor: Math.max(v.floor || 0, r.version) });
    await bumpHint(v.vaultId, scope, r.version);
    await store.remove(`rotation:${scope}`);
    await topUpRecovery(await localVault(scope));
    return { version: r.version, skipped: r.skipped || 0 };
  }

  // doc_vaults.key_version is only a hint for other devices; it moves one step at a
  // time, and a failure here changes nothing that matters.
  async function bumpHint(vaultId, scope, target) {
    try {
      let cur = (await server.vault(scope))?.key_version || target;
      while (cur < target) { await server.setVaultVersion(vaultId, cur + 1); cur += 1; }
    } catch { /* advisory */ }
  }

  // Phone: remove a device of mine, re-key every vault it could open, and require a
  // new recovery code (§3.4). Resumable: an already-removed device is fine.
  async function removeDevice(deviceId, scopes) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Only your phone can remove a device.");
    if (deviceId === s.deviceId) throw new DocumentsError("IS_THIS_DEVICE", "This phone can't remove itself.");
    if (!(await server.myDeviceIds(userId)).includes(deviceId)) throw new DocumentsError("NOT_MINE", "That isn't one of your devices.");
    try { await account.removeDevice(deviceId); } catch { /* already removed: carry on with the re-key */ }
    await store.set("needsNewCode", true);
    const rotated = [];
    for (const scope of scopes) {
      if (!(await localVault(scope))) continue;
      await rotate(scope, [deviceId]);
      rotated.push(scope);
    }
    return { rotated, needsNewCode: true };
  }

  // ---- recovery (the phone makes the code; any device keeps it topped up) -----------------------

  async function verifiedRecoveryKey() {
    const row = await server.recoveryKey(userId);
    if (!row) return null;
    const s = await signers();
    let params;
    try { params = decodeRecoveryParams(fromB64(row.params)); } catch { return null; }
    const statement = { userId, recoveryPub: fromB64(row.recovery_pub), params, generation: row.generation };
    if (!verifyRecoveryPub(s.identitySignPub, statement, fromB64(row.sig))) return null;
    const seen = (await store.get("recoveryGen")) || 0;
    if (row.generation < seen) return null;
    if (row.generation > seen) await store.set("recoveryGen", row.generation);
    return statement;
  }

  // After a key change, seal the new key to my recovery key (if I have a verified one)
  // so a restore reaches it. Needs no code. Duplicate rows are harmless.
  async function topUpRecovery(v) {
    if (!v || !keyAt(v, v.settled)) return;
    const mark = `sealed:${v.vaultId}:${v.settled}`;
    if (await store.get(mark)) return;
    const rk = await verifiedRecoveryKey();
    if (!rk) return;
    const sealed = sealToRecovery(rk.recoveryPub, keyAt(v, v.settled), { userId, vaultId: v.vaultId, scope: v.scope, keyVersion: v.settled });
    await server.addRecoveryWrap({ user_id: userId, vault_id: v.vaultId, key_version: v.settled, kind: "sealed", wrapped: toB64(sealed) });
    await store.set(mark, true);
  }

  // A new recovery code covering every vault this phone holds. Returns the code to show
  // and print once; it's never stored.
  async function newRecoveryCode(scopes) {
    const s = await signers();
    if (!s.identity) throw new DocumentsError("NOT_PHONE", "Make the recovery code on your phone.");
    const held = [];
    for (const scope of scopes) {
      const v = await localVault(scope);
      if (v && keyAt(v, v.settled) && v.settled >= (v.floor || 0)) held.push(v);
    }
    if (!held.length) throw new DocumentsError("NOTHING", "Set up Documents first.");
    const code = generateRecoveryCode();
    const params = newRecoveryParams();
    const keys = deriveRecoveryKeys(code, params);
    const existing = await server.recoveryKey(userId);
    const generation = (existing?.generation || 0) + 1; // the table only takes old + 1
    const statement = { userId, recoveryPub: keys.recoveryPub, params, generation };
    const row = { recovery_pub: toB64(keys.recoveryPub), params: toB64(encodeRecoveryParams(params)), sig: toB64(signRecoveryPub(s.identity, statement)), generation };
    // New anchors first, then the key, then the old wraps go: a crash leaves extra rows, never none.
    for (const v of held) {
      await server.addRecoveryWrap({ user_id: userId, vault_id: v.vaultId, key_version: v.settled, kind: "anchor", wrapped: toB64(wrapAnchor(keys.anchorKey, keyAt(v, v.settled), { userId, vaultId: v.vaultId, scope: v.scope, keyVersion: v.settled })) });
    }
    if (existing) await server.replaceRecoveryKey(userId, row);
    else await server.addRecoveryKey({ user_id: userId, ...row });
    await store.set("recoveryGen", generation);
    const fresh = new Set();
    for (const w of await server.recoveryWraps(userId)) if (w.kind === "anchor" && held.some((v) => v.vaultId === w.vault_id && v.settled === w.key_version)) fresh.add(w.id);
    for (const v of held) await server.removeRecoveryWrapsExcept(userId, v.vaultId, [...fresh]);
    for (const k of await store.keys("sealed:")) await store.remove(k);
    await store.remove("needsNewCode");
    return { code, generation, vaults: held.map((v) => v.scope) };
  }

  // On a new phone (messaging set up afresh, new identity): unlock each vault from the
  // code, re-key it under this phone (every other device of mine removed) and make a
  // new code. A SHORT restore (the newest keys couldn't be proven) is reported, isn't
  // re-keyed and makes no new code, so the old sheet still reaches what it can.
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
      const anchors = mine.filter((w) => w.kind === "anchor").sort((a, b) => b.key_version - a.key_version);
      let out = null;
      for (const anchor of anchors) {
        try {
          out = restoreVaultKey({
            keys, base: { userId, vaultId: vault.id, scope },
            anchor: { keyVersion: anchor.key_version, wrapped: fromB64(anchor.wrapped) },
            sealed: mine.filter((w) => w.kind === "sealed").map((w) => ({ keyVersion: w.key_version, sealed: fromB64(w.wrapped) })),
            oldRows: await oldRows(vault.id),
          });
          break;
        } catch (e) {
          if (/conflicting/.test(String(e.message))) throw e;
        }
      }
      if (!out) { results.push({ scope, state: anchors.length ? "wrong-code" : "not-covered" }); continue; }
      const keysByVersion = {};
      const ring = unlockKeyring({ vaultId: vault.id, scope, current: { key: out.key, version: out.version }, oldRows: await oldRows(vault.id) });
      for (const [n, k] of ring) keysByVersion[n] = toB64(k);
      await saveVault({ vaultId: vault.id, scope, settled: out.version, floor: out.version, removed: [], keys: keysByVersion });
      results.push({ scope, state: out.complete ? "restored" : "short", version: out.version, newestOffered: out.newestOffered });
    }
    if (!results.some((r) => r.state === "restored" || r.state === "short")) {
      if (results.some((r) => r.state === "wrong-code")) throw new DocumentsError("WRONG_CODE", "That code doesn't open your Documents.");
      return { results, code: null };
    }
    // Every device of mine but this phone, revoked ones included, is removed.
    const others = (await server.myDeviceIds(userId)).filter((d) => d !== s.deviceId);
    for (const r of results.filter((x) => x.state === "restored")) r.rekey = await rotate(r.scope, others);
    const restored = results.filter((x) => x.state === "restored").map((x) => x.scope);
    const code = results.some((x) => x.state === "short") || !restored.length ? null : (await newRecoveryCode(restored)).code;
    return { results, code };
  }

  return {
    ensureBox, createVault, open, status, keysFor, grantPending,
    rotate, removeDevice, newRecoveryCode, restore,
    needsNewCode: async () => Boolean(await store.get("needsNewCode")),
    personalScope: () => personalScope(userId),
  };
}
