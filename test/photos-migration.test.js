// Access rules of migrations/2026-11-16-photos.sql, against PGlite with row security:
// Luke, his wife (same household), a coworker (business space only), a stranger and anon.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger, coworker } = USERS;
const PERSONAL = `u-${luke}`;
const WIFE_PERSONAL = `u-${wife}`;
const isErr = (r) => typeof r === "string";
const id = (n) => `a0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const addPhoto = (who, n, scope, extra = {}) => asUser(db, who,
  `insert into public.photo_items (id, scope, kind, taken_at, bytes, lat, lng, added_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, added_by`,
  [id(n), scope, extra.kind ?? "photo", "2026-11-01T12:00:00Z", 4_000_000, extra.lat ?? 44.98, extra.lng ?? -93.26, extra.addedBy ?? null]);
const addSource = (who, n, photo, local) => asUser(db, who,
  `insert into public.photo_sources (photo_id, kind, device_key, local_id) values ($1, 'iphone', $2, $3) returning id, added_by`,
  [photo, `dev-${n}`, local]);

let db;

beforeAll(async () => {
  db = await createDocumentsDatabase();
  await db.exec(readFileSync(fileURLToPath(new URL("../migrations/2026-11-16-photos.sql", import.meta.url)), "utf8"));
}, 60_000);

describe("photo records", () => {
  it("each person adds to their own Personal; household members add to Household; the author is set by the database", async () => {
    const mine = await addPhoto(luke, 1, PERSONAL, { addedBy: wife });
    expect(mine[0].added_by).toBe(luke);
    expect((await addPhoto(wife, 2, GROUP))[0].added_by).toBe(wife);
    expect(isErr(await addPhoto(wife, 3, PERSONAL))).toBe(true);
    expect(isErr(await addPhoto(stranger, 4, GROUP))).toBe(true);
    expect(isErr(await addPhoto(coworker, 5, GROUP))).toBe(true);
    expect(isErr(await addPhoto(null, 6, GROUP))).toBe(true);
  });

  it("Personal stays private; Household is shared; outsiders see nothing", async () => {
    expect((await asUser(db, luke, `select id from public.photo_items order by id`)).map((r) => r.id)).toEqual([id(1), id(2)]);
    expect((await asUser(db, wife, `select id from public.photo_items`)).map((r) => r.id)).toEqual([id(2)]);
    expect(await asUser(db, stranger, `select id from public.photo_items`)).toEqual([]);
    expect(await asUser(db, coworker, `select id from public.photo_items`)).toEqual([]);
    expect(isErr(await asUser(db, null, `select id from public.photo_items`))).toBe(true);
  });

  it("a photo moves from Personal to Household; nobody can move one into a scope they can't use", async () => {
    await addPhoto(luke, 10, PERSONAL);
    expect(await asUser(db, luke, `update public.photo_items set scope = $2 where id = $1 returning scope`, [id(10), GROUP])).toEqual([{ scope: GROUP }]);
    expect(await asUser(db, wife, `select id from public.photo_items where id = $1`, [id(10)])).toEqual([{ id: id(10) }]);
    // the wife can't push a household photo into Luke's Personal, or into her own (she has none in use here is fine) — only scopes she may use
    expect(isErr(await asUser(db, wife, `update public.photo_items set scope = $2 where id = $1`, [id(2), PERSONAL]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_items set scope = 'some-other-group' where id = $1`, [id(2)]))).toBe(true);
    // she can't reach into Luke's Personal at all
    expect(await asUser(db, wife, `update public.photo_items set favorite = true where id = $1 returning id`, [id(1)])).toEqual([]);
    // moving back to Personal is Luke's to do, and then she loses sight of it
    await asUser(db, luke, `update public.photo_items set scope = $2 where id = $1`, [id(10), PERSONAL]);
    expect(await asUser(db, wife, `select id from public.photo_items where id = $1`, [id(10)])).toEqual([]);
    expect(await asUser(db, wife, `update public.photo_items set scope = $2 where id = $1 returning id`, [id(10), WIFE_PERSONAL])).toEqual([]);
  });

  it("members change favourites and details; the id, author and dates are fixed", async () => {
    const before = (await asUser(db, wife, `select created_at, updated_at from public.photo_items where id = $1`, [id(2)]))[0];
    expect(isErr(await asUser(db, luke, `update public.photo_items set favorite = true, labels = '{beach}', has_thumb = true, thumb_bytes = 31000 where id = $1`, [id(2)]))).toBe(false);
    const after = (await asUser(db, wife, `select favorite, created_at, updated_at from public.photo_items where id = $1`, [id(2)]))[0];
    expect(after.favorite).toBe(true);
    expect(after.created_at).toEqual(before.created_at);
    expect(after.updated_at >= before.updated_at).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_items set id = $2 where id = $1`, [id(2), id(99)]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_items set added_by = $2 where id = $1`, [id(2), luke]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_items set created_at = now() where id = $1`, [id(2)]))).toBe(true);
  });

  it("limits: kind, place, sizes", async () => {
    expect(isErr(await addPhoto(luke, 20, PERSONAL, { kind: "exe" }))).toBe(true);
    expect(isErr(await addPhoto(luke, 21, PERSONAL, { lat: 200 }))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_items set thumb_bytes = 9000000 where id = $1`, [id(1)]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_items set content_hash = 'not hex!' where id = $1`, [id(1)]))).toBe(true);
    expect(isErr(await addPhoto(luke, 22, PERSONAL, { kind: "video" }))).toBe(false);
  });
});

describe("where originals are", () => {
  it("a source is added to a photo I can see, once, and follows the photo's privacy", async () => {
    const s = await addSource(luke, 1, id(1), "ABC-123/L0/001");
    expect(s[0].added_by).toBe(luke);
    expect(isErr(await addSource(luke, 1, id(1), "ABC-123/L0/001"))).toBe(true); // a re-sync can't double it
    expect(isErr(await addSource(wife, 2, id(1), "x"))).toBe(true);              // Luke's Personal photo
    expect(isErr(await addSource(stranger, 3, id(2), "x"))).toBe(true);
    expect(isErr(await addSource(wife, 4, id(2), "W-1"))).toBe(false);
    expect((await asUser(db, wife, `select local_id from public.photo_sources order by local_id`)).map((r) => r.local_id)).toEqual(["W-1"]);
    expect(await asUser(db, stranger, `select id from public.photo_sources`)).toEqual([]);
  });

  it("a source can be marked missing, but never re-pointed", async () => {
    expect(isErr(await asUser(db, luke, `update public.photo_sources set missing_at = now() where local_id = 'ABC-123/L0/001'`))).toBe(false);
    expect(isErr(await asUser(db, luke, `update public.photo_sources set photo_id = $1 where local_id = 'ABC-123/L0/001'`, [id(2)]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.photo_sources set local_id = 'other' where local_id = 'ABC-123/L0/001'`))).toBe(true);
    expect(isErr(await asUser(db, luke, `delete from public.photo_sources where local_id = 'ABC-123/L0/001'`))).toBe(true);
  });
});

