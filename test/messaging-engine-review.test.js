// Regression tests for the messaging app-layer review (MESSAGING_DESIGN.md §18). Each
// reproduces a finding against a real Postgres with the real migration and row
// security (test/messaging-pglite-harness.js), then shows it fixed.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadSodium } from "../messaging/crypto/index.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount, SPK_ROTATE_MS } from "../messaging/account.js";
import { createMessagingEngine, HELD_KEEP_MS } from "../messaging/engine.js";
import { createTestDatabase, pgliteTransport, USERS } from "./messaging-pglite-harness.js";

let db;
let clock;
const now = () => clock;
const DAY = 24 * 3600 * 1000;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createTestDatabase(); clock = 1_800_000_000_000; }, 30000);

function makeDevice(userKey, { store = createKeystore(memoryBackend()), serverWrap = (s) => s } = {}) {
  const userId = USERS[userKey];
  const server = serverWrap(createMessagingServer(pgliteTransport(db, userId)));
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

const texts = async (d, conv) => (await d.engine.messages(conv)).filter((m) => m.type === "text").map((m) => m.body.text);
const service = (sql) => db.exec(`reset role; ${sql}`);

describe("finding 1: leaving or being removed erases the messages here", () => {
  it("leave deletes the conversation's plaintext right away", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife], { name: "Plans" });
    await lukePhone.engine.sendText(c.id, "secret");
    await wife.engine.receive();
    await wife.engine.leave(c.id);
    expect(await wife.store.get(`msgs:${c.id}`)).toBe(null);
  });

  it("being removed by someone else deletes it too", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife], { name: "Plans" });
    await lukePhone.engine.sendText(c.id, "secret");
    await wife.engine.receive();
    await lukePhone.engine.removeMember(c.id, USERS.wife);
    await wife.engine.receive();
    expect(await wife.store.get(`msgs:${c.id}`)).toBe(null);
    expect((await wife.engine.conversations()).length).toBe(0);
  });

  it("the sweep erases messages a left conversation still holds (older data)", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendText(c.id, "secret");
    await wife.engine.receive();
    const conv = await wife.store.get(`conv:${c.id}`);
    await wife.store.set(`conv:${c.id}`, { ...conv, left: true }); // left, as an older build stored it
    await wife.engine.sweepAll();
    expect(await wife.store.get(`msgs:${c.id}`)).toBe(null);
  });

  it("leaving on one of my devices closes it on the others (finding 10)", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife], { name: "Plans" });
    await lukePhone.engine.sendText(c.id, "secret");
    await lukeBrowser.engine.receive();
    await lukePhone.engine.leave(c.id);
    await lukeBrowser.engine.receive();
    expect((await lukeBrowser.engine.conversations()).length).toBe(0);
    expect(await lukeBrowser.store.get(`msgs:${c.id}`)).toBe(null);
    void wife;
  });

  it("held messages expire and are capped (finding 11)", async () => {
    const { lukePhone } = await household();
    await lukePhone.store.set("held:x1", [{ at: clock - HELD_KEEP_MS - 1, row: {}, sender: {}, env: { id: "old" } }]);
    await lukePhone.store.set("held:x2", [{ at: clock, row: {}, sender: {}, env: { id: "new" } }]);
    await lukePhone.engine.sweepAll();
    expect(await lukePhone.store.get("held:x1")).toBe(null);
    expect((await lukePhone.store.get("held:x2")).length).toBe(1);
  });
});

describe("finding 3: a forged inbox row can't destroy a working session", () => {
  it("real messages already in flight still decrypt after a garbage row triggers repair", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "one");
    await lukePhone.engine.receive();
    await wife.engine.sendText(c.id, "in flight"); // waiting in Luke's inbox
    const lukeDev = (await lukePhone.account.me()).deviceId;
    const wifeDev = (await wife.account.me()).deviceId;
    // The server operator slips a garbage row in front of it, naming Marijane's device.
    await service(`insert into public.msg_inbox (id, recipient_device_id, sender_device_id, sender_user_id, conversation_id, ciphertext)
      overriding system value values (1, '${lukeDev}', '${wifeDev}', '${USERS.wife}', '${c.id}', 'AgEAAAA')`);
    const r = await lukePhone.engine.receive();
    expect(r.failed).toBe(1);
    expect(await texts(lukePhone, c.id)).toEqual(["one", "in flight"]);
  });
});

