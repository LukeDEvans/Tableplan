// The messaging engine end to end: Luke's phone, Luke's linked browser and Marijane's
// phone, talking through a real Postgres with the real migration and row security
// (test/messaging-pglite-harness.js). Covers the app-layer rules from the crypto
// review (MESSAGING_DESIGN.md §4).

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadSodium, sealEnvelope, startSession, emptyRecord, toB64, fromB64 } from "../messaging/crypto/index.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount } from "../messaging/account.js";
import { createMessagingEngine, DELETE_FOR_EVERYONE_MS } from "../messaging/engine.js";
import { DEFAULT_TIMER_SECS } from "../messaging/envelope.js";
import { createTestDatabase, pgliteTransport, USERS } from "./messaging-pglite-harness.js";

let db;
let clock;
const now = () => clock;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createTestDatabase(); clock = 1_800_000_000_000; }, 30000);

function makeDevice(userKey) {
  const userId = USERS[userKey];
  const server = createMessagingServer(pgliteTransport(db, userId));
  const store = createKeystore(memoryBackend());
  const account = createMessagingAccount({ server, store, userId, now });
  const engine = createMessagingEngine({ account, server, store, userId, now });
  return { userId, server, store, account, engine };
}

async function household() {
  const lukePhone = makeDevice("luke");
  await lukePhone.account.setupPhone();
  const lukeBrowser = makeDevice("luke");
  await lukePhone.account.approveLink(await lukeBrowser.account.startLink({ label: "Chrome" }));
  await lukeBrowser.account.finishLink();
  const wife = makeDevice("wife");
  await wife.account.setupPhone();
  return { lukePhone, lukeBrowser, wife };
}

// Plays an attacker with a real device: seals any envelope to `to`'s phone over a real
// session and sends it through the server in conversation `conv`.
async function craftSend(from, to, conv, env) {
  const me = await from.account.me();
  const target = (await from.account.resolveDevices([to.userId])).people[to.userId].devices.find((d) => d.kind === "phone");
  const key = `sess:${target.deviceId}`;
  let rec = await from.store.get(key);
  if (!rec) {
    const opk = await from.server.claimPrekey(target.deviceId);
    rec = startSession(emptyRecord(), { me, them: target, bundle: { spk: target.spk, opk: opk ? { id: opk.id, pub: fromB64(opk.pub) } : null }, now: clock });
  }
  const sealed = sealEnvelope(rec, { v: 1, sentAt: new Date(clock).toISOString(), expireSecs: null, conv, ...env }, clock);
  await from.store.set(key, sealed.record);
  await from.server.send(conv, me.deviceId, [{ device: target.deviceId, ct: toB64(sealed.wire) }]);
}

const texts = async (d, conv) => (await d.engine.messages(conv)).filter((m) => m.type === "text").map((m) => m.body.text);

describe("one-on-one", () => {
  it("delivers both ways, and my other device gets copies of what I send", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendText(c.id, "Can you grab milk?");
    expect(await wife.engine.receive()).toMatchObject({ received: 2, failed: 0 }); // group_create + text
    expect(await texts(wife, c.id)).toEqual(["Can you grab milk?"]);
    await wife.engine.sendText(c.id, "Yep");
    await lukePhone.engine.receive();
    await lukeBrowser.engine.receive();
    expect(await texts(lukePhone, c.id)).toEqual(["Can you grab milk?", "Yep"]);
    expect(await texts(lukeBrowser, c.id)).toEqual(["Can you grab milk?", "Yep"]);
    expect((await lukeBrowser.engine.messages(c.id)).find((m) => m.body.text === "Can you grab milk?").from).toBe(USERS.luke);
  });

  it("reuses an existing one-on-one", async () => {
    const { lukePhone } = await household();
    const a = await lukePhone.engine.createConversation([USERS.wife]);
    const b = await lukePhone.engine.createConversation([USERS.wife]);
    expect(b.id).toBe(a.id);
  });

  it("empties the server inbox on delivery", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendText(c.id, "hi");
    const me = await wife.account.me();
    expect((await wife.server.fetchInbox(me.deviceId)).length).toBe(2);
    await wife.engine.receive();
    expect((await wife.server.fetchInbox(me.deviceId)).length).toBe(0);
  });

  it("a stranger can't start a conversation", async () => {
    await household();
    const s = makeDevice("stranger");
    await s.account.setupPhone();
    await expect(s.engine.createConversation([USERS.luke])).rejects.toThrow();
  });
});