describe("deleting and thumbnails", () => {
  it("only Recently deleted for 30 days lets a photo go, with its sources and its thumbnail", async () => {
    expect(isErr(await asUser(db, luke, `delete from public.photo_items where id = $1`, [id(1)]))).toBe(true);
    expect(await asUser(db, luke, `select public.photo_blob_allowed($1, true) ok`, [id(1)])).toEqual([{ ok: false }]);
    await asUser(db, luke, `update public.photo_items set deleted_at = now() where id = $1`, [id(1)]);
    expect(await asUser(db, luke, `select public.photo_purge($1) ok`, [id(1)])).toEqual([{ ok: false }]);
    await db.query(`update public.photo_items set deleted_at = now() - interval '31 days' where id = $1`, [id(1)]);
    expect(await asUser(db, wife, `select public.photo_blob_allowed($1, true) ok`, [id(1)])).toEqual([{ ok: false }]);
    expect(await asUser(db, luke, `select public.photo_blob_allowed($1, true) ok`, [id(1)])).toEqual([{ ok: true }]);
    expect(await asUser(db, wife, `select public.photo_purge($1) ok`, [id(1)])).toEqual([{ ok: false }]);
    expect(await asUser(db, luke, `select public.photo_purge($1) ok`, [id(1)])).toEqual([{ ok: true }]);
    expect((await db.query(`select count(*)::int n from public.photo_sources where photo_id = $1`, [id(1)])).rows[0].n).toBe(0);
  });

  it("a thumbnail is read or uploaded only for a photo the caller can see", async () => {
    expect(await asUser(db, wife, `select public.photo_blob_allowed($1) ok`, [id(2)])).toEqual([{ ok: true }]);
    expect(await asUser(db, stranger, `select public.photo_blob_allowed($1) ok`, [id(2)])).toEqual([{ ok: false }]);
    expect(await asUser(db, wife, `select public.photo_blob_allowed($1) ok`, [id(10)])).toEqual([{ ok: false }]); // Luke's Personal
    expect(await asUser(db, luke, `select public.photo_blob_allowed($1) ok`, [id(77)])).toEqual([{ ok: false }]);  // no row, no upload
    expect(isErr(await asUser(db, null, `select public.photo_blob_allowed($1) ok`, [id(2)]))).toBe(true);
  });

  it("thumbnail storage per scope, only for members", async () => {
    expect(Number((await asUser(db, luke, `select public.photo_usage($1) n`, [GROUP]))[0].n)).toBe(31000);
    expect(await asUser(db, stranger, `select public.photo_usage($1) n`, [GROUP])).toEqual([{ n: null }]);
  });

  it("the guard function isn't callable, and anon has no grants", async () => {
    expect(isErr(await asUser(db, luke, `select public.photo_rows_guard()`))).toBe(true);
    const [{ ok }] = (await db.query(`select has_table_privilege('anon', 'public.photo_items', 'select') ok`)).rows;
    expect(ok).toBe(false);
  });
});