describe("finding 4: a row committed late is never skipped", () => {
  it("a lower-id row that shows up after higher ones were fetched is still delivered", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await service(`select setval(pg_get_serial_sequence('public.msg_inbox', 'id'), 1000)`);
    await wife.engine.sendText(c.id, "first");
    await lukePhone.engine.receive(); // fetched and acknowledged ids above 1000
    // A slower sender's row gets a low id but commits now (identity values are handed
    // out before commit). Re-send a real ciphertext under id 2.
    const lukeDev = (await lukePhone.account.me()).deviceId;
    const wifeDev = (await wife.account.me()).deviceId;
    const held = [];
    const capture = { ...wife.server, send: async (conv, dev, items) => { held.push(...items); return items.length; } };
    const wife2 = createMessagingEngine({ account: wife.account, server: capture, store: wife.store, userId: USERS.wife, now });
    await wife2.sendText(c.id, "late");
    const mine = held.find((i) => i.device === lukeDev);
    await service(`insert into public.msg_inbox (id, recipient_device_id, sender_device_id, sender_user_id, conversation_id, ciphertext)
      overriding system value values (500, '${lukeDev}', '${wifeDev}', '${USERS.wife}', '${c.id}', '${mine.ct}')`);
    await lukePhone.engine.receive();
    expect(await texts(lukePhone, c.id)).toEqual(["first", "late"]);
  });
});

describe("finding 5: a failure part-way through receiving loses nothing and invents nothing", () => {
  it("an acknowledgement that fails leads to no duplicates, no false 'undecryptable', no resets", async () => {
    let failAck = true;
    const { lukePhone, wife } = await household();
    const flaky = makeDevice("luke", { store: lukePhone.store, serverWrap: (s) => ({ ...s, ack: async (...a) => { if (failAck) throw new Error("network"); return s.ack(...a); } }) });
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "a");
    await wife.engine.sendText(c.id, "b");
    await flaky.engine.receive(); // filed, but the ack never reached the server
    failAck = false;
    const r = await flaky.engine.receive(); // the same rows come back
    expect(r.failed).toBe(0);
    expect(await texts(lukePhone, c.id)).toEqual(["a", "b"]);
    expect((await lukePhone.engine.messages(c.id)).some((m) => m.body?.op === "undecryptable")).toBe(false);
  });

  it("an envelope decrypted but not yet filed (the app stopped) is filed on the next run", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "parked");
    // Simulate a stop right after the record + parked envelope were stored.
    const realSet = lukePhone.store.set;
    let stopAfterPark = true;
    lukePhone.store.set = async (k, v) => { await realSet(k, v); if (stopAfterPark && k.startsWith("pend:")) { stopAfterPark = false; throw new Error("app stopped"); } };
    await lukePhone.engine.receive().catch(() => null);
    lukePhone.store.set = realSet;
    await lukePhone.engine.receive();
    expect(await texts(lukePhone, c.id)).toEqual(["parked"]);
  });
});

describe("finding 6: one unreachable device never stops a send", () => {
  it("a linked browser with an expired signed prekey is skipped; the phone still gets it", async () => {
    const { lukePhone, wife } = await household();
    const wifeBrowser = makeDevice("wife");
    await wife.account.approveLink(await wifeBrowser.account.startLink());
    await wifeBrowser.account.finishLink();
    clock += SPK_ROTATE_MS + DAY;
    await wife.account.maintain({ force: true }); // her phone rotates; the browser never opens
    clock += 31 * DAY; // the browser's signed prekey is now past 60 days
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    const id = await lukePhone.engine.sendText(c.id, "still arrives");
    await wife.engine.receive();
    expect(await texts(wife, c.id)).toEqual(["still arrives"]);
    expect((await lukePhone.engine.messages(c.id)).find((m) => m.id === id).status).toBe("sent");
  });

  it("nobody reachable shows Not delivered, and Retry sends it later", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    const wifeDev = (await wife.account.me()).deviceId;
    await service(`update public.msg_devices set revoked_at = now() where device_id = '${wifeDev}'`);
    clock += 61 * 1000;
    const id = await lukePhone.engine.sendText(c.id, "anyone?");
    expect((await lukePhone.engine.messages(c.id)).find((m) => m.id === id).status).toBe("failed");
    // She sets up again (a new device); Retry delivers it.
    const wife2 = makeDevice("wife", { store: wife.store });
    expect(await wife2.account.maintain({ force: true })).toEqual({ removed: true });
    await wife2.account.setupPhone();
    clock += 61 * 1000;
    expect(await lukePhone.engine.retry(c.id, id)).toBe("sent");
  });
});