describe("read receipts and disappearing messages", () => {
  it("receipts reach the sender; the timer starts when read and the message disappears", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    expect(c.timerSecs).toBe(DEFAULT_TIMER_SECS);
    await lukePhone.engine.sendText(c.id, "secret plan");
    await wife.engine.receive();
    let msg = (await wife.engine.messages(c.id)).find((m) => m.type === "text");
    expect(msg.expiresAt).toBe(null); // unread: waits
    clock += 3 * 24 * 3600 * 1000;
    expect(await wife.engine.markRead(c.id)).toBe(1);
    msg = (await wife.engine.messages(c.id)).find((m) => m.type === "text");
    expect(msg.expiresAt).toBe(clock + DEFAULT_TIMER_SECS * 1000);
    await lukePhone.engine.receive();
    const sent = (await lukePhone.engine.messages(c.id)).find((m) => m.type === "text");
    expect(sent.readBy[USERS.wife]).toBe(clock);
    clock += DEFAULT_TIMER_SECS * 1000 + 1;
    expect(await texts(wife, c.id)).toEqual([]); // gone on her phone
    expect(await texts(lukePhone, c.id)).toEqual([]); // and the sender's copy (sent + 1 week)
    await lukeBrowser.engine.receive();
    expect(await texts(lukeBrowser, c.id)).toEqual([]);
  });

  it("with receipts off, none are sent", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendText(c.id, "x");
    await wife.engine.receive();
    await wife.engine.setReadReceipts(false);
    await wife.engine.markRead(c.id);
    await lukePhone.engine.receive();
    const sent = (await lukePhone.engine.messages(c.id)).find((m) => m.type === "text");
    expect(sent.readBy).toEqual({});
  });

  it("a timer change by any member applies everywhere; off means messages stay", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.setTimer(c.id, null);
    await expect(wife.engine.setTimer(c.id, 123)).rejects.toThrow();
    await lukePhone.engine.receive();
    expect((await lukePhone.engine.conversations())[0].timerSecs).toBe(null);
    await lukePhone.engine.sendText(c.id, "keep me");
    clock += 365 * 24 * 3600 * 1000;
    expect(await texts(lukePhone, c.id)).toEqual(["keep me"]);
  });
});

describe("groups", () => {
  it("rename, add, remove and leave reach every member", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife], { name: "Household" });
    await wife.engine.receive();
    await wife.engine.renameGroup(c.id, "The Evanses"); // any member (decision 7)
    await lukePhone.engine.receive();
    await lukeBrowser.engine.receive();
    expect((await lukePhone.engine.conversations())[0].name).toBe("The Evanses");
    expect((await lukeBrowser.engine.conversations())[0].name).toBe("The Evanses");
    await wife.engine.removeMember(c.id, USERS.luke);
    await lukePhone.engine.receive();
    expect((await lukePhone.engine.conversations()).length).toBe(0); // removed: thread closes
    await expect(lukePhone.engine.sendText(c.id, "hello?")).rejects.toThrow();
  });

  it("a member who leaves stops receiving", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife], { name: "Plans" });
    await wife.engine.receive();
    await wife.engine.leave(c.id);
    await lukePhone.engine.receive();
    expect((await lukePhone.engine.conversations())[0].members).toEqual([USERS.luke]);
    await lukePhone.engine.sendText(c.id, "anyone?");
    expect(await wife.engine.receive()).toMatchObject({ received: 0 });
  });
});

