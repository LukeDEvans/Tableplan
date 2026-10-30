// The messaging account (messaging/account.js) end to end against a real Postgres
// with the real migration and row security (test/messaging-pglite-harness.js):
// phone setup, linking a browser, prekey upkeep, pinned identities, verification.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount, OPK_TARGET, SPK_ROTATE_MS } from "../messaging/account.js";
import { fromB64, toB64, utf8, fromUtf8 } from "../messaging/crypto/bytes.js";
import { createTestDatabase, pgliteTransport, USERS } from "./messaging-pglite-harness.js";

let db;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createTestDatabase(); }, 30000);

let clock = 1_800_000_000_000;
const now = () => clock;

function device(userKey, { serverOverride } = {}) {
  const userId = USERS[userKey];
  const server = serverOverride || createMessagingServer(pgliteTransport(db, userId));
  const store = createKeystore(memoryBackend());
  return { userId, server, store, account: createMessagingAccount({ server, store, userId, now }) };
}

async function linkedPair(userKey = "luke") {
  const phone = device(userKey);
  await phone.account.setupPhone();
  const browser = device(userKey);
  const code = await browser.account.startLink({ label: "Chrome on Mac" });
  await phone.account.approveLink(code);
  await browser.account.finishLink();
  return { phone, browser };
}

describe("setting up a phone", () => {
  it("registers identity, device and a full set of one-time prekeys", async () => {
    const phone = device("luke");
    expect((await phone.account.status()).state).toBe("none");
    const st = await phone.account.setupPhone();
    expect(st).toMatchObject({ state: "ready", kind: "phone" });
    const me = await phone.account.me();
    expect(await phone.server.prekeyCount(me.deviceId)).toBe(OPK_TARGET);
    const [ident] = await phone.server.identities([USERS.luke]);
    expect(fromB64(ident.sign_pub)).toEqual(me.identitySignPub);
  });

  it("is idempotent", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    await phone.account.setupPhone();
    expect((await phone.server.devices([USERS.luke])).length).toBe(1);
  });

  it("won't silently take over from another phone; replacing removes the old one", async () => {
    const first = device("luke");
    await first.account.setupPhone();
    const second = device("luke");
    await expect(second.account.setupPhone()).rejects.toMatchObject({ code: "IDENTITY_EXISTS" });
    await second.account.setupPhone({ replaceExisting: true });
    expect(await first.account.maintain({ force: true })).toEqual({ removed: true });
    expect((await first.account.status()).state).toBe("removed");
    const devices = await second.server.devices([USERS.luke]);
    expect(devices.map((d) => d.device_id)).toEqual([(await second.account.me()).deviceId]);
  });
});

describe("linking a browser", () => {
  it("links via a code the phone approves; the browser then uploads its prekeys", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const browser = device("luke");
    const code = await browser.account.startLink({ label: "Chrome on Mac" });
    expect(code.startsWith("LIVEMSG2:")).toBe(true);
    expect(code.length).toBeLessThan(520); // compact: an easy QR to scan off a screen
    expect((await browser.account.finishLink()).state).toBe("awaiting-link"); // not approved yet
    expect(await phone.account.approveLink(code)).toMatchObject({ label: "Chrome on Mac" });
    expect((await browser.account.finishLink()).state).toBe("ready");
    const me = await browser.account.me();
    expect(await browser.server.prekeyCount(me.deviceId)).toBe(OPK_TARGET);
    expect((await phone.account.myDevices()).length).toBe(2);
  });

  it("refuses a device from another account", async () => {
    const lukePhone = device("luke");
    await lukePhone.account.setupPhone();
    const wifePhone = device("wife");
    await wifePhone.account.setupPhone();
    const wifeBrowser = device("wife");
    const code = await wifeBrowser.account.startLink();
    await expect(lukePhone.account.approveLink(code)).rejects.toMatchObject({ code: "OTHER_ACCOUNT" });
  });

  it("catches a server that showed the new device the wrong identity", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const liar = createMessagingServer(pgliteTransport(db, USERS.luke));
    const fake = toB64(new Uint8Array(32).fill(7));
    const lyingServer = { ...liar, identities: async () => [{ user_id: USERS.luke, sign_pub: fake }] };
    const browser = device("luke", { serverOverride: lyingServer });
    const code = await browser.account.startLink();
    await expect(phone.account.approveLink(code)).rejects.toMatchObject({ code: "IDENTITY_MISMATCH" });
    expect((await phone.server.devices([USERS.luke])).length).toBe(1);
  });

  it("refuses a tampered or foreign code", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const browser = device("luke");
    const code = await browser.account.startLink();
    const bytes = fromB64(code.slice(9));
    bytes[1 + 16 + 16 + 8 + 32 + 5] ^= 1; // flip a bit of the DH key
    await expect(phone.account.approveLink("LIVEMSG2:" + toB64(bytes))).rejects.toMatchObject({ code: "BAD_LINK" });
    await expect(phone.account.approveLink(code.slice(0, -4))).rejects.toMatchObject({ code: "BAD_LINK" }); // truncated
    await expect(phone.account.approveLink("hello")).rejects.toMatchObject({ code: "BAD_LINK" });
  });

  it("only a phone can approve", async () => {
    const { browser } = await linkedPair();
    const another = device("luke");
    await expect(browser.account.approveLink(await another.account.startLink())).rejects.toMatchObject({ code: "NOT_PHONE" });
  });

  it("a linked device notices when the phone resets messaging", async () => {
    const { phone, browser } = await linkedPair();
    await phone.account.reset();
    await expect(browser.account.resolveDevices([USERS.luke])).rejects.toMatchObject({ code: "REPLACED" });
    expect((await browser.account.status()).state).toBe("removed");
  });
});