describe("finding 7: a verified contact's changed code blocks sending until acknowledged", () => {
  it("refuses to send, stores nothing, then sends after Send anyway", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await lukePhone.account.markVerified(USERS.wife);
    const newWife = makeDevice("wife");
    await newWife.account.setupPhone({ replaceExisting: true }); // a new key (or a server swapping it)
    clock += 61 * 1000;
    await expect(lukePhone.engine.sendText(c.id, "verified-only secret")).rejects.toMatchObject({ code: "SAFETY_CHANGED" });
    expect(await texts(lukePhone, c.id)).toEqual([]);
    expect(await newWife.engine.receive()).toMatchObject({ received: 0 });
    await lukePhone.engine.acknowledgeSafetyChange(USERS.wife);
    await lukePhone.engine.sendText(c.id, "after checking");
    await newWife.engine.receive();
    expect(await texts(newWife, c.id)).toEqual(["after checking"]);
  });

  it("an unverified contact's change only shows the notice (decision 9)", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    const newWife = makeDevice("wife");
    await newWife.account.setupPhone({ replaceExisting: true });
    clock += 61 * 1000;
    await lukePhone.engine.sendText(c.id, "fine");
    expect(await texts(lukePhone, c.id)).toEqual(["fine"]);
  });
});

describe("finding 8: a linked device can't remove the phone; a removed phone recovers", () => {
  it("refuses on the browser, and a phone removed anyway re-registers under the same identity", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const phoneDev = (await lukePhone.account.me()).deviceId;
    await expect(lukeBrowser.account.removeDevice(phoneDev)).rejects.toMatchObject({ code: "NOT_PHONE" });
    await service(`update public.msg_devices set revoked_at = now() where device_id = '${phoneDev}'`); // e.g. an older build
    expect(await lukePhone.account.maintain({ force: true })).toEqual({ removed: true });
    const st = await lukePhone.account.setupPhone();
    expect(st.state).toBe("ready");
    expect(st.deviceId).not.toBe(phoneDev);
    // Same identity: Marijane sees no security-code change.
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukePhone.engine.sendText(c.id, "back");
    await wife.engine.receive();
    expect(await texts(wife, c.id)).toEqual(["back"]);
    expect((await wife.account.resolveDevices([USERS.luke])).people[USERS.luke].changed).toBe(false);
  });
});

describe("finding 12: read receipts off also hides others' receipts", () => {
  it("doesn't record their read state", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    const id = await lukePhone.engine.sendText(c.id, "x");
    await lukePhone.engine.setReadReceipts(false);
    await wife.engine.receive();
    await wife.engine.markRead(c.id);
    await lukePhone.engine.receive();
    expect((await lukePhone.engine.messages(c.id)).find((m) => m.id === id).readBy).toEqual({});
  });
});

describe("finding 13: two tabs don't overwrite each other", () => {
  it("a send in one tab and a receive in another both keep their messages", async () => {
    const { lukePhone, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await wife.engine.receive();
    await wife.engine.sendText(c.id, "from her");
    const tab2 = makeDevice("luke", { store: lukePhone.store }); // same device, second tab
    await Promise.all([lukePhone.engine.sendText(c.id, "from me"), tab2.engine.receive()]);
    expect((await texts(lukePhone, c.id)).sort()).toEqual(["from her", "from me"]);
  });
});

describe("found in UI QA: a device linked moments ago gets the next send", () => {
  it("the phone's cached device list is refreshed by the link, so the browser sees the new conversation and its copy", async () => {
    const lukePhone = makeDevice("luke");
    await lukePhone.account.setupPhone();
    const wife = makeDevice("wife");
    await wife.account.setupPhone();
    const first = await lukePhone.engine.createConversation([USERS.wife], { name: "Earlier" }); // caches Luke's devices
    await lukePhone.engine.sendText(first.id, "warm the cache");
    const browser = makeDevice("luke");
    await lukePhone.account.approveLink(await browser.account.startLink());
    await browser.account.finishLink();
    const c = await lukePhone.engine.createConversation([USERS.wife], { name: "Plans" }); // within the cache minute
    await lukePhone.engine.sendText(c.id, "milk?");
    await browser.engine.receive();
    expect(await texts(browser, c.id)).toEqual(["milk?"]);
  });

  it("a copy of my own message for a conversation this device doesn't know yet is held, then shown", async () => {
    const { lukePhone, lukeBrowser, wife } = await household();
    const c = await lukePhone.engine.createConversation([USERS.wife]);
    await lukeBrowser.engine.receive();
    await lukeBrowser.store.remove(`conv:${c.id}`); // as if the group_create never reached it
    await lukePhone.engine.sendText(c.id, "mine");
    expect(await lukeBrowser.engine.receive()).toMatchObject({ received: 0 });
    await lukePhone.store.remove("ownDevices"); // the phone sends the browser the conversation again
    await lukePhone.engine.receive();
    await lukeBrowser.engine.receive();
    expect(await texts(lukeBrowser, c.id)).toEqual(["mine"]);
    void wife;
  });
});
