// The messaging engine (MESSAGING_DESIGN.md §5–§7, §9): conversations, sending and
// receiving, groups, disappearing messages, receipts, delete for everyone, session
// repair. Built on account.js (who is who), server.js (the inbox) and the crypto core.
// All plaintext lives in `store` on this device only.
//
// App-layer rules from the crypto review (§4) enforced here:
//   - every session record is read, advanced and stored under a lock for that peer
//     device, before the ciphertext is sent or the message acted on;
//   - used one-time prekeys and first-message ephemeral keys are recorded after storing;
//   - a decrypted-but-invalid envelope still stores its record (key spent) and is dropped;
//   - the sender is the certified device the message decrypted under — its user must
//     match what the server recorded, `sync` only from my own devices, `control` only
//     from current members, `delete_for_everyone` only for the sender's own messages;
//   - envelope ids are de-duplicated; failed decrypts are rate-limited per device.
// And from the app-layer review (§18):
//   - receiving is crash-safe: a decrypted envelope is parked ("pend:") under the same
//     lock that stores its session record, and inbox rows are tracked by id ("doneRows")
//     instead of a cursor, so a row committed late is never skipped;
//   - session repair adds a session, it never discards the existing ones;
//   - one unreachable device never stops a send to the others, and the sender sees
//     "Not delivered" when nobody got it;
//   - a contact I verified whose security code changed can't be sent to until I
//     acknowledge it;
//   - leaving, or being removed, erases that conversation's messages here; held
//     messages expire and are capped;
//   - local reads-then-writes of a conversation run under one lock per conversation.

import { emptyRecord, startSession, sealEnvelope, openEnvelope, toB64, fromB64 } from "./crypto/index.js";
import { DEFAULT_TIMER_SECS, TIMER_CHOICES, ENVELOPE_VERSION } from "./envelope.js";
import { withLock } from "./keystore.js";
import { MessagingError } from "./account.js";

export const DELETE_FOR_EVERYONE_MS = 24 * 3600 * 1000;
export const RESOLVE_CACHE_MS = 60 * 1000;
export const MAX_FAILED_DECRYPTS_PER_HOUR = 20;
export const RESET_REQUEST_EVERY_MS = 3600 * 1000;
export const HELD_KEEP_MS = 7 * 24 * 3600 * 1000;
export const HELD_MAX_TOTAL = 1000;
const SEEN_IDS_KEEP_MS = 14 * 24 * 3600 * 1000;
const DONE_ROWS_KEEP_MS = 40 * 24 * 3600 * 1000;
const BATCH = 100;

