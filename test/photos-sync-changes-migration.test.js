// migrations/2026-11-16c-photo-sync-changes.sql against PGlite with row security:
// a phone keeping Liv matched to its library (changes and deletions), and what it
// must never reach.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createDocumentsDatabase, asUser, USERS } from "./documents-pglite-harness.js";

const { luke, wife } = USERS;
const sha = (s) => createHash("sha256").update(s).digest("hex");
const isErr = (r) => typeof r === "string";
const id = (n) => `d0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const read = (f) => readFileSync(fileURLToPath(new URL(`../migrations/${f}`, import.meta.url)), "utf8");

let db;
async function asServer(sql, params = []) {
  try {
    await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;");
    return (await db.query(sql, params)).rows;
  } catch (e) { return String(e.message || e); } finally { await db.exec("reset role;"); }
}
const item = (n, extra = {}) => ({ id: id(n), local_id: `L${n}/L0/001`, kind: "photo", taken_at: "2026-11-01T12:00:00Z", bytes: 3000000, thumb_bytes: 30000, lat: 44.9, lng: -93.2, ...extra });
const row = async (n) => (await db.query(`select favorite, taken_at, lat, lng, deleted_at, scope, added_by, burst_id from public.photo_items where id = $1`, [id(n)])).rows[0];
const source = async (n) => (await db.query(`select missing_at from public.photo_sources where photo_id = $1 and kind = 'iphone'`, [id(n)])).rows[0];

let phone; let wifePhone;
beforeAll(async () => {
  db = await createDocumentsDatabase();
  await db.exec(read("2026-11-16-photos.sql"));
  await db.exec(read("2026-11-16b-photo-sync-devices.sql"));
  await db.exec(read("2026-11-16c-photo-sync-changes.sql"));
  const [{ r: a }] = await asServer(`select public.photo_sync_register($1, 'dev-luke', 'Luke', $2) as r`, [luke, sha("s1")]);
  const [{ r: b }] = await asServer(`select public.photo_sync_register($1, 'dev-wife', 'Wife', $2) as r`, [wife, sha("s2")]);
  phone = { id: a, hash: sha("s1") };
  wifePhone = { id: b, hash: sha("s2") };
  await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb)`, [phone.id, phone.hash, JSON.stringify([1, 2, 3, 4, 5].map((n) => item(n)))]);
  await asServer(`select * from public.photo_sync_add($1, $2, $3::jsonb)`, [wifePhone.id, wifePhone.hash, JSON.stringify([item(9)])]);
}, 60_000);

const update = (dev, items) => asServer(`select public.photo_sync_update($1, $2, $3::jsonb) as r`, [dev.id, dev.hash, JSON.stringify(items)]);
const gone = (dev, ids) => asServer(`select public.photo_sync_gone($1, $2, $3::uuid[]) as r`, [dev.id, dev.hash, ids]);

describe("who can call them", () => {
  it("only the server, and only with the device's secret", async () => {
    for (const who of [luke, wife, null]) {
      expect(isErr(await asUser(db, who, `select public.photo_sync_update($1, $2, '[]'::jsonb)`, [phone.id, phone.hash]))).toBe(true);
      expect(isErr(await asUser(db, who, `select public.photo_sync_gone($1, $2, '{}'::uuid[])`, [phone.id, phone.hash]))).toBe(true);
    }
    expect(isErr(await update({ id: phone.id, hash: sha("wrong") }, [{ id: id(1), favorite: true }]))).toBe(true);
    expect(isErr(await gone({ id: phone.id, hash: sha("wrong") }, [id(1)]))).toBe(true);
  });
});

describe("photo_sync_update", () => {
  it("brings the phone's details across, including a removed place", async () => {
    expect(await update(phone, [{ id: id(1), favorite: true, taken_at: "2025-06-01T08:00:00Z", lat: null, lng: null }])).toEqual([{ r: 1 }]);
    const r = await row(1);
    expect(r.favorite).toBe(true);
    expect(new Date(r.taken_at).toISOString()).toBe("2025-06-01T08:00:00.000Z");
    expect(r.lat).toBeNull();
    expect(r.scope).toBe(`u-${luke}`);
    expect(r.added_by).toBe(luke);
  });

  it("never reaches another person's photo or one this phone didn't add", async () => {
    expect(await update(phone, [{ id: id(9), favorite: true }])).toEqual([{ r: 0 }]);
    expect((await row(9)).favorite).toBe(false);
    expect(await update(wifePhone, [{ id: id(2), favorite: true }])).toEqual([{ r: 0 }]);
    expect((await row(2)).favorite).toBe(false);
  });

  it("refuses a batch over 100", async () => {
    expect(isErr(await update(phone, Array.from({ length: 101 }, (_, i) => ({ id: id(1000 + i) }))))).toBe(true);
  });
});

describe("photo_sync_gone", () => {
  it("moves a photo deleted on the phone to Recently deleted and marks the source missing", async () => {
    expect(await gone(phone, [id(3)])).toEqual([{ r: 1 }]);
    expect((await row(3)).deleted_at).not.toBeNull();
    expect((await source(3)).missing_at).not.toBeNull();
  });

  it("keeps the first deletion time on a repeat", async () => {
    const before = (await row(3)).deleted_at;
    expect(await gone(phone, [id(3)])).toEqual([{ r: 0 }]);
    expect((await row(3)).deleted_at).toEqual(before);
  });

  it("never reaches another person's photo", async () => {
    expect(await gone(phone, [id(9)])).toEqual([{ r: 0 }]);
    expect((await row(9)).deleted_at).toBeNull();
    expect((await source(9)).missing_at).toBeNull();
  });

  it("leaves a photo another source still holds", async () => {
    await db.query(`insert into public.photo_sources (photo_id, kind, device_key, local_id, added_by) values ($1, 'upload', 'web', 'u-4', $2)`, [id(4), luke]);
    expect(await gone(phone, [id(4)])).toEqual([{ r: 0 }]);
    expect((await row(4)).deleted_at).toBeNull();
    expect((await source(4)).missing_at).not.toBeNull();
  });

  it("a photo put back on the phone clears missing, but stays deleted until the person puts it back in Liv", async () => {
    expect(await update(phone, [{ id: id(3), favorite: false }])).toEqual([{ r: 1 }]);
    expect((await source(3)).missing_at).toBeNull();
    expect((await row(3)).deleted_at).not.toBeNull();
  });

  it("refuses a batch over 200", async () => {
    expect(isErr(await gone(phone, Array.from({ length: 201 }, (_, i) => id(2000 + i))))).toBe(true);
  });
});

describe("the person, in Liv", () => {
  it("can put a deleted photo back and favourite one, but not reach the sync functions' rules", async () => {
    expect(isErr(await asUser(db, luke, `update public.photo_items set deleted_at = null where id = $1`, [id(3)]))).toBe(false);
    expect((await row(3)).deleted_at).toBeNull();
    expect(isErr(await asUser(db, wife, `update public.photo_items set deleted_at = now() where id = $1`, [id(5)]))).toBe(false);
    expect((await row(5)).deleted_at).toBeNull(); // her update matched nothing: Luke's Personal photo isn't hers
  });
});
