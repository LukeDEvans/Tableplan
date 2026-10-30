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

import { emptyRecord, startSession, sealEnvelope, openEnvelope, toB64, fromB64 } from "./crypto/index.js";
import { DEFAULT_TIMER_SECS, TIMER_CHOICES, ENVELOPE_VERSION } from "./envelope.js";
import { withLock } from "./keystore.js";

export const DELETE_FOR_EVERYONE_MS = 24 * 3600 * 1000;
export const RESOLVE_CACHE_MS = 60 * 1000;
export const MAX_FAILED_DECRYPTS_PER_HOUR = 20;
export const RESET_REQUEST_EVERY_MS = 3600 * 1000;
const SEEN_IDS_KEEP_MS = 14 * 24 * 3600 * 1000;
const HELD_KEEP_MS = 7 * 24 * 3600 * 1000;

export function createMessagingEngine({ account, server, store, userId, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const listeners = new Set();
  const emit = (event) => { for (const fn of listeners) { try { fn(event); } catch { /* a listener's problem */ } } };
  let resolveCache = { at: 0, key: "", value: null };

  // ---- local data ------------------------------------------------------------------

  const convKey = (id) => `conv:${id}`;
  const msgsKey = (id) => `msgs:${id}`;

  async function getConv(id) { return store.get(convKey(id)); }
  async function putConv(c) { await store.set(convKey(c.id), c); }
  async function getMsgs(id) { return (await store.get(msgsKey(id))) || []; }
  async function putMsgs(id, list) { await store.set(msgsKey(id), list); }
  async function prefs() { return { readReceipts: true, ...((await store.get("prefs")) || {}) }; }

  async function conversations() {
    const keys = await store.keys("conv:");
    const out = [];
    for (const k of keys) {
      const c = await store.get(k);
      if (c && !c.left) out.push(c);
    }
    return out.sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  }

  async function messages(convId) {
    await sweepExpired(convId);
    return getMsgs(convId);
  }

  // ---- who to send to -----------------------------------------------------------------

  async function resolve(userIds) {
    const key = [...userIds].sort().join(",");
    if (resolveCache.key === key && now() - resolveCache.at < RESOLVE_CACHE_MS) return resolveCache.value;
    const value = await account.resolveDevices(userIds);
    resolveCache = { at: now(), key, value };
    return value;
  }
  const forgetResolved = () => { resolveCache = { at: 0, key: "", value: null }; };

  async function deviceFor(userIdOfSender, deviceId) {
    let { people } = await resolve([userIdOfSender]);
    let d = people[userIdOfSender]?.devices.find((x) => x.deviceId === deviceId);
    if (!d) {
      forgetResolved(); // a newly linked device: look again once
      ({ people } = await resolve([userIdOfSender]));
      d = people[userIdOfSender]?.devices.find((x) => x.deviceId === deviceId);
    }
    return d || null;
  }

  // ---- encrypting for every device (fan-out, §6) ---------------------------------------------

  async function sealFor(me, target, envelope) {
    return withLock(`sess:${target.deviceId}`, async () => {
      const key = `sess:${target.deviceId}`;
      let record = (await store.get(key)) || emptyRecord();
      if (!record.sessions.length) {
        const opk = await server.claimPrekey(target.deviceId);
        record = startSession(record, {
          me, them: target,
          bundle: { spk: target.spk, opk: opk ? { id: opk.id, pub: fromB64(opk.pub) } : null },
          now: now(),
        });
      }
      const sealed = sealEnvelope(record, envelope, now());
      await store.set(key, sealed.record); // stored BEFORE the ciphertext leaves (§4)
      return { device: target.deviceId, ct: toB64(sealed.wire) };
    });
  }

  // Send one envelope to every device of `userIds`, except this one. includeSelf adds
  // my other devices: yes for group changes (they apply them too); no for content and
  // receipts, which reach my devices as `sync` copies instead.
  async function fanOut(convId, userIds, envelope, { includeSelf = false } = {}) {
    const me = await account.me();
    const ids = [...new Set([...userIds.filter((u) => u !== userId), ...(includeSelf ? [userId] : [])])];
    const { people } = await resolve(ids);
    const items = [];
    for (const uid of ids) {
      for (const d of people[uid]?.devices || []) {
        if (d.deviceId === me.deviceId) continue;
        items.push(await sealFor(me, d, envelope));
      }
    }
    if (!items.length) return 0;
    try {
      return await server.send(convId, me.deviceId, items);
    } catch (e) {
      // A device was removed since we looked: refresh once and try again.
      if (/removed|unknown|not in this conversation/i.test(String(e.message))) {
        forgetResolved();
        const again = await resolve(ids);
        const live = new Set(Object.values(again.people).flatMap((p) => p.devices.map((d) => d.deviceId)));
        const kept = items.filter((i) => live.has(i.device));
        if (kept.length) return server.send(convId, me.deviceId, kept);
        return 0;
      }
      throw e;
    }
  }

  function envelopeFor(convId, type, body, timer) {
    return { v: ENVELOPE_VERSION, type, conv: convId, id: newId(), sentAt: new Date(now()).toISOString(), expireSecs: timer ?? null, body };
  }

  async function addLocalMessage(convId, msg) {
    const list = await getMsgs(convId);
    if (list.some((m) => m.id === msg.id)) return false;
    list.push(msg);
    list.sort((a, b) => a.sentAtMs - b.sentAtMs);
    await putMsgs(convId, list);
    const c = await getConv(convId);
    if (c) {
      c.lastAt = Math.max(c.lastAt || 0, msg.sentAtMs);
      if (msg.from !== userId && !msg.readAt && (msg.type === "text" || msg.type === "card")) c.unread = (c.unread || 0) + 1;
      await putConv(c);
    }
    return true;
  }

  // ---- conversations -------------------------------------------------------------------

  async function createConversation(memberIds, { name = null } = {}) {
    const others = [...new Set(memberIds)].filter((m) => m !== userId);
    if (!others.length) throw new Error("Pick at least one person.");
    // An existing one-on-one with the same person is reused.
    if (others.length === 1 && !name) {
      const existing = (await conversations()).find((c) => !c.name && c.members.length === 2 && c.members.includes(others[0]));
      if (existing) return existing;
    }
    const id = newId();
    await server.createConversation(id, others);
    const c = { id, members: [userId, ...others], name: name || null, timerSecs: DEFAULT_TIMER_SECS, createdAt: now(), createdBy: userId, lastAt: now(), unread: 0 };
    await putConv(c);
    await fanOut(id, c.members, envelopeFor(id, "control", { op: "group_create", name: c.name, members: c.members }, null), { includeSelf: true });
    emit({ type: "conversation", id });
    return c;
  }

  async function sendContent(convId, type, body) {
    const c = await getConv(convId);
    if (!c || c.left) throw new Error("That conversation isn't open on this device.");
    const env = envelopeFor(convId, type, body, c.timerSecs);
    const t = now();
    await addLocalMessage(convId, {
      id: env.id, from: userId, type, body, sentAtMs: t, readAt: t,
      expireSecs: c.timerSecs, expiresAt: c.timerSecs ? t + c.timerSecs * 1000 : null, readBy: {},
    });
    await fanOut(convId, c.members, env);
    emit({ type: "message", conv: convId, id: env.id });
    return env.id;
  }


  async function control(convId, body) {
    const c = await getConv(convId);
    if (!c || c.left) throw new Error("That conversation isn't open on this device.");
    const env = envelopeFor(convId, "control", body, null);
    await applyControl(c, userId, env, true);
    await fanOut(convId, body.op === "member_remove" ? [...new Set([...c.members, ...body.members])] : c.members, env, { includeSelf: true });
    return c;
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

  async function leave(convId) {
    await control(convId, { op: "member_leave" });
    await server.removeMember(convId, userId);
    const c = await getConv(convId);
    c.left = true;
    await putConv(c);
  }

  async function deleteForEveryone(convId, messageId) {
    const list = await getMsgs(convId);
    const m = list.find((x) => x.id === messageId);
    if (!m || m.from !== userId) throw new Error("You can only delete your own messages for everyone.");
    if (now() - m.sentAtMs > DELETE_FOR_EVERYONE_MS) throw new Error("Messages can be deleted for everyone within 24 hours.");
    await control(convId, { op: "delete_for_everyone", target: messageId });
  }

  async function deleteForMe(convId, messageId) {
    await putMsgs(convId, (await getMsgs(convId)).filter((m) => m.id !== messageId));
  }

  // ---- read state and receipts (decision 12) -----------------------------------------------

  async function markRead(convId) {
    const list = await getMsgs(convId);
    const t = now();
    const newlyRead = [];
    for (const m of list) {
      if (m.from !== userId && !m.readAt) {
        m.readAt = t;
        if (m.expireSecs) m.expiresAt = t + m.expireSecs * 1000; // the timer starts when read (§7)
        newlyRead.push(m.id);
      }
    }
    if (!newlyRead.length) return 0;
    await putMsgs(convId, list);
    const c = await getConv(convId);
    if (c) { c.unread = 0; await putConv(c); }
    const p = await prefs();
    if (p.readReceipts) await fanOut(convId, c.members, envelopeFor(convId, "receipt", { read: newlyRead.slice(-500) }, null));
    // My other devices learn it's read either way, so they don't show it unread.
    await fanOut(null, [], envelopeFor(convId, "sync", { kind: "read", conv: convId, upTo: newlyRead.at(-1) }, null), { includeSelf: true });
    return newlyRead.length;
  }

  async function setReadReceipts(on) {
    await store.set("prefs", { ...(await prefs()), readReceipts: Boolean(on) });
  }

  // ---- disappearing messages (§7) ------------------------------------------------------------

  async function sweepExpired(convId) {
    const list = await getMsgs(convId);
    const t = now();
    const kept = list.filter((m) => !m.expiresAt || m.expiresAt > t);
    if (kept.length !== list.length) await putMsgs(convId, kept);
    return list.length - kept.length;
  }

  async function sweepAll() {
    let n = 0;
    for (const c of await conversations()) n += await sweepExpired(c.id);
    return n;
  }

  // ---- receiving --------------------------------------------------------------------------

  async function applyControl(c, fromUser, env, mine = false) {
    const b = env.body;
    const t = now();
    const system = (text) => addLocalMessage(c.id, { id: env.id, from: fromUser, type: "system", body: { op: b.op, text }, sentAtMs: Date.parse(env.sentAt) || t, readAt: t, expiresAt: null });
    switch (b.op) {
      case "group_rename":
        c.name = b.name; await putConv(c); await system("renamed"); break;
      case "timer_set":
        c.timerSecs = b.secs; await putConv(c); await system("timer"); break;
      case "member_add":
        c.members = [...new Set([...c.members, ...b.members])]; await putConv(c); await system("added"); break;
      case "member_remove":
        c.members = c.members.filter((m) => !b.members.includes(m));
        if (b.members.includes(userId) && !mine) c.left = true;
        await putConv(c); await system("removed"); break;
      case "member_leave":
        c.members = c.members.filter((m) => m !== fromUser); await putConv(c); await system("left"); break;
      case "delete_for_everyone": {
        const list = await getMsgs(c.id);
        const target = list.find((m) => m.id === b.target);
        if (target && target.from === fromUser && (Date.parse(env.sentAt) || t) - target.sentAtMs <= DELETE_FOR_EVERYONE_MS + 5 * 60 * 1000) {
          target.type = "deleted"; target.body = {}; target.deleted = true;
          await putMsgs(c.id, list);
        }
        break;
      }
      default: break;
    }
    forgetResolved();
  }

  async function releaseHeld(convId) {
    const held = (await store.get(`held:${convId}`)) || [];
    await store.remove(`held:${convId}`);
    for (const h of held) {
      if (now() - h.at > HELD_KEEP_MS) continue;
      await handleEnvelope(h.row, h.sender, h.env, { seenHold: true });
    }
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
      if (b.kind === "sent") return handleSent(sender, b.envelope);
      if (b.kind === "verified") { await account.markVerified(b.userId, b.verified); return "ok"; }
      if (b.kind === "conv") {
        const existing = await getConv(b.conv);
        if (existing && !existing.left) return "ok";
        if (!b.members.includes(userId)) return "dropped: bad conv sync";
        await putConv({ id: b.conv, members: b.members, name: b.name, timerSecs: b.secs, createdAt: t, createdBy: userId, lastAt: t, unread: 0 });
        emit({ type: "conversation", id: b.conv });
        await releaseHeld(b.conv);
        return "ok";
      }
      if (b.kind === "read") {
        const list = await getMsgs(b.conv);
        const upTo = list.findIndex((m) => m.id === b.upTo);
        if (upTo >= 0) {
          for (const m of list.slice(0, upTo + 1)) if (m.from !== userId && !m.readAt) { m.readAt = t; if (m.expireSecs) m.expiresAt = t + m.expireSecs * 1000; }
          await putMsgs(b.conv, list);
          const c = await getConv(b.conv); if (c) { c.unread = 0; await putConv(c); }
        }
        return "ok";
      }
      return "dropped";
    }

    // Everything else belongs to the conversation the server delivered it in.
    if (!row.conversation_id || env.conv !== row.conversation_id) return "dropped: wrong conversation";
    let c = await getConv(env.conv);

    if (env.type === "control" && env.body.op === "group_create") {
      if (c && !c.left) {
        if (!c.members.includes(sender.userId)) return "dropped: not a member";
        return "ok"; // already known
      }
      const members = [...new Set(env.body.members)];
      if (!members.includes(userId) || !members.includes(sender.userId)) return "dropped: bad group";
      c = { id: env.conv, members, name: env.body.name, timerSecs: DEFAULT_TIMER_SECS, createdAt: Date.parse(env.sentAt) || t, createdBy: sender.userId, lastAt: Date.parse(env.sentAt) || t, unread: 0 };
      await putConv(c);
      emit({ type: "conversation", id: c.id });
      await releaseHeld(c.id);
      return "ok";
    }
    if (!c) {
      // A device linked recently doesn't know older conversations yet: hold the message
      // until one of my devices sends the conversation's shape (sync "conv").
      if (seenHold) return "dropped: unknown conversation";
      const held = (await store.get(`held:${env.conv}`)) || [];
      if (held.length < 200) held.push({ at: t, row: { conversation_id: row.conversation_id }, sender, env });
      await store.set(`held:${env.conv}`, held);
      delete seen[env.id]; // let it through again when released
      await store.set("seenIds", seen);
      return "held";
    }
    if (c.left) return "dropped: left";
    if (!c.members.includes(sender.userId)) return "dropped: not a member";

    if (env.type === "control") {
      if (env.body.op === "reset_session") return "ok"; // handled at the session layer
      await applyControl(c, sender.userId, env, fromMe);
      emit({ type: "conversation", id: c.id });
      return "ok";
    }

    if (env.type === "receipt") {
      const list = await getMsgs(c.id);
      const ids = new Set(env.body.read);
      for (const m of list) if (m.from === userId && ids.has(m.id)) m.readBy = { ...(m.readBy || {}), [sender.userId]: t };
      await putMsgs(c.id, list);
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
    if (!c) return "dropped: unknown conversation";
    if (env.type === "text" || env.type === "card") {
      const t = Date.parse(env.sentAt) || now();
      await addLocalMessage(env.conv, { id: env.id, from: userId, fromDevice: sender.deviceId, type: env.type, body: env.body, sentAtMs: t, readAt: t, expireSecs: env.expireSecs, expiresAt: env.expireSecs ? t + env.expireSecs * 1000 : null, readBy: {} });
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
      const record = startSession(emptyRecord(), { me, them: sender, bundle: { spk: sender.spk, opk: opk ? { id: opk.id, pub: fromB64(opk.pub) } : null }, now: t });
      const env = envelopeFor(row.conversation_id || newId(), "control", { op: "reset_session" }, null);
      const sealed = sealEnvelope(record, env, t);
      await store.set(key, sealed.record);
      await server.send(row.conversation_id, me.deviceId, [{ device: sender.deviceId, ct: toB64(sealed.wire) }]).catch(() => {});
    });
  }

  // Fetch, decrypt and file everything waiting for this device. Bounded: at most
  // `maxBatches` round trips per call.
  async function receive({ maxBatches = 5 } = {}) {
    return withLock("inbox", async () => {
      const me = await account.me();
      let cursor = (await store.get("cursor")) || 0;
      const summary = { received: 0, dropped: 0, failed: 0 };
      for (let batch = 0; batch < maxBatches; batch++) {
        const rows = await server.fetchInbox(me.deviceId, cursor, 100);
        if (!rows.length) break;
        const acks = [];
        for (const row of rows) {
          cursor = Math.max(cursor, Number(row.id));
          acks.push(row.id);
          const sender = await deviceFor(row.sender_user_id, row.sender_device_id);
          if (!sender || sender.userId !== row.sender_user_id) { summary.dropped++; continue; }
          let opened = null;
          try {
            opened = await withLock(`sess:${sender.deviceId}`, async () => {
              const key = `sess:${sender.deviceId}`;
              const prekeys = await account.prekeyState();
              const r = openEnvelope(await store.get(key), { me, them: sender, wire: fromB64(row.ciphertext), prekeys, now: now() });
              await store.set(key, r.record); // key spent even if the envelope is dropped
              await account.commitPrekeyUse({
                usedOneTimePrekeyIds: r.usedOneTimePrekeyId === null ? [] : [r.usedOneTimePrekeyId],
                newPrekeyMessages: r.newPrekeyMessage ? [r.newPrekeyMessage] : [],
              });
              if (r.envelope && r.envelope.type === "control" && r.envelope.body.op === "reset_session") {
                // Keep only the session this reset arrived on.
                const rec = await store.get(key);
                await store.set(key, { ...rec, sessions: rec.sessions.slice(0, 1) });
              }
              return r;
            });
          } catch {
            summary.failed++;
            if (await failureAllowed(sender.deviceId)) {
              await requestReset(row, sender).catch(() => {});
              await noteUndecryptable(row);
            }
            continue;
          }
          if (!opened.envelope) { summary.dropped++; continue; }
          const outcome = await handleEnvelope(row, sender, opened.envelope);
          if (outcome === "ok") summary.received++; else summary.dropped++;
        }
        await store.set("cursor", cursor); // only after the batch is filed
        await server.ack(me.deviceId, acks);
        if (rows.length < 100) break;
      }
      if (summary.received) emit({ type: "received", ...summary });
      await announceToNewDevices().catch(() => {});
      return summary;
    });
  }

  // When one of my devices is new to this one, send my devices the shape of every open
  // conversation (names, members, timers — never history). Cheap: only when my device
  // set grows.
  async function announceToNewDevices() {
    const me = await account.me();
    const { people } = await resolve([userId]);
    const mine = (people[userId]?.devices || []).map((d) => d.deviceId).filter((id) => id !== me.deviceId);
    const known = new Set((await store.get("ownDevices")) || []);
    const fresh = mine.filter((id) => !known.has(id));
    await store.set("ownDevices", mine);
    if (!fresh.length) return 0;
    let n = 0;
    for (const c of await conversations()) {
      await fanOut(null, [], envelopeFor(c.id, "sync", { kind: "conv", conv: c.id, name: c.name, members: c.members, secs: c.timerSecs }, null), { includeSelf: true });
      n++;
    }
    return n;
  }

  async function noteUndecryptable(row) {
    if (!row.conversation_id) return;
    const c = await getConv(row.conversation_id);
    if (!c) return;
    await addLocalMessage(c.id, { id: `undecryptable-${row.id}`, from: row.sender_user_id, type: "system", body: { op: "undecryptable", text: "undecryptable" }, sentAtMs: Date.parse(row.created_at) || now(), readAt: now(), expiresAt: null });
  }

  // My sent text/cards also go to my other devices as sync "sent" (so a linked
  // browser shows what I sent from the phone).
  const baseSendContent = sendContent;
  async function sendContentWithSync(convId, type, body) {
    const id = await baseSendContent(convId, type, body);
    const list = await getMsgs(convId);
    const m = list.find((x) => x.id === id);
    const env = { v: ENVELOPE_VERSION, type, conv: convId, id, sentAt: new Date(m.sentAtMs).toISOString(), expireSecs: m.expireSecs ?? null, body };
    await fanOut(null, [], envelopeFor(convId, "sync", { kind: "sent", envelope: env }, null), { includeSelf: true }).catch(() => 0);
    return id;
  }

  return {
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    conversations, messages, createConversation,
    sendText: (convId, text) => sendContentWithSync(convId, "text", { text: String(text) }),
    sendCard: (convId, card) => sendContentWithSync(convId, "card", card),
    renameGroup, setTimer, addMembers, removeMember, leave,
    deleteForEveryone, deleteForMe, markRead, setReadReceipts, prefs,
    receive, sweepAll,
  };
}
