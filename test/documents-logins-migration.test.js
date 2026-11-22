// Access rules of migrations/2026-11-22-safe-logins.sql (PASSWORDS_DESIGN.md §4), run
// against a real Postgres (PGlite) with row security: Luke, his wife (same household),
// a coworker, a stranger and anon.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger, coworker } = USERS;
const PERSONAL = `u-${luke}`;
const isErr = (r) => typeof r === "string";
const ENC = "A".repeat(200);
const id = (n) => `d0000000-0000-0000-0000-00000000000${n}`;

let db;

beforeAll(async () => {
  db = await createDocumentsDatabase();
  // The harness already ran the migration; running it again checks it can be re-run.
  await db.exec(readFileSync(new URL("../migrations/2026-11-22-safe-logins.sql", import.meta.url), "utf8"));
  expect(isErr(await asUser(db, luke, `insert into public.doc_vaults (scope) values ($1)`, [PERSONAL]))).toBe(false);
  expect(isErr(await asUser(db, wife, `insert into public.doc_vaults (scope) values ($1)`, [GROUP]))).toBe(false);
}, 60_000);

describe("safe_logins", () => {
  it("each person adds to their own Personal scope and the household's", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 1, $3)`, [id(1), PERSONAL, ENC]))).toBe(false);
    expect(isErr(await asUser(db, wife, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 1, $3)`, [id(2), GROUP, ENC]))).toBe(false);
  });

  it("nobody else can add, read or change them", async () => {
    expect(isErr(await asUser(db, wife, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 1, $3)`, [id(3), PERSONAL, ENC]))).toBe(true);
    expect(isErr(await asUser(db, stranger, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 1, $3)`, [id(4), GROUP, ENC]))).toBe(true);
    expect(await asUser(db, wife, `select id from public.safe_logins where scope = $1`, [PERSONAL])).toEqual([]);
    expect(await asUser(db, coworker, `select id from public.safe_logins`)).toEqual([]);
    expect(await asUser(db, stranger, `select id from public.safe_logins`)).toEqual([]);
    expect(isErr(await asUser(db, null, `select id from public.safe_logins`))).toBe(true);
    expect(await asUser(db, stranger, `update public.safe_logins set enc = $2 where id = $1 returning id`, [id(2), "B".repeat(200)])).toEqual([]);
  });

  it("household members both read the household's logins", async () => {
    expect((await asUser(db, luke, `select id from public.safe_logins order by id`)).map((r) => r.id)).toEqual([id(1), id(2)]);
    expect((await asUser(db, wife, `select id from public.safe_logins`)).map((r) => r.id)).toEqual([id(2)]);
  });

  it("id, scope and author are fixed; the server sets the author and times", async () => {
    expect(isErr(await asUser(db, luke, `update public.safe_logins set scope = $2 where id = $1`, [id(2), PERSONAL]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.safe_logins set id = $2 where id = $1`, [id(2), id(5)]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.safe_logins set created_by = $2 where id = $1`, [id(2), luke]))).toBe(true);
    const [row] = await asUser(db, luke, `select created_by from public.safe_logins where id = $1`, [id(2)]);
    expect(row.created_by).toBe(wife);
    const r = await asUser(db, luke, `update public.safe_logins set enc = $2, key_version = 2 where id = $1 returning id`, [id(2), "C".repeat(200)]);
    expect(r).toEqual([{ id: id(2) }]);
  });

  it("refuses bad ciphertext", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 1, 'short')`, [id(6), PERSONAL]))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 1, $3)`, [id(6), PERSONAL, "A+/=".repeat(50)]))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.safe_logins (id, scope, key_version, enc) values ($1, $2, 0, $3)`, [id(6), PERSONAL, ENC]))).toBe(true);
  });

  it("no hard delete; purge only 30 days after Recently deleted", async () => {
    expect(isErr(await asUser(db, wife, `delete from public.safe_logins where id = $1`, [id(2)]))).toBe(true);
    expect(await asUser(db, wife, `select public.safe_purge_login($1) ok`, [id(2)])).toEqual([{ ok: false }]);
    expect(isErr(await asUser(db, wife, `update public.safe_logins set deleted_at = now() where id = $1`, [id(2)]))).toBe(false);
    expect(await asUser(db, wife, `select public.safe_purge_login($1) ok`, [id(2)])).toEqual([{ ok: false }]);
    await db.exec(`update public.safe_logins set deleted_at = now() - interval '31 days' where id = '${id(2)}'`);
    expect(await asUser(db, stranger, `select public.safe_purge_login($1) ok`, [id(2)])).toEqual([{ ok: false }]);
    expect(await asUser(db, wife, `select public.safe_purge_login($1) ok`, [id(2)])).toEqual([{ ok: true }]);
    expect(await asUser(db, luke, `select id from public.safe_logins`)).toEqual([{ id: id(1) }]);
  });

  it("has the MFA policy and no grants to anon", async () => {
    const pol = await db.query(`select policyname, permissive from pg_policies where tablename = 'safe_logins' and policyname = 'require_mfa_when_enrolled'`);
    expect(pol.rows).toEqual([{ policyname: "require_mfa_when_enrolled", permissive: "RESTRICTIVE" }]);
    const anon = await db.query(`select has_table_privilege('anon', 'public.safe_logins', 'select') s`);
    expect(anon.rows[0].s).toBe(false);
  });
});