describe("whose devices are whose", () => {
  it("lists a contact's verified devices; strangers see none", async () => {
    await linkedPair("luke");
    const wife = device("wife");
    await wife.account.setupPhone();
    const { people } = await wife.account.resolveDevices([USERS.luke]);
    expect(people[USERS.luke].devices.map((d) => d.kind).sort()).toEqual(["linked", "phone"]);
    expect(people[USERS.luke].verified).toBe(false);
    const stranger = device("stranger");
    await stranger.account.setupPhone();
    expect((await stranger.account.resolveDevices([USERS.luke])).people[USERS.luke].devices).toEqual([]);
  });

  it("ignores a device whose certificate doesn't verify", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const row = { ...(await phone.server.device((await phone.account.me()).deviceId)) };
    // Luke's own account registers a junk device (a compromised session could).
    await phone.server.registerDevice({
      ...row, device_id: "a0000000-0000-0000-0000-00000000beef", revoked_at: undefined,
      sign_pub: toB64(new Uint8Array(32).fill(3)), dh_pub: toB64(new Uint8Array(32).fill(4)),
    });
    const wife = device("wife");
    await wife.account.setupPhone();
    const { people } = await wife.account.resolveDevices([USERS.luke]);
    expect(people[USERS.luke].devices.map((d) => d.deviceId)).toEqual([row.device_id]);
  });

  it("pins the first identity seen and flags a change (security code changed)", async () => {
    const luke = device("luke");
    await luke.account.setupPhone();
    const wife = device("wife");
    await wife.account.setupPhone();
    await wife.account.resolveDevices([USERS.luke]);
    await wife.account.markVerified(USERS.luke);
    expect((await wife.account.resolveDevices([USERS.luke])).people[USERS.luke]).toMatchObject({ verified: true, changed: false });
    await luke.account.reset();
    const after = (await wife.account.resolveDevices([USERS.luke])).people[USERS.luke];
    expect(after).toMatchObject({ verified: false, changed: true });
    expect(after.devices.length).toBe(1);
  });
});

describe("verification", () => {
  it("both phones show the same safety number; scanning verifies only the right keys", async () => {
    const luke = device("luke");
    await luke.account.setupPhone();
    const wife = device("wife");
    await wife.account.setupPhone();
    await luke.account.resolveDevices([USERS.wife]);
    await wife.account.resolveDevices([USERS.luke]);
    const n = await luke.account.safetyNumberWith(USERS.wife);
    expect(n).toMatch(/^(\d{5} ){11}\d{5}$/);
    expect(await wife.account.safetyNumberWith(USERS.luke)).toBe(n);
    expect(await luke.account.confirmSafetyScan(USERS.wife, await luke.account.safetyQrWith(USERS.wife))).toBe(false); // my own code
    expect(await luke.account.confirmSafetyScan(USERS.wife, "garbage")).toBe(false);
    expect((await luke.account.resolveDevices([USERS.wife])).people[USERS.wife].verified).toBe(false); // a failed scan verifies nothing
    expect(await luke.account.confirmSafetyScan(USERS.wife, await wife.account.safetyQrWith(USERS.luke))).toBe(true);
    expect((await luke.account.resolveDevices([USERS.wife])).people[USERS.wife].verified).toBe(true);
  });

  it("needs a known identity first", async () => {
    const luke = device("luke");
    await luke.account.setupPhone();
    await expect(luke.account.safetyNumberWith(USERS.wife)).rejects.toMatchObject({ code: "UNKNOWN" });
  });
});

describe("upkeep", () => {
  it("refills one-time prekeys and rotates the signed prekey, keeping the old one for stragglers", async () => {
    const luke = device("luke");
    await luke.account.setupPhone();
    const me = await luke.account.me();
    const wife = device("wife");
    await wife.account.setupPhone();
    for (let i = 0; i < OPK_TARGET - 3; i++) await wife.server.claimPrekey(me.deviceId);
    expect(await luke.account.maintain()).toMatchObject({ uploaded: OPK_TARGET - 3, rotated: false });
    expect(await luke.server.prekeyCount(me.deviceId)).toBe(OPK_TARGET);
    expect(await luke.account.maintain()).toEqual({ skipped: true }); // at most daily
    clock += SPK_ROTATE_MS + 1000;
    expect(await luke.account.maintain()).toMatchObject({ rotated: true });
    const row = await luke.server.device(me.deviceId);
    expect(row.spk_id).toBe(2);
    const pk = await luke.account.prekeyState();
    expect(pk.signed(1)).not.toBe(null); // previous kept for stragglers
    expect(pk.signed(2)).not.toBe(null);
  });

  it("records used one-time prekeys and first-message ephemeral keys", async () => {
    const luke = device("luke");
    await luke.account.setupPhone();
    let pk = await luke.account.prekeyState();
    expect(pk.oneTime(1)).not.toBe(null);
    await luke.account.commitPrekeyUse({ usedOneTimePrekeyIds: [1], newPrekeyMessages: [{ spkId: 1, ek: "abc" }] });
    pk = await luke.account.prekeyState();
    expect(pk.oneTime(1)).toBe(null);
    expect(pk.seen(1, "abc")).toBe(true);
    expect(pk.seen(1, "xyz")).toBe(false);
  });

  it("removing a linked device stops it", async () => {
    const { phone, browser } = await linkedPair();
    const b = await browser.account.me();
    await phone.account.removeDevice(b.deviceId);
    expect((await phone.account.myDevices()).length).toBe(1);
    expect(await browser.account.maintain({ force: true })).toEqual({ removed: true });
  });
});
