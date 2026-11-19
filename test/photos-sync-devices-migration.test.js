// migrations/2026-11-16b-photo-sync-devices.sql against PGlite with row security:
// the device-key functions (server only), what a device can and can't do, and the
// owner's view of their devices.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger } = USERS;
const PERSONAL = `u-${luke}`;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const isErr = (r) => typeof r === "string";
const id = (n) => `b0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const read = (f) => readFileSync(fileURLToPath(new URL(`../migrations/${f}`, import.meta.url)), "utf8");

let db;
async function asServer(sql, params = []) {
  try {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;");
    return (await db.query(sql, params)).rows;
  } catch (e) { return String(e.message || e); } finally { await db.exec("reset role;"); }
}
const item = (n, extra = {}) => ({ id: id(n), local_id: `L${n}/L0/001`, kind: "photo", taken_at: "2026-11-01T12:00:00Z", bytes: 3000000, thumb_bytes: 30000, ...extra });

let phone; // { id, hash }
beforeAll(async () => {
  db = await createDocumentsDatabase();
  await db.exec(read("2026-11-16-photos.sql"));
  await db.exec(read("2026-11-16b-photo-sync-devices.sql"));
  const [{ photo_sync_register: devId }] = await asServer(`select public.photo_sync_register($1, 'dev-luke', 'Luke''s iPhone', $2)`, [luke, sha("secret-1")]);
  phone = { id: devId, hash: sha("secret-1") };
}, 60_000);

describe("who can call the device functions", () => {
  it("only the server", async () => {
    for (const who of [luke, wife, null]) {
      expect(isErr(await asUser(db, who, `select public.photo_sync_register($1, 'x', 'n', $2)`, [luke, sha("z")]))).toBe(true);
      expect(isErr(await asUser(db, who, `select * from public.photo_sync_device($1, $2)`, [phone.id, phone.hash]))).toBe(true);
      expect(isErr(await asUser(db, who, `select public.photo_sync_add($1, $2, '[]'::jsonb)`, [phone.id, phone.hash]))).toBe(true);
    }
  });
});

describe("a device key", () => {
  it("works only with its secret, and records when it was used", async () => {
    expect(await asServer(`select * from public.photo_sync_device($1, $2)`, [phone.id, sha("wrong")])).toEqual([]);
    expect(await asServer(`select * from public.photo_sync_device($1, $2)`, [phone.id, phone.hash])).toEqual([{ user_id: luke, device_key: "dev-luke" }]);
    const [{ last_used_at }] = (await db.query(`select last_used_at from public.photo_sync_devices where id = $1`, [phone.id])).rows;
    expect(last_used_at).not.toBeNull();
  });

  it("adds photos only into its owner's Personal library, with itself as the source", async () => {
    const added = await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb) as id`, [phone.id, phone.hash, JSON.stringify([item(1), item(2, { scope: GROUP, added_by: wife }), item(3, { kind: "video", duration: 12 })])]);
    expect(added.map((r) => r.id).sort()).toEqual([id(1), id(2), id(3)]);
    const rows = (await db.query(`select id, scope, added_by, has_thumb, thumb_bytes from public.photo_items where id = any($1) order by id`, [[id(1), id(2), id(3)]])).rows;
    expect(rows.every((r) => r.scope === PERSONAL && r.added_by === luke && !r.has_thumb && r.thumb_bytes === 30000)).toBe(true);
    const sources = (await db.query(`select device_key, local_id, added_by from public.photo_sources where photo_id = $1`, [id(1)])).rows;
    expect(sources).toEqual([{ device_key: "dev-luke", local_id: "L1/L0/001", added_by: luke }]);
    // Luke sees them signed in; his wife doesn't
    expect((await asUser(db, luke, `select id from public.photo_items where id = any($1)`, [[id(1), id(2), id(3)]])).length).toBe(3);
    expect(await asUser(db, wife, `select id from public.photo_items where id = any($1)`, [[id(1)]])).toEqual([]);
  });

  it("running the same batch again changes nothing", async () => {
    const again = await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb) as id`, [phone.id, phone.hash, JSON.stringify([item(1)])]);
    expect(again.map((r) => r.id)).toEqual([id(1)]);
    expect((await db.query(`select count(*)::int n from public.photo_sources where photo_id = $1`, [id(1)])).rows[0].n).toBe(1);
  });

  it("can't attach itself to someone else's photo with the same id", async () => {
    await asUser(db, wife, `insert into public.photo_items (id, scope) values ($1, $2)`, [id(50), GROUP]);
    const got = await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb) as id`, [phone.id, phone.hash, JSON.stringify([item(50)])]);
    expect(got).toEqual([]);
    expect((await db.query(`select count(*)::int n from public.photo_sources where photo_id = $1`, [id(50)])).rows[0].n).toBe(0);
    expect((await db.query(`select scope, added_by from public.photo_items where id = $1`, [id(50)])).rows[0]).toEqual({ scope: GROUP, added_by: wife });
  });

  it("sees only its own photos, and marks only those done", async () => {
    const mine = await asServer(`select * from public.photo_sync_mine($1, $2, $3)`, [phone.id, phone.hash, [id(1), id(2), id(50), id(99)]]);
    expect(mine.map((r) => r.id).sort()).toEqual([id(1), id(2)]);
    const [{ photo_sync_done: n }] = await asServer(`select public.photo_sync_done($1, $2, $3, $4)`, [phone.id, phone.hash, [id(1), id(50)], [41000, 41000]]);
    expect(n).toBe(1);
    expect((await db.query(`select has_thumb, thumb_bytes from public.photo_items where id = $1`, [id(1)])).rows[0]).toEqual({ has_thumb: true, thumb_bytes: 41000 });
    expect((await db.query(`select has_thumb from public.photo_items where id = $1`, [id(50)])).rows[0].has_thumb).toBe(false);
    expect(isErr(await asServer(`select public.photo_sync_done($1, $2, $3, $4)`, [phone.id, phone.hash, [id(2)], [1, 2]]))).toBe(true);
  });

  it("a photo moved to Household is still recognised as already synced", async () => {
    await asUser(db, luke, `update public.photo_items set scope = $2 where id = $1`, [id(1), GROUP]);
    const mine = await asServer(`select * from public.photo_sync_mine($1, $2, $3)`, [phone.id, phone.hash, [id(1)]]);
    expect(mine).toEqual([{ id: id(1), has_thumb: true }]);
  });

  it("refuses a wrong secret, a too-large batch, and junk", async () => {
    expect(isErr(await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb)`, [phone.id, sha("nope"), JSON.stringify([item(9)])]))).toBe(true);
    expect(isErr(await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb)`, [phone.id, phone.hash, JSON.stringify(Array.from({ length: 101 }, (_, i) => item(200 + i)))]))).toBe(true);
    expect(isErr(await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb)`, [phone.id, phone.hash, JSON.stringify([item(10, { kind: "exe" })])]))).toBe(true);
    expect(isErr(await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb)`, [phone.id, phone.hash, JSON.stringify({ not: "a list" })]))).toBe(true);
  });
});