export function createMessagingEngine({ account, server, store, userId, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const listeners = new Set();
  const emit = (event) => { for (const fn of listeners) { try { fn(event); } catch { /* a listener's problem */ } } };
  const people = new Map(); // userId → { at, person } (device lookups, per person)

  // ---- local data ------------------------------------------------------------------

  const convKey = (id) => `conv:${id}`;
  const msgsKey = (id) => `msgs:${id}`;
  const withConv = (id, fn) => withLock(`conv:${id}`, fn);

  async function getConv(id) { return store.get(convKey(id)); }
  async function getMsgs(id) { return (await store.get(msgsKey(id))) || []; }
  async function prefs() { return { readReceipts: true, ...((await store.get("prefs")) || {}) }; }

  // Read-modify-write of one conversation's record / messages, under its lock. The
  // callback must not call anything that takes the same lock.
  function updateConv(id, fn) {
    return withConv(id, async () => {
      const c = await getConv(id);
      const out = await fn(c);
      if (c) await store.set(convKey(id), c);
      return out;
    });
  }
  function updateMsgs(id, fn) {
    return withConv(id, async () => {
      const list = await getMsgs(id);
      const out = await fn(list);
      await store.set(msgsKey(id), list);
      return out;
    });
  }
  const putConvNew = (c) => withConv(c.id, () => store.set(convKey(c.id), c));

  async function allConvs() {
    const out = [];
    for (const k of await store.keys("conv:")) { const c = await store.get(k); if (c) out.push(c); }
    return out;
  }

  async function conversations() {
    return (await allConvs()).filter((c) => !c.left).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  }

  async function messages(convId) {
    await sweepExpired(convId);
    return getMsgs(convId);
  }

  // ---- who to send to -----------------------------------------------------------------

  async function resolve(userIds) {
    const ids = [...new Set(userIds)];
    const t = now();
    // My own list is re-read as soon as this phone links a device, so the very next
    // send already includes it (sync copies, group changes).
    const ownChangedAt = ids.includes(userId) ? (await store.get("ownDevicesChangedAt")) || 0 : 0;
    const missing = ids.filter((u) => {
      const e = people.get(u);
      return !e || t - e.at >= RESOLVE_CACHE_MS || (u === userId && e.at <= ownChangedAt);
    });
    if (missing.length) {
      const { people: fresh } = await account.resolveDevices(missing);
      for (const u of missing) people.set(u, { at: t, person: fresh[u] || { devices: [] } });
    }
    return { people: Object.fromEntries(ids.map((u) => [u, people.get(u).person])) };
  }
  const forgetResolved = (uid) => { if (uid) people.delete(uid); else people.clear(); };

  async function deviceFor(userIdOfSender, deviceId) {
    let { people: p } = await resolve([userIdOfSender]);
    let d = p[userIdOfSender]?.devices.find((x) => x.deviceId === deviceId);
    if (!d) {
      forgetResolved(userIdOfSender); // a newly linked device: look again once
      ({ people: p } = await resolve([userIdOfSender]));
      d = p[userIdOfSender]?.devices.find((x) => x.deviceId === deviceId);
    }
    return d || null;
  }

  // A contact I'd verified changed their security code: nothing goes to them until I
  // acknowledge it (§18 finding 7). Unverified contacts aren't blocked (decision 9).
  async function ensureSendable(userIds) {
    const others = userIds.filter((u) => u !== userId);
    if (!others.length) return;
    const { people: p } = await resolve(others);
    const blocked = others.filter((u) => p[u]?.blocked);
    if (blocked.length) throw new MessagingError("SAFETY_CHANGED", "A security code you verified has changed.", { userIds: blocked });
  }

  // ---- encrypting for every device (fan-out, §6) ---------------------------------------------

  async function sealFor(me, target, envelope) {
    return withLock(`sess:${target.deviceId}`, async () => {
      const key = `sess:${target.deviceId}`;
      let record = (await store.get(key)) || emptyRecord();
      const fresh = !record.sessions.length;
      if (fresh) {
        const opk = await server.claimPrekey(target.deviceId);
        record = startSession(record, {
          me, them: target,
          bundle: { spk: target.spk, opk: opk ? { id: opk.id, pub: fromB64(opk.pub) } : null },
          now: now(),
        });
      }
      const sealed = sealEnvelope(record, envelope, now());
      await store.set(key, sealed.record); // stored BEFORE the ciphertext leaves (§4)
      return { device: target.deviceId, owner: target.userId, ct: toB64(sealed.wire), fresh };
    });
  }

  // Send one envelope to every device of `userIds`, except this one. includeSelf adds
  // my other devices: yes for group changes (they apply them too); no for content and
  // receipts, which reach my devices as `sync` copies instead.
  // Returns { delivered, toOthers, failed }: devices reached, of which belong to other
  // people, and devices skipped. A device that can't be reached (stale prekey, removed
  // since we looked) is skipped — it never stops the send to the rest.
  async function fanOut(convId, userIds, envelope, { includeSelf = false } = {}) {
    const me = await account.me();
    const ids = [...new Set([...userIds.filter((u) => u !== userId), ...(includeSelf ? [userId] : [])])];
    const { people: p } = await resolve(ids);
    const items = [];
    let failed = 0;
    for (const uid of ids) {
      for (const d of p[uid]?.devices || []) {
        if (d.deviceId === me.deviceId) continue;
        try { items.push(await sealFor(me, d, envelope)); } catch { failed++; }
      }
    }
    const result = (sent) => ({
      delivered: sent.length,
      toOthers: sent.filter((i) => i.owner !== userId).length,
      failed: failed + items.length - sent.length,
      // Other people's devices I'd never written to before (a new install or a reset):
      freshOthers: sent.filter((i) => i.fresh && i.owner !== userId).map((i) => i.device),
    });
    if (!items.length) return result([]);
    const wire = (list) => list.map(({ device, ct }) => ({ device, ct }));
    try {
      await server.send(convId, me.deviceId, wire(items));
      return result(items);
    } catch (e) {
      if (!/removed|unknown|not in this conversation/i.test(String(e.message))) throw e;
      // Someone was removed (device or membership) since we looked: keep only the
      // devices that are still live and still in the conversation, and send once more.
      forgetResolved();
      const again = await resolve(ids);
      const live = new Set(Object.values(again.people).flatMap((x) => x.devices.map((d) => d.deviceId)));
      let members = null;
      if (convId) { try { members = new Set((await server.members(convId)).map((r) => r.user_id)); } catch { members = null; } }
      const kept = items.filter((i) => live.has(i.device) && (i.owner === userId || !members || members.has(i.owner)));
      if (!kept.length) return result([]);
      await server.send(convId, me.deviceId, wire(kept));
      return result(kept);
    }
  }

  function envelopeFor(convId, type, body, timer) {
    return { v: ENVELOPE_VERSION, type, conv: convId, id: newId(), sentAt: new Date(now()).toISOString(), expireSecs: timer ?? null, body };
  }

  async function addLocalMessage(convId, msg) {
    return withConv(convId, async () => {
      const list = await getMsgs(convId);
      if (list.some((m) => m.id === msg.id)) return false;
      list.push(msg);
      list.sort((a, b) => a.sentAtMs - b.sentAtMs);
      await store.set(msgsKey(convId), list);
      const c = await getConv(convId);
      if (c) {
        c.lastAt = Math.max(c.lastAt || 0, msg.sentAtMs);
        if (msg.from !== userId && !msg.readAt && (msg.type === "text" || msg.type === "card")) c.unread = (c.unread || 0) + 1;
        await store.set(convKey(convId), c);
      }
      return true;
    });
  }

  // ---- conversations -------------------------------------------------------------------

  async function announce(c) {
    const r = await fanOut(c.id, c.members, envelopeFor(c.id, "control", { op: "group_create", name: c.name, members: c.members }, null), { includeSelf: true });
    const othersExist = c.members.some((m) => m !== userId);
    if (!othersExist || (r.toOthers > 0 && r.failed === 0)) await updateConv(c.id, (x) => { if (x) x.announced = true; });
    return r;
  }

  async function createConversation(memberIds, { name = null } = {}) {
    const others = [...new Set(memberIds)].filter((m) => m !== userId);
    if (!others.length) throw new Error("Pick at least one person.");
    // An existing one-on-one with the same person is reused.
    if (others.length === 1 && !name) {
      const existing = (await conversations()).find((c) => !c.name && c.members.length === 2 && c.members.includes(others[0]));
      if (existing) return existing;
    }
    await ensureSendable(others);
    const id = newId();
    await server.createConversation(id, others);
    const c = { id, members: [userId, ...others], name: name || null, timerSecs: DEFAULT_TIMER_SECS, createdAt: now(), createdBy: userId, lastAt: now(), unread: 0, announced: false };
    await putConvNew(c);
    await announce(c).catch(() => null); // retried with the first message if it didn't reach everyone
    emit({ type: "conversation", id });
    return getConv(id);
  }

  // Deliver one of my messages (text/card) to the others, then a copy to my other
  // devices. Marks it sent, or "failed" (shown as Not delivered · Retry).
  async function deliver(convId, m) {
    const c = await getConv(convId);
    if (!c.announced) await announce(c).catch(() => null);
    const env = { v: ENVELOPE_VERSION, type: m.type, conv: convId, id: m.id, sentAt: new Date(m.sentAtMs).toISOString(), expireSecs: m.expireSecs ?? null, body: m.body };
    let status = "failed";
    try {
      const othersExist = c.members.some((u) => u !== userId);
      const r = await fanOut(convId, c.members, env);
      status = !othersExist || r.toOthers > 0 ? "sent" : "failed";
      if (r.freshOthers.length) await introduce(convId, r.freshOthers).catch(() => null);
    } catch { status = "failed"; }
    await updateMsgs(convId, (list) => { const x = list.find((y) => y.id === m.id); if (x) x.status = status; });
    await fanOut(null, [], envelopeFor(convId, "sync", { kind: "sent", envelope: env }, null), { includeSelf: true }).catch(() => null);
    emit({ type: "message", conv: convId, id: m.id });
    return status;
  }

  // A device that has never heard of this conversation (someone set up again, or a
  // reset) holds what it gets until it learns the conversation's shape. Tell exactly
  // those devices: the group, then the timer. Their held message is then released.
  async function introduce(convId, deviceIds) {
    const c = await getConv(convId);
    const me = await account.me();
    const want = new Set(deviceIds);
    const others = c.members.filter((u) => u !== userId);
    const { people: p } = await resolve(others);
    const targets = others.flatMap((u) => (p[u]?.devices || []).filter((d) => want.has(d.deviceId)));
    for (const env of [
      envelopeFor(convId, "control", { op: "group_create", name: c.name, members: c.members }, null),
      envelopeFor(convId, "control", { op: "timer_set", secs: c.timerSecs }, null),
    ]) {
      const items = [];
      for (const d of targets) { try { const i = await sealFor(me, d, env); items.push({ device: i.device, ct: i.ct }); } catch { /* skipped */ } }
      if (items.length) await server.send(convId, me.deviceId, items);
    }
  }

  async function sendContent(convId, type, body) {
    const c = await getConv(convId);
    if (!c || c.left) throw new Error("That conversation isn't open on this device.");
    await ensureSendable(c.members); // before anything is written or sent
    const t = now();
    const m = {
      id: newId(), from: userId, type, body, sentAtMs: t, readAt: t, status: "sending",
      expireSecs: c.timerSecs, expiresAt: c.timerSecs ? t + c.timerSecs * 1000 : null, readBy: {},
    };
    await addLocalMessage(convId, m);
    await deliver(convId, m);
    return m.id;
  }

  async function retry(convId, messageId) {
    const c = await getConv(convId);
    if (!c || c.left) throw new Error("That conversation isn't open on this device.");
    await ensureSendable(c.members);
    const m = (await getMsgs(convId)).find((x) => x.id === messageId && x.from === userId);
    if (!m || m.status !== "failed") return null;
    forgetResolved();
    return deliver(convId, m); // same envelope id: anyone who already got it drops the repeat
  }

  async function control(convId, body) {
    const c = await getConv(convId);
    if (!c || c.left) throw new Error("That conversation isn't open on this device.");
    await ensureSendable(c.members);
    const env = envelopeFor(convId, "control", body, null);
    await applyControl(c.id, userId, env, true);
    const audience = body.op === "member_remove" ? [...new Set([...c.members, ...body.members])] : c.members;
    await fanOut(convId, audience, env, { includeSelf: true });
    return getConv(convId);
  }

  async function renameGroup(convId, name) { return control(convId, { op: "group_rename", name: name || null }); }

  async function setTimer(convId, secs) {
    if (secs !== null && !TIMER_CHOICES.includes(secs)) throw new Error("Pick 1 hour, 1 day, 1 week or 4 weeks, or off.");
    return control(convId, { op: "timer_set", secs });
  }

  async function addMembers(convId, ids) {
    const c = await getConv(convId);
    const fresh = ids.filter((m) => !c.members.includes(m));
    if (!fresh.length) return c;
    await ensureSendable(fresh);
    await server.addMembers(convId, fresh);
    await control(convId, { op: "member_add", members: fresh });
    // The new people learn the whole group (name, members, timer) from a fresh group_create.
    const now2 = await getConv(convId);
    await fanOut(convId, fresh, envelopeFor(convId, "control", { op: "group_create", name: now2.name, members: now2.members }, null));
    await fanOut(convId, fresh, envelopeFor(convId, "control", { op: "timer_set", secs: now2.timerSecs }, null));
    return getConv(convId);
  }

  async function removeMember(convId, memberId) {
    await control(convId, { op: "member_remove", members: [memberId] }); // they hear it before losing access
    await server.removeMember(convId, memberId);
    return getConv(convId);
  }

  // Leaving erases this conversation's messages here (the record stays, marked left,
  // so later messages for it are dropped rather than held).
  async function closeLocally(convId) {
    await withConv(convId, async () => {
      const c = await getConv(convId);
      if (c) { c.left = true; c.unread = 0; await store.set(convKey(convId), c); }
      await store.remove(msgsKey(convId));
      await store.remove(`held:${convId}`);
    });
    emit({ type: "conversation", id: convId });
  }

  async function leave(convId) {
    await control(convId, { op: "member_leave" });
    await server.removeMember(convId, userId);
    await closeLocally(convId);
  }

  async function deleteForEveryone(convId, messageId) {
    const m = (await getMsgs(convId)).find((x) => x.id === messageId);
    if (!m || m.from !== userId) throw new Error("You can only delete your own messages for everyone.");
    if (now() - m.sentAtMs > DELETE_FOR_EVERYONE_MS) throw new Error("Messages can be deleted for everyone within 24 hours.");
    await control(convId, { op: "delete_for_everyone", target: messageId });
  }

  async function deleteForMe(convId, messageId) {
    await updateMsgs(convId, (list) => { const i = list.findIndex((m) => m.id === messageId); if (i >= 0) list.splice(i, 1); });
  }

  // ---- read state and receipts (decision 12) -----------------------------------------------

  async function markRead(convId) {
    const t = now();
    const newlyRead = await updateMsgs(convId, (list) => {
      const ids = [];
      for (const m of list) {
        if (m.from !== userId && !m.readAt) {
          m.readAt = t;
          if (m.expireSecs) m.expiresAt = t + m.expireSecs * 1000; // the timer starts when read (§7)
          ids.push(m.id);
        }
      }
      return ids;
    });
    if (!newlyRead.length) return 0;
    const c = await updateConv(convId, (x) => { if (x) x.unread = 0; return x; });
    const p = await prefs();
    if (p.readReceipts && c && !c.left) {
      await ensureSendable(c.members).then(
        () => fanOut(convId, c.members, envelopeFor(convId, "receipt", { read: newlyRead.slice(-500) }, null)),
        () => null, // a changed, unacknowledged security code: no receipt either
      ).catch(() => null);
    }
    // My other devices learn it's read either way, so they don't show it unread.
    await fanOut(null, [], envelopeFor(convId, "sync", { kind: "read", conv: convId, upTo: newlyRead.at(-1) }, null), { includeSelf: true }).catch(() => null);
    return newlyRead.length;
  }

  async function setReadReceipts(on) {
    await store.set("prefs", { ...(await prefs()), readReceipts: Boolean(on) });
  }

  // ---- disappearing messages and cleanup (§7) -------------------------------------------------

  async function sweepExpired(convId) {
    const t = now();
    return updateMsgs(convId, (list) => {
      const before = list.length;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].expiresAt && list[i].expiresAt <= t) list.splice(i, 1);
      return before - list.length;
    });
  }

  // Every conversation, including ones I left (their messages are erased), plus held
  // messages past their time or over the cap.
  async function sweepAll() {
    let n = 0;
    for (const c of await allConvs()) {
      if (c.left) {
        if (await store.get(msgsKey(c.id))) { await withConv(c.id, () => store.remove(msgsKey(c.id))); n++; }
        continue;
      }
      n += await sweepExpired(c.id);
    }
    const t = now();
    const heldKeys = await store.keys("held:");
    const all = [];
    for (const k of heldKeys) for (const h of (await store.get(k)) || []) if (t - h.at < HELD_KEEP_MS) all.push({ k, h });
    all.sort((x, y) => y.h.at - x.h.at);
    const kept = new Map();
    for (const { k, h } of all.slice(0, HELD_MAX_TOTAL)) (kept.get(k) || kept.set(k, []).get(k)).push(h);
    for (const k of heldKeys) {
      const list = (kept.get(k) || []).sort((x, y) => x.at - y.at);
      if (list.length) await store.set(k, list); else await store.remove(k);
    }
    return n;
  }

  // ---- receiving --------------------------------------------------------------------------

  async function applyControl(convId, fromUser, env, mine = false) {
    const b = env.body;
    const t = now();
    const sentAtMs = Date.parse(env.sentAt) || t;
    const system = (text) => addLocalMessage(convId, { id: env.id, from: fromUser, type: "system", body: { op: b.op, text }, sentAtMs, readAt: t, expiresAt: null });
    let close = false;
    switch (b.op) {
      case "group_rename":
        await updateConv(convId, (c) => { c.name = b.name; }); await system("renamed"); break;
      case "timer_set":
        await updateConv(convId, (c) => { c.timerSecs = b.secs; }); await system("timer"); break;
      case "member_add":
        await updateConv(convId, (c) => { c.members = [...new Set([...c.members, ...b.members])]; }); await system("added"); break;
      case "member_remove":
        await updateConv(convId, (c) => { c.members = c.members.filter((m) => !b.members.includes(m)); });
        if (b.members.includes(userId) && !mine) close = true; else await system("removed");
        break;
      case "member_leave":
        await updateConv(convId, (c) => { c.members = c.members.filter((m) => m !== fromUser); });
        if (fromUser === userId && !mine) close = true; // I left from another of my devices
        else await system("left");
        break;
      case "delete_for_everyone":
        await updateMsgs(convId, (list) => {
          const target = list.find((m) => m.id === b.target);
          if (target && target.from === fromUser && sentAtMs - target.sentAtMs <= DELETE_FOR_EVERYONE_MS + 5 * 60 * 1000) {
            target.type = "deleted"; target.body = {}; target.deleted = true;
          }
        });
        break;
      default: break;
    }
    if (close) await closeLocally(convId);
    forgetResolved();
  }

  async function releaseHeld(convId) {
    const held = await withConv(convId, async () => {
      const list = (await store.get(`held:${convId}`)) || [];
      await store.remove(`held:${convId}`);
      return list;
    });
    for (const h of held) {
      if (now() - h.at > HELD_KEEP_MS) continue;
      await handleEnvelope(h.row, h.sender, h.env, { seenHold: true });
    }
  }

  async function hold(convId, row, sender, env, seen, seenHold) {
    if (seenHold) return "dropped: unknown conversation";
    await withConv(convId, async () => {
      const held = (await store.get(`held:${convId}`)) || [];
      if (held.length < 200) held.push({ at: now(), row: { conversation_id: row.conversation_id }, sender, env });
      await store.set(`held:${convId}`, held);
    });
    delete seen[env.id]; // let it through again when released
    await store.set("seenIds", seen);
    return "held";
  }

  async function handleEnvelope(row, sender, env, { seenHold = false } = {}) {
    const t = now();
    const seen = (await store.get("seenIds")) || {};
    if (seen[env.id]) return "duplicate";
    seen[env.id] = t;
    for (const [k, at] of Object.entries(seen)) if (t - at > SEEN_IDS_KEEP_MS) delete seen[k];
    await store.set("seenIds", seen);

    const fromMe = sender.userId === userId;

    if (env.type === "sync") {
      if (!fromMe) return "dropped: sync from someone else";
      const b = env.body;
      if (b.kind === "sent") {
        const out = await handleSent(sender, b.envelope);
        if (out !== "unknown") return out;
        // A copy for a conversation this device hasn't learned yet: hold it like any
        // other message until the conversation's shape arrives.
        return hold(b.envelope.conv, row, sender, env, seen, seenHold);
      }
      if (b.kind === "verified") { await account.markVerified(b.userId, b.verified); forgetResolved(b.userId); return "ok"; }
      if (b.kind === "conv") {
        const existing = await getConv(b.conv);
        if (existing) return "ok"; // known, or left on purpose
        if (!b.members.includes(userId)) return "dropped: bad conv sync";
        await putConvNew({ id: b.conv, members: b.members, name: b.name, timerSecs: b.secs, createdAt: t, createdBy: userId, lastAt: t, unread: 0, announced: true });
        emit({ type: "conversation", id: b.conv });
        await releaseHeld(b.conv);
        return "ok";
      }
      if (b.kind === "read") {
        const changed = await updateMsgs(b.conv, (list) => {
          const upTo = list.findIndex((m) => m.id === b.upTo);
          if (upTo < 0) return false;
          for (const m of list.slice(0, upTo + 1)) if (m.from !== userId && !m.readAt) { m.readAt = t; if (m.expireSecs) m.expiresAt = t + m.expireSecs * 1000; }
          return true;
        });
        if (changed) await updateConv(b.conv, (c) => { if (c) c.unread = 0; });
        return "ok";
      }
      return "dropped";
    }

    // Everything else belongs to the conversation the server delivered it in.
    if (!row.conversation_id || env.conv !== row.conversation_id) return "dropped: wrong conversation";
    const c = await getConv(env.conv);

    if (env.type === "control" && env.body.op === "group_create") {
      if (c) {
        if (c.left) return "dropped: left";
        if (!c.members.includes(sender.userId)) return "dropped: not a member";
        return "ok"; // already known
      }
      const members = [...new Set(env.body.members)];
      if (!members.includes(userId) || !members.includes(sender.userId)) return "dropped: bad group";
      await putConvNew({ id: env.conv, members, name: env.body.name, timerSecs: DEFAULT_TIMER_SECS, createdAt: Date.parse(env.sentAt) || t, createdBy: sender.userId, lastAt: Date.parse(env.sentAt) || t, unread: 0, announced: true });
      emit({ type: "conversation", id: env.conv });
      await releaseHeld(env.conv);
      return "ok";
    }
    if (!c) {
      // A device linked recently doesn't know older conversations yet: hold the message
      // until one of my devices sends the conversation's shape (sync "conv"). Bounded:
      // 200 per conversation here, HELD_MAX_TOTAL overall and 7 days (sweepAll).
      return hold(env.conv, row, sender, env, seen, seenHold);
    }
    if (c.left) return "dropped: left";
    if (!c.members.includes(sender.userId)) return "dropped: not a member";

    if (env.type === "control") {
      if (env.body.op === "reset_session") return "ok"; // handled at the session layer
      // `mine` means "applied here, by this device" — a change from my other device is
      // received like anyone else's (so a leave there closes the conversation here).
      await applyControl(c.id, sender.userId, env, false);
      emit({ type: "conversation", id: c.id });
      return "ok";
    }

    if (env.type === "receipt") {
      // Read receipts off also hides others' receipts from me (Signal's rule; decision 12).
      if (!(await prefs()).readReceipts) return "ok";
      const ids = new Set(env.body.read);
      await updateMsgs(c.id, (list) => { for (const m of list) if (m.from === userId && ids.has(m.id)) m.readBy = { ...(m.readBy || {}), [sender.userId]: t }; });
      emit({ type: "receipt", conv: c.id });
      return "ok";
    }

    // text / card from someone else (my own copies arrive as sync "sent")
    if (fromMe) return "dropped: own content without sync";
    await addLocalMessage(c.id, {
      id: env.id, from: sender.userId, fromDevice: sender.deviceId, type: env.type, body: env.body,
      sentAtMs: Date.parse(env.sentAt) || t, receivedAt: t, readAt: null, expireSecs: env.expireSecs, expiresAt: null,
    });
    emit({ type: "message", conv: c.id, id: env.id });
    return "ok";
  }

  // A copy of something I sent from another of my devices.
  async function handleSent(sender, env) {
    const c = await getConv(env.conv);
    if (!c) return "unknown";
    if (c.left) return "dropped: left";
    if (env.type === "text" || env.type === "card") {
      const t = Date.parse(env.sentAt) || now();
      await addLocalMessage(env.conv, { id: env.id, from: userId, fromDevice: sender.deviceId, type: env.type, body: env.body, sentAtMs: t, readAt: t, status: "sent", expireSecs: env.expireSecs, expiresAt: env.expireSecs ? t + env.expireSecs * 1000 : null, readBy: {} });
      emit({ type: "message", conv: env.conv, id: env.id });
    }
    return "ok";
  }

  async function failureAllowed(deviceId) {
    const t = now();
    const f = (await store.get("fails")) || {};
    const recent = (f[deviceId] || []).filter((at) => t - at < 3600 * 1000);
    recent.push(t);
    f[deviceId] = recent;
    await store.set("fails", f);
    return recent.length <= MAX_FAILED_DECRYPTS_PER_HOUR;
  }

  // Ask a device whose message we couldn't read to start over (§4 session repair).
  // It ADDS a fresh session; existing ones stay, so a forged row can't make real
  // in-flight messages undecryptable (§18 finding 3).
  async function requestReset(row, sender) {
    const t = now();
    const resets = (await store.get("resets")) || {};
    if (t - (resets[sender.deviceId] || 0) < RESET_REQUEST_EVERY_MS) return;
    resets[sender.deviceId] = t;
    await store.set("resets", resets);
    const me = await account.me();
    await withLock(`sess:${sender.deviceId}`, async () => {
      const key = `sess:${sender.deviceId}`;
      const opk = await server.claimPrekey(sender.deviceId);
      const record = startSession((await store.get(key)) || emptyRecord(), { me, them: sender, bundle: { spk: sender.spk, opk: opk ? { id: opk.id, pub: fromB64(opk.pub) } : null }, now: t });
      const env = envelopeFor(row.conversation_id || newId(), "control", { op: "reset_session" }, null);
      const sealed = sealEnvelope(record, env, t);
      await store.set(key, sealed.record);
      await server.send(row.conversation_id, me.deviceId, [{ device: sender.deviceId, ct: toB64(sealed.wire) }]).catch(() => {});
    });
  }

  async function doneRows() { return (await store.get("doneRows")) || {}; }

  async function markDone(rowId) {
    const d = await doneRows();
    d[rowId] = now();
    await store.set("doneRows", d);
  }

  // Envelopes decrypted but not yet filed (the app stopped in between): file them.
  async function drainPending(summary) {
    const keys = (await store.keys("pend:")).sort((a, b) => Number(a.slice(5)) - Number(b.slice(5))); // inbox order
    for (const k of keys) {
      const p = await store.get(k);
      if (p) {
        const outcome = await handleEnvelope(p.row, p.sender, p.env);
        if (outcome === "ok") summary.received++; else summary.dropped++;
      }
      await store.remove(k);
    }
  }

  // One inbox row. Returns "done" when it's settled (filed, dropped or failed) and can
  // be acknowledged; throws on a network problem so the row is tried again later.
  async function processRow(me, row, summary) {
    const sender = await deviceFor(row.sender_user_id, row.sender_device_id);
    if (!sender || sender.userId !== row.sender_user_id) { summary.dropped++; await markDone(row.id); return; }
    let parked = false;
    try {
      parked = await withLock(`sess:${sender.deviceId}`, async () => {
        if ((await doneRows())[row.id]) return false; // another tab got here first
        const key = `sess:${sender.deviceId}`;
        const prekeys = await account.prekeyState();
        const r = openEnvelope(await store.get(key), { me, them: sender, wire: fromB64(row.ciphertext), prekeys, now: now() });
        // Session record, parked envelope and "done" are written together under this lock,
        // so a crash can't spend the key without the message being filed later.
        await store.set(key, r.record);
        if (r.envelope) await store.set(`pend:${row.id}`, { row: { id: row.id, conversation_id: row.conversation_id }, sender, env: r.envelope });
        await markDone(row.id);
        await account.commitPrekeyUse({
          usedOneTimePrekeyIds: r.usedOneTimePrekeyId === null ? [] : [r.usedOneTimePrekeyId],
          newPrekeyMessages: r.newPrekeyMessage ? [r.newPrekeyMessage] : [],
        });
        if (!r.envelope) summary.dropped++;
        return Boolean(r.envelope);
      });
    } catch {
      summary.failed++;
      await markDone(row.id);
      if (await failureAllowed(sender.deviceId)) {
        await requestReset(row, sender).catch(() => {});
        await noteUndecryptable(row);
      }
      return;
    }
    if (parked) await drainPending(summary);
  }

  // Fetch, decrypt and file everything waiting for this device. Rows are deleted on
  // acknowledgement, so each batch reads from the start (ordered by id); rows already
  // handled are only acknowledged. Bounded: at most `maxBatches` round trips per call.
  async function receive({ maxBatches = 5 } = {}) {
    return withLock("inbox", async () => {
      const me = await account.me();
      const summary = { received: 0, dropped: 0, failed: 0 };
      await drainPending(summary);
      for (let batch = 0; batch < maxBatches; batch++) {
        const rows = await server.fetchInbox(me.deviceId, 0, BATCH);
        if (!rows.length) break;
        const acks = [];
        let stopped = false;
        for (const row of rows) {
          if ((await doneRows())[row.id]) { acks.push(row.id); continue; }
          try {
            await processRow(me, row, summary);
            acks.push(row.id);
          } catch {
            stopped = true; // network trouble: the rest stays for the next try
            break;
          }
        }
        if (acks.length) await server.ack(me.deviceId, acks).catch(() => { stopped = true; });
        if (stopped || rows.length < BATCH) break;
      }
      const d = await doneRows();
      const t = now();
      let pruned = false;
      for (const [k, at] of Object.entries(d)) if (t - at > DONE_ROWS_KEEP_MS) { delete d[k]; pruned = true; }
      if (pruned) await store.set("doneRows", d);
      if (summary.received) emit({ type: "received", ...summary });
      await announceToNewDevices().catch(() => {});
      return summary;
    });
  }

  // When one of my devices is new to this one, send my devices the shape of every open
  // conversation (names, members, timers — never history). Cheap: only when my device
  // set grows; remembered only once the announcement went out.
  async function announceToNewDevices() {
    const me = await account.me();
    const { people: p } = await resolve([userId]);
    const mine = (p[userId]?.devices || []).map((d) => d.deviceId).filter((id) => id !== me.deviceId);
    const known = new Set((await store.get("ownDevices")) || []);
    const fresh = mine.filter((id) => !known.has(id));
    if (!fresh.length) { if (mine.length !== known.size) await store.set("ownDevices", mine); return 0; }
    let n = 0;
    for (const c of await conversations()) {
      await fanOut(null, [], envelopeFor(c.id, "sync", { kind: "conv", conv: c.id, name: c.name, members: c.members, secs: c.timerSecs }, null), { includeSelf: true });
      n++;
    }
    await store.set("ownDevices", mine);
    return n;
  }

  async function noteUndecryptable(row) {
    if (!row.conversation_id) return;
    const c = await getConv(row.conversation_id);
    if (!c || c.left) return;
    await addLocalMessage(c.id, { id: `undecryptable-${row.id}`, from: row.sender_user_id, type: "system", body: { op: "undecryptable", text: "undecryptable" }, sentAtMs: Date.parse(row.created_at) || now(), readAt: now(), expiresAt: null });
  }

  // Acknowledge a contact's changed security code so messages can go to them again.
  async function acknowledgeSafetyChange(otherId) {
    await account.acknowledgeChange(otherId);
    forgetResolved(otherId);
  }

  return {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    conversations, messages, createConversation,
    sendText: (convId, text) => sendContent(convId, "text", { text: String(text) }),
    sendCard: (convId, card) => sendContent(convId, "card", card),
    retry, renameGroup, setTimer, addMembers, removeMember, leave,
    deleteForEveryone, deleteForMe, markRead, setReadReceipts, prefs,
    receive, sweepAll, acknowledgeSafetyChange,
  };
}