describe("delete for everyone", () => {
  it("removes my message from their devices within 24 hours, never someone else's", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    const id = await lukePhone.engine.sendText(c.id, "oops");
    await wife.engine.receive();
    await expect(wife.engine.deleteForEveryone(c.id, id)).rejects.toThrow();
    await lukePhone.engine.deleteForEveryone(c.id, id);
    await wife.engine.receive();
    const m = (await wife.engine.messages(c.id)).find((x) => x.id === id);
    expect(m).toMatchObject({ type: "deleted", deleted: true, body: {} });
    const late = await lukePhone.engine.sendText(c.id, "too late");
    clock += DELETE_FOR_EVERYONE_MS + 1;
    await expect(lukePhone.engine.deleteForEveryone(c.id, late)).rejects.toThrow(/24 hours/);
  });
});

describe("rules the server can't enforce", () => {
  it("ignores a `sync` message from someone else (only my devices may sync)", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "hi");
    await lukePhone.engine.receive();
    // Marijane's device crafts a sync "verified" and sends it over her real session.
    const lukeMe = await lukePhone.account.me();
    const wifeMe = await wife.account.me();
    const rec = await wife.store.get(`sess:${lukeMe.deviceId}`);
    const env = { v: 1, type: "sync", conv: c.id, id: "forged-sync-1", sentAt: new Date(clock).toISOString(), expireSecs: null, body: { kind: "verified", userId: USERS.wife, verified: true } };
    const sealed = sealEnvelope(rec, env, clock);
    await wife.store.set(`sess:${lukeMe.deviceId}`, sealed.record);
    await wife.server.send(c.id, wifeMe.deviceId, [{ device: lukeMe.deviceId, ct: toB64(sealed.wire) }]);
    expect(await lukePhone.engine.receive()).toMatchObject({ received: 0, dropped: 1 });
    expect((await lukePhone.account.resolveDevices([USERS.wife])).people[USERS.wife].verified).toBe(false);
  });

  it("drops content claiming another conversation than the one the server delivered it in", async () => {
    const { lukePhone, wife } = await household();
    const c1 = await lukePhone.engine.createConversation([USERS.wife]);
    const c2 = await lukePhone.engine.createConversation([USERS.wife], { name: "Second" });
    await wife.engine.receive();
    const lukeMe = await lukePhone.account.me();
    const wifeMe = await wife.account.me();
    const rec = await wife.store.get(`sess:${lukeMe.deviceId}`) || (await wife.engine.sendText(c1.id, "start"), await wife.store.get(`sess:${lukeMe.deviceId}`));
    const env = { v: 1, type: "text", conv: c2.id, id: "smuggled-1", sentAt: new Date(clock).toISOString(), expireSecs: null, body: { text: "smuggled" } };
    const sealed = sealEnvelope(rec, env, clock);
    await wife.store.set(`sess:${lukeMe.deviceId}`, sealed.record);
    await wife.server.send(c1.id, wifeMe.deviceId, [{ device: lukeMe.deviceId, ct: toB64(sealed.wire) }]);
    await lukePhone.engine.receive();
    expect(await texts(lukePhone, c2.id)).toEqual([]);
  });

  it("a replayed ciphertext isn't shown twice", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendText(c.id, "once");
    const wifeMe = await wife.account.me();
    const rows = await wife.server.fetchInbox(wifeMe.deviceId);
    await wife.engine.receive();
    // The server (or anyone with its access) re-inserts the same ciphertext.
    const lukeMe = await lukePhone.account.me();
    await lukePhone.server.send(c.id, lukeMe.deviceId, [{ device: wifeMe.deviceId, ct: rows.at(-1).ciphertext }]);
    expect(await wife.engine.receive()).toMatchObject({ received: 0, failed: 1 });
    expect(await texts(wife, c.id)).toEqual(["once"]);
  });
});

