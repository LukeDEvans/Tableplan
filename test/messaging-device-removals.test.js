// Device removals signed by the identity (messaging/crypto/removals.js, account.js
// publishRemovals / resolveDevices) — ISSUES P1 2026-11-03 "Messaging trusts the
// server for device removal". Against the real migration and row security.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount } from "../messaging/account.js";
import { generateIdentity } from "../messaging/crypto/keys.js";
import { signDeviceRemovals, verifyDeviceRemovals } from "../messaging/crypto/removals.js";
import { toB64 } from "../messaging/crypto/bytes.js";
import { createTestDatabase, pgliteTransport, USERS } from "./messaging-pglite-harness.js";

let db;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createTestDatabase(); }, 30000);

const now = () => 1_800_000_000_000;

function device(userKey) {
  const userId = USERS[userKey];
  const server = createMessagingServer(pgliteTransport(db, userId));
  const store = createKeystore(memoryBackend());
  return { userId, server, store, account: createMessagingAccount({ server, store, userId, now }) };
}

async function linked(phone, label) {
  const b = device("luke");
  const code = await b.account.startLink({ label });
  await phone.account.approveLink(code);
  await b.account.finishLink();
  return b;
}

// What the server could do: clear revoked_at on a removed device (as the database owner).
// (session_replication_role skips the table's own guard trigger, as a hostile server could.)
const unrevoke = async (id) => {
  await db.exec("set session_replication_role = replica;");
  try { await db.query("update public.msg_devices set revoked_at = null where device_id = $1", [id]); }
  finally { await db.exec("set session_replication_role = origin;"); }
};
const lukeDevices = async (who) => (await who.account.resolveDevices([USERS.luke])).people[USERS.luke].devices.map((d) => d.deviceId).sort();

describe("signed removal statements", () => {
  it("verify only for the signing identity, the same person and the same list", () => {
    const id = generateIdentity();
    const st = { userId: USERS.luke, generation: 2, removedDeviceIds: ["b0000000-0000-0000-0000-000000000002", "a0000000-0000-0000-0000-000000000001"] };
    const sig = signDeviceRemovals(id, st);
    expect(verifyDeviceRemovals(id.signPub, { ...st, removedDeviceIds: [...st.removedDeviceIds].reverse() }, sig)).toBe(true);
    expect(verifyDeviceRemovals(generateIdentity().signPub, st, sig)).toBe(false);
    expect(verifyDeviceRemovals(id.signPub, { ...st, userId: USERS.wife }, sig)).toBe(false);
    expect(verifyDeviceRemovals(id.signPub, { ...st, removedDeviceIds: st.removedDeviceIds.slice(1) }, sig)).toBe(false);
    expect(verifyDeviceRemovals(id.signPub, { ...st, generation: 3 }, sig)).toBe(false);
  });
});

describe("removing a device", () => {
  it("stays removed for senders even if the server clears its mark", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const browser = await linked(phone, "Chrome");
    const wife = device("wife");
    await wife.account.setupPhone();
    const b = (await browser.account.me()).deviceId;
    expect(await lukeDevices(wife)).toContain(b);

    await phone.account.removeDevice(b);
    const row = (await phone.server.removals([USERS.luke]))[0];
    expect(row.removed_device_ids).toEqual([b]);
    expect(row.generation).toBe(1);

    await unrevoke(b); // the server "forgets" the removal
    const fresh = device("coworker"); // someone who never saw the removal
    await fresh.account.setupPhone();
    expect(await lukeDevices(fresh)).not.toContain(b);
    expect(await lukeDevices(wife)).not.toContain(b);
  });

  it("an older list from the server can't bring a device back", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const one = await linked(phone, "Chrome");
    const two = await linked(phone, "Mac app");
    const wife = device("wife");
    await wife.account.setupPhone();
    const id1 = (await one.account.me()).deviceId, id2 = (await two.account.me()).deviceId;

    await phone.account.removeDevice(id1);
    const gen1 = { ...(await phone.server.removals([USERS.luke]))[0] };
    expect(await lukeDevices(wife)).not.toContain(id1); // wife sees generation 1
    await phone.account.removeDevice(id2);
    expect(await lukeDevices(wife)).not.toContain(id2); // and generation 2

    // Server rolls back to generation 1 and un-revokes both.
    await db.query("update public.msg_device_removals set generation = $1, removed_device_ids = $2, sig = $3 where user_id = $4",
      [gen1.generation, gen1.removed_device_ids, gen1.sig, USERS.luke]);
    await unrevoke(id1); await unrevoke(id2);
    const seen = await lukeDevices(wife);
    expect(seen).not.toContain(id1);
    expect(seen).not.toContain(id2);
  });

  it("ignores a list not signed by the pinned identity", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const browser = await linked(phone, "Chrome");
    const b = (await browser.account.me()).deviceId;
    const wife = device("wife");
    await wife.account.setupPhone();
    // A forged list (another key) naming Luke's live browser: must not hide it.
    const forger = generateIdentity();
    const st = { userId: USERS.luke, generation: 9, removedDeviceIds: [b] };
    await db.query("insert into public.msg_device_removals (user_id, generation, removed_device_ids, sig) values ($1, $2, $3, $4)",
      [USERS.luke, 9, [b], toB64(signDeviceRemovals(forger, st))]);
    expect(await lukeDevices(wife)).toContain(b);
  });

  it("a removal made on a linked device is signed by the phone at its next upkeep", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const one = await linked(phone, "Chrome");
    const two = await linked(phone, "Mac app");
    const id2 = (await two.account.me()).deviceId;
    await one.account.removeDevice(id2);
    expect(await phone.server.removals([USERS.luke])).toEqual([]);
    const out = await phone.account.maintain({ force: true });
    expect(out.signedRemovals).toBe(true);
    expect((await phone.server.removals([USERS.luke]))[0].removed_device_ids).toEqual([id2]);
    // Nothing new: upkeep doesn't sign again.
    expect((await phone.account.maintain({ force: true })).signedRemovals).toBeUndefined();
  });

  it("only the owner can write their list; contacts can read it, strangers can't", async () => {
    const phone = device("luke");
    await phone.account.setupPhone();
    const browser = await linked(phone, "Chrome");
    await phone.account.removeDevice((await browser.account.me()).deviceId);
    const wife = device("wife"), stranger = device("stranger");
    expect((await wife.server.removals([USERS.luke])).length).toBe(1);
    expect((await stranger.server.removals([USERS.luke])).length).toBe(0);
    // Row security: her update touches no row (PostgREST answers with nothing changed).
    await wife.server.publishRemovals(USERS.luke, { generation: 5, removed_device_ids: [], sig: "A".repeat(86) }).catch(() => {});
    const r = await db.query("select generation from public.msg_device_removals where user_id = $1", [USERS.luke]);
    expect(r.rows[0].generation).toBe(1);
  });
});
