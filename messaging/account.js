// This device's messaging account (MESSAGING_DESIGN.md §3): setting up a phone,
// linking a browser or the laptop app from that phone, keeping prekeys topped up,
// and knowing which devices really belong to whom (certificates + pinned identities
// + verification). Pure orchestration over `server` (messaging/server.js) and `store`
// (messaging/keystore.js); every network call is the caller's to trigger.
//
// Linking (§3): the new device shows a link code (QR, or text to paste) holding its
// public keys, its signed prekey, the identity key it was told belongs to this
// person, and its own signature over all of it. The phone checks that identity is
// really its own, signs the certificate, and registers the device. A server that
// lied about the identity is caught right there, so the linked device's pinned
// identity is the true one.

import {
  generateIdentity, generateDevice, generateSignedPrekey, generateOneTimePrekeys,
  certifyDevice, signCertAsDevice, signCertAsIdentity, verifyDeviceCert, verifySignedPrekey,
  safetyNumber, safetyQr, matchSafetyQr, SPK_MAX_AGE_MS,
} from "./crypto/keys.js";
import { toB64, fromB64, utf8, fromUtf8, equalBytes } from "./crypto/bytes.js";
import { withLock } from "./keystore.js";

export const OPK_TARGET = 20;
export const OPK_REFILL_BELOW = 5;
export const SPK_ROTATE_MS = 30 * 24 * 3600 * 1000;
export const SPK_KEEP_PREVIOUS_MS = 14 * 24 * 3600 * 1000;
export const SEEN_KEEP_MS = SPK_MAX_AGE_MS + 7 * 24 * 3600 * 1000;
const LINK_PREFIX = "LIVEMSG1:";

export class MessagingError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const certFromRow = (row, identitySignPub) => ({
  userId: row.user_id, identitySignPub, deviceId: row.device_id, kind: row.kind,
  signPub: fromB64(row.sign_pub), dhPub: fromB64(row.dh_pub), createdAt: Number(row.created_at_ms),
});

function rowFor(cert, sigs, spk, label) {
  return {
    device_id: cert.deviceId, user_id: cert.userId, kind: cert.kind, label: label ? String(label).slice(0, 60) : null,
    sign_pub: toB64(cert.signPub), dh_pub: toB64(cert.dhPub), created_at_ms: cert.createdAt,
    identity_sig: toB64(sigs.identitySig), device_sig: toB64(sigs.deviceSig),
    spk_id: spk.id, spk_pub: toB64(spk.pub), spk_sig: toB64(spk.sig), spk_created_at_ms: spk.createdAt,
  };
}