describe("forged controls and members", () => {
  it("ignores someone else's delete-for-everyone of my message", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "mine");
    await lukePhone.engine.receive();
    const id = await lukePhone.engine.sendText(c.id, "keep this");
    await wife.engine.receive();
    await craftSend(wife, lukePhone, c.id, { type: "control", id: "forged-del", body: { op: "delete_for_everyone", target: id } });
    await lukePhone.engine.receive();
    expect(await texts(lukePhone, c.id)).toContain("keep this");
  });

  it("ignores a person the server added to a conversation that no member added", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    // A malicious server slips Sam (Luke's business contact) into the conversation.
    await db.exec(`insert into public.msg_conversation_members (conversation_id, user_id) values ('${c.id}', '${USERS.coworker}')`);
    const sam = makeDevice("coworker");
    await sam.account.setupPhone();
    await craftSend(sam, lukePhone, c.id, { type: "text", id: "intruder-1", body: { text: "hi from Sam" } });
    expect(await lukePhone.engine.receive()).toMatchObject({ received: 0, dropped: 1 });
    expect(await texts(lukePhone, c.id)).not.toContain("hi from Sam");
  });
});

describe("session repair and devices", () => {
  it("recovers when a device lost its session (cleared data)", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "one");
    await lukePhone.engine.receive();
    const wifeMe = await wife.account.me();
    await lukePhone.store.remove(`sess:${wifeMe.deviceId}`); // lost
    await wife.engine.sendText(c.id, "two (lost)");
    const r = await lukePhone.engine.receive();
    expect(r.failed).toBe(1);
    expect((await lukePhone.engine.messages(c.id)).some((m) => m.body?.op === "undecryptable")).toBe(true);
    await wife.engine.receive(); // gets the reset request
    await wife.engine.sendText(c.id, "three");
    await lukePhone.engine.receive();
    expect(await texts(lukePhone, c.id)).toEqual(["one", "three"]);
  });

  it("a removed device stops getting messages, and sending still works", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    const bMe = await lukeBrowser.account.me();
    const before = (await lukeBrowser.server.fetchInbox(bMe.deviceId)).length; // sent while it was linked
    await lukePhone.account.removeDevice(bMe.deviceId);
    clock += 61 * 1000; // past the device cache
    await wife.engine.sendText(c.id, "after removal");
    await lukePhone.engine.receive();
    expect(await texts(lukePhone, c.id)).toEqual(["after removal"]);
    expect((await lukeBrowser.server.fetchInbox(bMe.deviceId)).length).toBe(before); // nothing new
  });

  it("a newly linked device receives messages sent after it was linked (decision 2)", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "before");
    const laptop = makeDevice("luke");
    await lukePhone.account.approveLink(await laptop.account.startLink({ label: "Laptop app" }));
    await laptop.account.finishLink();
    clock += 61 * 1000;
    await wife.engine.sendText(c.id, "after");
    // Marijane's device writes to the laptop for the first time, so it also sends the
    // conversation's shape (§18): the laptop shows the message straight away.
    await laptop.engine.receive();
    expect(await texts(laptop, c.id)).toEqual(["after"]); // "before" was never sent to it
    await lukePhone.engine.receive(); // the phone notices its new sibling and sends the shape too
    await laptop.engine.receive();
    expect(await texts(laptop, c.id)).toEqual(["after"]);
    expect((await laptop.engine.conversations()).map((x) => x.id)).toEqual([c.id]);
  });

  it("cards carry their snapshot", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendCard(c.id, { kind: "recipe", ref: "r_42", snapshot: { title: "Lentil soup", subtitle: "45 min" } });
    await wife.engine.receive();
    const card = (await wife.engine.messages(c.id)).find((m) => m.type === "card");
    expect(card.body).toMatchObject({ kind: "recipe", ref: "r_42", snapshot: { title: "Lentil soup", subtitle: "45 min" } });
  });
});