describe("the owner's devices", () => {
  it("are listed to their owner only, without the secret", async () => {
    const list = await asUser(db, luke, `select id, name, device_key, revoked_at from public.photo_sync_devices`);
    expect(list).toEqual([{ id: phone.id, name: "Luke's iPhone", device_key: "dev-luke", revoked_at: null }]);
    expect(isErr(await asUser(db, luke, `select secret_hash from public.photo_sync_devices`))).toBe(true);
    expect(await asUser(db, wife, `select id from public.photo_sync_devices`)).toEqual([]);
    expect(isErr(await asUser(db, luke, `insert into public.photo_sync_devices (user_id, device_key, secret_hash) values ($1, 'x', $2)`, [luke, sha("s")]))).toBe(true);
    expect(isErr(await asUser(db, luke, `delete from public.photo_sync_devices`))).toBe(true);
  });

  it("re-registering replaces the old key; revoking is final and stops the key at once", async () => {
    const [{ photo_sync_register: newId }] = await asServer(`select public.photo_sync_register($1, 'dev-luke', 'Luke''s iPhone', $2)`, [luke, sha("secret-2")]);
    expect(await asServer(`select * from public.photo_sync_device($1, $2)`, [phone.id, phone.hash])).toEqual([]);
    expect((await asServer(`select * from public.photo_sync_device($1, $2)`, [newId, sha("secret-2")])).length).toBe(1);
    expect(await asUser(db, wife, `update public.photo_sync_devices set revoked_at = now() where id = $1 returning id`, [newId])).toEqual([]);
    expect(await asUser(db, luke, `update public.photo_sync_devices set revoked_at = now() where id = $1 returning id`, [newId])).toEqual([{ id: newId }]);
    expect(await asServer(`select * from public.photo_sync_device($1, $2)`, [newId, sha("secret-2")])).toEqual([]);
    expect(isErr(await asUser(db, luke, `update public.photo_sync_devices set revoked_at = null where id = $1`, [newId]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_sync_devices set secret_hash = $2 where id = $1`, [newId, sha("x")]))).toBe(true);
  });

  it("a signed-in person adding a photo is still always its author", async () => {
    expect((await asUser(db, luke, `insert into public.photo_items (id, scope, added_by) values ($1, $2, $3) returning added_by`, [id(70), PERSONAL, wife]))[0].added_by).toBe(luke);
  });
});