export function createMessagingAccount({ server, store, userId, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const lock = (fn) => withLock(`account:${userId}`, fn);

  async function account() { return store.get("account"); }

  // ---- status ----------------------------------------------------------------------

  async function status() {
    const a = await account();
    if (!a || a.userId !== userId) return { state: "none" };
    return { state: a.state, kind: a.kind, deviceId: a.deviceId, label: a.label };
  }

  // ---- prekeys -----------------------------------------------------------------------

  async function newOneTimePrekeys(count) {
    const opk = (await store.get("opk")) || { nextId: 1, keys: {} };
    const fresh = generateOneTimePrekeys(opk.nextId, count);
    for (const k of fresh) opk.keys[k.id] = { pub: k.pub, priv: k.priv };
    opk.nextId += count;
    await store.set("opk", opk);
    return fresh;
  }

  // ---- setting up a phone ---------------------------------------------------------------

  // replaceExisting: messaging is already set up on another phone; this becomes the
  // person's phone and every other device of theirs is removed (§3 "New phone / reset").
  async function setupPhone({ label = "iPhone", replaceExisting = false } = {}) {
    return lock(async () => {
      let a = await account();
      if (a && a.userId === userId && a.state === "ready") return status();
      const [existing] = await server.identities([userId]);
      if (!a || a.userId !== userId || a.kind !== "phone") {
        if (existing && !replaceExisting) {
          throw new MessagingError("IDENTITY_EXISTS", "Messaging is already set up on another phone.");
        }
        await store.clear();
        const identity = generateIdentity();
        const device = generateDevice();
        const createdAt = now();
        const deviceId = newId();
        const cert = { userId, identitySignPub: identity.signPub, deviceId, kind: "phone", signPub: device.signPub, dhPub: device.dhPub, createdAt };
        const spk = generateSignedPrekey(device, 1, createdAt);
        a = { v: 1, userId, deviceId, kind: "phone", label, state: "registering", identity, device, identitySignPub: identity.signPub, cert, sigs: certifyDevice(identity, device, cert), replacing: Boolean(existing) };
        await store.set("spk", { current: spk, previous: [] });
        await store.set("account", a);
        await store.set("pins", { [userId]: { signPub: identity.signPub, verified: true, own: true, firstSeenAt: createdAt } });
      }
      // Idempotent from here, so an interrupted setup simply resumes.
      const [now1] = await server.identities([userId]);
      if (!now1) await server.createIdentity(userId, toB64(a.identitySignPub));
      else if (now1.sign_pub !== toB64(a.identitySignPub)) {
        // Another phone took over while this setup was paused: only replace it if asked.
        if (!a.replacing && !replaceExisting) throw new MessagingError("IDENTITY_EXISTS", "Messaging is already set up on another phone.");
        await server.resetIdentity(toB64(a.identitySignPub));
      }
      if (!(await server.device(a.deviceId))) {
        const { current } = await store.get("spk");
        await server.registerDevice(rowFor(a.cert, a.sigs, current, a.label));
      }
      if ((await server.prekeyCount(a.deviceId)) === 0) {
        await store.remove("opk");
        const opks = await newOneTimePrekeys(OPK_TARGET);
        await server.uploadPrekeys(a.deviceId, opks.map((k) => ({ id: k.id, pub: toB64(k.pub) })));
      }
      a.state = "ready";
      delete a.replacing;
      await store.set("account", a);
      return status();
    });
  }

  // ---- linking a browser / the laptop app -----------------------------------------------------

  // On the new device. Returns the link code to show as a QR (and to copy).
  async function startLink({ label = "Browser" } = {}) {
    return lock(async () => {
      const [ident] = await server.identities([userId]);
      if (!ident) throw new MessagingError("NO_PHONE", "Set up messaging on your phone first.");
      let a = await account();
      if (!a || a.userId !== userId || a.state !== "awaiting-link") {
        await store.clear();
        const device = generateDevice();
        const createdAt = now();
        const deviceId = newId();
        const identitySignPub = fromB64(ident.sign_pub);
        const cert = { userId, identitySignPub, deviceId, kind: "linked", signPub: device.signPub, dhPub: device.dhPub, createdAt };
        const spk = generateSignedPrekey(device, 1, createdAt);
        a = { v: 1, userId, deviceId, kind: "linked", label, state: "awaiting-link", device, identitySignPub, cert, deviceSig: signCertAsDevice(device, cert) };
        await store.set("spk", { current: spk, previous: [] });
        await store.set("account", a);
      }
      const { current: spk } = await store.get("spk");
      const payload = {
        v: 1, u: a.userId, d: a.deviceId, l: a.label, c: a.cert.createdAt,
        s: toB64(a.cert.signPub), x: toB64(a.cert.dhPub), i: toB64(a.identitySignPub), g: toB64(a.deviceSig),
        k: { id: spk.id, p: toB64(spk.pub), g: toB64(spk.sig), c: spk.createdAt },
      };
      return LINK_PREFIX + toB64(utf8(JSON.stringify(payload)));
    });
  }

  function parseLinkCode(text) {
    const t = String(text || "").trim();
    if (!t.startsWith(LINK_PREFIX)) throw new MessagingError("BAD_LINK", "That isn't a link code from this app.");
    let p;
    try { p = JSON.parse(fromUtf8(fromB64(t.slice(LINK_PREFIX.length)))); } catch { throw new MessagingError("BAD_LINK", "That link code is damaged."); }
    if (!p || p.v !== 1 || !p.k) throw new MessagingError("BAD_LINK", "That link code is from a different version.");
    return p;
  }

  // On the phone, after scanning (or pasting) the new device's code. Returns
  // { label } so the phone can show "Linked Chrome on Mac".
  async function approveLink(text) {
    return lock(async () => {
      const a = await account();
      if (!a || a.kind !== "phone" || a.state !== "ready") throw new MessagingError("NOT_PHONE", "Only your phone can link devices.");
      const p = parseLinkCode(text);
      if (p.u !== userId) throw new MessagingError("OTHER_ACCOUNT", "That device is signed in to a different account.");
      const identitySignPub = fromB64(p.i);
      if (!equalBytes(identitySignPub, a.identitySignPub)) {
        throw new MessagingError("IDENTITY_MISMATCH", "That device was shown the wrong security key. Don't link it — try again on a trusted network.");
      }
      const cert = { userId, identitySignPub, deviceId: p.d, kind: "linked", signPub: fromB64(p.s), dhPub: fromB64(p.x), createdAt: p.c };
      const spk = { id: p.k.id, pub: fromB64(p.k.p), sig: fromB64(p.k.g), createdAt: p.k.c };
      const sigs = { identitySig: signCertAsIdentity(a.identity, cert), deviceSig: fromB64(p.g) };
      if (!verifyDeviceCert(a.identitySignPub, cert, sigs)) throw new MessagingError("BAD_LINK", "That link code's signature doesn't check out.");
      if (!verifySignedPrekey(cert.signPub, spk, now())) throw new MessagingError("BAD_LINK", "That link code has expired. Start again on the other device.");
      await server.registerDevice(rowFor(cert, sigs, spk, p.l));
      return { label: p.l || "device", deviceId: p.d };
    });
  }

  // On the new device: has the phone approved it yet? The caller polls this only
  // while the link screen is open (bounded; §9).
  async function finishLink() {
    return lock(async () => {
      const a = await account();
      if (!a || a.state === "ready") return status();
      if (a.state !== "awaiting-link") throw new MessagingError("NOT_LINKING", "This device isn't waiting to be linked.");
      const row = await server.device(a.deviceId);
      if (!row) return status();
      const cert = certFromRow(row, a.identitySignPub);
      const sigs = { identitySig: fromB64(row.identity_sig), deviceSig: fromB64(row.device_sig) };
      if (!verifyDeviceCert(a.identitySignPub, cert, sigs) || !equalBytes(cert.dhPub, a.device.dhPub)) {
        throw new MessagingError("BAD_LINK", "The server's copy of this device doesn't match. Start linking again.");
      }
      await store.remove("opk");
      const opks = await newOneTimePrekeys(OPK_TARGET);
      await server.uploadPrekeys(a.deviceId, opks.map((k) => ({ id: k.id, pub: toB64(k.pub) })));
      a.state = "ready";
      a.cert = cert;
      a.sigs = sigs;
      await store.set("account", a);
      await store.set("pins", { [userId]: { signPub: a.identitySignPub, verified: true, own: true, firstSeenAt: now() } });
      return status();
    });
  }

  // ---- upkeep (on app open, at most daily) ------------------------------------------------

  async function maintain({ force = false } = {}) {
    return lock(async () => {
      const a = await account();
      if (!a || a.state !== "ready") return { skipped: true };
      const t = now();
      const last = (await store.get("maintainedAt")) || 0;
      if (!force && t - last < 24 * 3600 * 1000) return { skipped: true };
      const out = { uploaded: 0, rotated: false };
      // My row still live? If it was removed (here or by a reset elsewhere), stop.
      const mine = await server.device(a.deviceId);
      if (!mine || mine.revoked_at) {
        a.state = "removed";
        await store.set("account", a);
        return { removed: true };
      }
      const left = await server.prekeyCount(a.deviceId);
      if (left < OPK_REFILL_BELOW) {
        const opks = await newOneTimePrekeys(OPK_TARGET - left);
        await server.uploadPrekeys(a.deviceId, opks.map((k) => ({ id: k.id, pub: toB64(k.pub) })));
        out.uploaded = opks.length;
      }
      const spks = await store.get("spk");
      if (t - spks.current.createdAt >= SPK_ROTATE_MS) {
        const next = generateSignedPrekey(a.device, spks.current.id + 1, t);
        spks.previous = [{ ...spks.current, retiredAt: t }, ...spks.previous].filter((p) => t - p.retiredAt < SPK_KEEP_PREVIOUS_MS);
        spks.current = next;
        await store.set("spk", spks);
        await server.updateSignedPrekey(a.deviceId, { spk_id: next.id, spk_pub: toB64(next.pub), spk_sig: toB64(next.sig), spk_created_at_ms: next.createdAt });
        out.rotated = true;
      }
      const seen = (await store.get("seen")) || {};
      for (const [k, at] of Object.entries(seen)) if (t - at > SEEN_KEEP_MS) delete seen[k];
      await store.set("seen", seen);
      await store.set("maintainedAt", t);
      return out;
    });
  }

  // What decryptFromDevice needs (session.js), loaded once per batch of messages,
  // plus how to record what a batch used. Call commitPrekeyUse after storing records.
  async function prekeyState() {
    const spks = (await store.get("spk")) || { current: null, previous: [] };
    const opk = (await store.get("opk")) || { nextId: 1, keys: {} };
    const seen = (await store.get("seen")) || {};
    const all = [spks.current, ...spks.previous].filter(Boolean);
    return {
      signed: (id) => all.find((s) => s.id === id) || null,
      oneTime: (id) => (opk.keys[id] ? { id, ...opk.keys[id] } : null),
      seen: (spkId, ek) => Object.prototype.hasOwnProperty.call(seen, `${spkId}:${ek}`),
    };
  }

  async function commitPrekeyUse({ usedOneTimePrekeyIds = [], newPrekeyMessages = [] }) {
    if (!usedOneTimePrekeyIds.length && !newPrekeyMessages.length) return;
    const opk = (await store.get("opk")) || { nextId: 1, keys: {} };
    for (const id of usedOneTimePrekeyIds) delete opk.keys[id];
    await store.set("opk", opk);
    const seen = (await store.get("seen")) || {};
    for (const m of newPrekeyMessages) seen[`${m.spkId}:${m.ek}`] = now();
    await store.set("seen", seen);
  }

  // ---- whose devices are whose ------------------------------------------------------------

  // Returns { people: { [userId]: { identitySignPub, verified, changed, devices: [descriptor + spk] } } }
  // using pinned identities: the first key seen for a person is pinned; a different
  // key later is accepted (Signal's behaviour) but marks them changed + unverified,
  // which the thread shows as "security code changed" (decision 9). My own identity
  // is never replaced from the server — a different one means this device was
  // superseded by a reset elsewhere.
  async function resolveDevices(userIds) {
    const a = await account();
    if (!a || a.state !== "ready") throw new MessagingError("NOT_READY", "Messaging isn't set up on this device.");
    const ids = [...new Set(userIds)];
    const [idents, rows] = await Promise.all([server.identities(ids), server.devices(ids)]);
    const pins = (await store.get("pins")) || {};
    const people = {};
    let pinsChanged = false;
    for (const uid of ids) {
      const ident = idents.find((r) => r.user_id === uid);
      if (!ident) { people[uid] = { identitySignPub: null, verified: false, changed: false, devices: [] }; continue; }
      const key = fromB64(ident.sign_pub);
      let pin = pins[uid];
      if (uid === userId) {
        if (!equalBytes(key, a.identitySignPub)) {
          a.state = "removed";
          await store.set("account", a);
          throw new MessagingError("REPLACED", "Messaging was reset on your phone. Link this device again.");
        }
      } else if (!pin) {
        pin = pins[uid] = { signPub: key, verified: false, firstSeenAt: now() };
        pinsChanged = true;
      } else if (!equalBytes(pin.signPub, key)) {
        pin = pins[uid] = { signPub: key, verified: false, changed: true, changedAt: now(), firstSeenAt: pin.firstSeenAt };
        pinsChanged = true;
      }
      const trusted = uid === userId ? a.identitySignPub : pin.signPub;
      const devices = [];
      for (const row of rows.filter((r) => r.user_id === uid)) {
        const cert = certFromRow(row, trusted);
        const sigs = { identitySig: fromB64(row.identity_sig), deviceSig: fromB64(row.device_sig) };
        if (!verifyDeviceCert(trusted, cert, sigs)) continue; // forged or stale: never used
        devices.push({
          userId: uid, deviceId: row.device_id, kind: row.kind, label: row.label,
          identitySignPub: trusted, signPub: cert.signPub, dhPub: cert.dhPub,
          spk: { id: row.spk_id, pub: fromB64(row.spk_pub), sig: fromB64(row.spk_sig), createdAt: Number(row.spk_created_at_ms) },
        });
      }
      people[uid] = { identitySignPub: trusted, verified: uid === userId || Boolean(pin?.verified), changed: Boolean(pin?.changed), devices };
    }
    if (pinsChanged) await store.set("pins", pins);
    return { people };
  }

  // ---- verification (decision 9) -------------------------------------------------------------

  async function pinFor(otherId) {
    const pins = (await store.get("pins")) || {};
    const pin = pins[otherId];
    if (!pin) throw new MessagingError("UNKNOWN", "Message them first so their security code is known.");
    return { pins, pin };
  }

  async function safetyNumberWith(otherId) {
    const a = await account();
    const { pin } = await pinFor(otherId);
    const n = safetyNumber({ userId, signPub: a.identitySignPub }, { userId: otherId, signPub: pin.signPub });
    return n.match(/\d{5}/g).join(" ");
  }

  async function safetyQrWith(otherId) {
    const a = await account();
    const { pin } = await pinFor(otherId);
    return toB64(safetyQr({ userId, signPub: a.identitySignPub }, { userId: otherId, signPub: pin.signPub }));
  }

  // Scanned their QR: verified only if both phones hold the right keys.
  async function confirmSafetyScan(otherId, scannedText) {
    const a = await account();
    const { pins, pin } = await pinFor(otherId);
    let bytes;
    try { bytes = fromB64(String(scannedText).trim()); } catch { return false; }
    const ok = matchSafetyQr(bytes, { userId, signPub: a.identitySignPub }, { userId: otherId, signPub: pin.signPub });
    if (ok) {
      pins[otherId] = { ...pin, verified: true, changed: false, verifiedAt: now() };
      await store.set("pins", pins);
    }
    return ok;
  }

  // After comparing the 60 digits by eye (the fallback when scanning isn't possible).
  async function markVerified(otherId, verified = true) {
    const { pins, pin } = await pinFor(otherId);
    pins[otherId] = { ...pin, verified: Boolean(verified), changed: verified ? false : pin.changed, verifiedAt: verified ? now() : null };
    await store.set("pins", pins);
  }

  // ---- my devices -------------------------------------------------------------------------------

  async function myDevices() {
    const a = await account();
    const rows = await server.devices([userId]);
    return rows.map((r) => ({ deviceId: r.device_id, kind: r.kind, label: r.label, thisDevice: a && r.device_id === a.deviceId }));
  }

  async function removeDevice(deviceId) {
    const a = await account();
    if (!a || a.state !== "ready") throw new MessagingError("NOT_READY", "Messaging isn't set up on this device.");
    if (deviceId === a.deviceId && a.kind === "phone") throw new MessagingError("IS_PHONE", "Use Reset messaging to replace this phone.");
    await server.removeDevice(deviceId);
    if (deviceId === a.deviceId) { a.state = "removed"; await store.set("account", a); }
  }

  // Phone only: a new identity; all my other devices are removed and must be re-linked.
  async function reset({ label } = {}) {
    const a = await account();
    if (a && a.kind !== "phone") throw new MessagingError("NOT_PHONE", "Only your phone can reset messaging.");
    await store.clear();
    return setupPhone({ label: label || a?.label || "iPhone", replaceExisting: true });
  }

  // What the engine (step 3) needs to encrypt and decrypt as this device.
  async function me() {
    const a = await account();
    if (!a || a.state !== "ready") throw new MessagingError("NOT_READY", "Messaging isn't set up on this device.");
    return {
      userId, deviceId: a.deviceId, kind: a.kind, identitySignPub: a.identitySignPub,
      signPub: a.device.signPub, dhPub: a.device.dhPub, dhPriv: a.device.dhPriv,
    };
  }

  return {
    status, setupPhone, startLink, approveLink, finishLink, maintain,
    prekeyState, commitPrekeyUse, resolveDevices,
    safetyNumberWith, safetyQrWith, confirmSafetyScan, markVerified,
    myDevices, removeDevice, reset, me,
  };
}
