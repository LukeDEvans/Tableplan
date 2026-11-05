// Access rules of migrations/2026-11-04-documents-everyday.sql (everyday documents),
// against PGlite with row security: Luke, his wife (same household), a coworker
// (business space only), a stranger and anon.

import { describe, it, expect, beforeAll } from "vitest";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger, coworker } = USERS;
const PERSONAL = `u-${luke}`;
const isErr = (r) => typeof r === "string";
const id = (n) => `f0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const addFile = (who, n, scope, extra = {}) => asUser(db, who,
  `insert into public.doc_pfiles (id, scope, folder_id, name, mime, size, body_text) values ($1, $2, $3, $4, $5, $6, $7) returning id, added_by`,
  [id(n), scope, extra.folder ?? null, extra.name ?? "Lease", "application/pdf", extra.size ?? 1000, extra.text ?? null]);

let db;
let receipts, home, lukeFolder;

beforeAll(async () => { db = await createDocumentsDatabase(); }, 60_000);

describe("everyday folders", () => {
  it("household members make folders in the household; each person in their own Personal", async () => {
    const r = await asUser(db, wife, `insert into public.doc_pfolders (id, scope, name, kind) values ($1, $2, 'Receipts', 'receipts') returning id, created_by`, [id(900), GROUP]);
    expect(r[0].created_by).toBe(wife);
    receipts = r[0].id;
    home = (await asUser(db, luke, `insert into public.doc_pfolders (id, scope, name) values ($1, $2, 'Home') returning id`, [id(901), GROUP]))[0].id;
    lukeFolder = (await asUser(db, luke, `insert into public.doc_pfolders (id, scope, name) values ($1, $2, 'Work') returning id`, [id(902), PERSONAL]))[0].id;
    expect(isErr(await asUser(db, wife, `insert into public.doc_pfolders (id, scope, name) values ($1, $2, 'x')`, [id(903), PERSONAL]))).toBe(true);
    expect(isErr(await asUser(db, stranger, `insert into public.doc_pfolders (id, scope, name) values ($1, $2, 'x')`, [id(904), GROUP]))).toBe(true);
    expect(isErr(await asUser(db, coworker, `insert into public.doc_pfolders (id, scope, name) values ($1, $2, 'x')`, [id(905), GROUP]))).toBe(true);
  });

  it("one Receipts folder per scope, and it can't be renamed into a plain folder, trashed or deleted", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.doc_pfolders (id, scope, name, kind) values ($1, $2, 'R2', 'receipts')`, [id(906), GROUP]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_pfolders set deleted_at = now() where id = $1`, [receipts]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_pfolders set kind = 'user' where id = $1`, [receipts]))).toBe(true); // no column grant
    expect(isErr(await asUser(db, luke, `delete from public.doc_pfolders where id = $1`, [receipts]))).toBe(true);
    expect(await asUser(db, luke, `select public.doc_ppurge_folder($1) ok`, [receipts])).toEqual([{ ok: false }]);
  });

  it("nobody outside the scope sees them", async () => {
    expect((await asUser(db, wife, `select name from public.doc_pfolders order by name`)).map((r) => r.name)).toEqual(["Home", "Receipts"]);
    expect(await asUser(db, stranger, `select id from public.doc_pfolders`)).toEqual([]);
    expect(await asUser(db, coworker, `select id from public.doc_pfolders`)).toEqual([]);
    expect(isErr(await asUser(db, null, `select id from public.doc_pfolders`))).toBe(true);
  });
});

describe("everyday files", () => {
  it("added in a scope I may use, author set by the database, folder in the same scope", async () => {
    const r = await addFile(wife, 1, GROUP, { folder: receipts, text: "TARGET total 42.10" });
    expect(r[0].added_by).toBe(wife);
    expect(isErr(await addFile(luke, 2, GROUP, { folder: lukeFolder }))).toBe(true); // Personal folder, household file
    expect(isErr(await addFile(wife, 3, PERSONAL))).toBe(true);
    expect(isErr(await addFile(stranger, 4, GROUP))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.doc_pfiles (id, scope, name, size, added_by) values ($1, $2, 'x', 1, $3) returning added_by`, [id(5), GROUP, wife]))).toBe(false);
    expect((await asUser(db, luke, `select added_by from public.doc_pfiles where id = $1`, [id(5)]))[0].added_by).toBe(luke);
  });

  it("can be renamed, moved, tagged and searched by members; scope and author never change", async () => {
    expect(isErr(await asUser(db, luke, `update public.doc_pfiles set name = 'Target', folder_id = $2, tags = '{shop}' where id = $1`, [id(1), home]))).toBe(false);
    expect(isErr(await asUser(db, luke, `update public.doc_pfiles set scope = $2 where id = $1`, [id(1), PERSONAL]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_pfiles set added_by = $2 where id = $1`, [id(1), luke]))).toBe(true);
    expect(await asUser(db, wife, `select name from public.doc_pfiles where body_text ilike '%target%'`)).toEqual([{ name: "Target" }]);
    expect(await asUser(db, stranger, `select name from public.doc_pfiles`)).toEqual([]);
    expect(await asUser(db, stranger, `update public.doc_pfiles set name = 'x' where id = $1 returning id`, [id(1)])).toEqual([]);
  });

  it("limits: kind, size, text length", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.doc_pfiles (id, scope, name, size, kind) values ($1, $2, 'x', 1, 'exe')`, [id(6), GROUP]))).toBe(true);
    expect(isErr(await addFile(luke, 7, GROUP, { size: 90000000 }))).toBe(true);
    expect(isErr(await addFile(luke, 8, GROUP, { text: "x".repeat(100001) }))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.doc_pfiles (id, scope, name, size, kind) values ($1, $2, 'Plan', 1, 'doc')`, [id(9), GROUP]))).toBe(false);
  });

  it("only Recently deleted for 30 days lets a file go (and its blobs)", async () => {
    expect(isErr(await asUser(db, luke, `delete from public.doc_pfiles where id = $1`, [id(1)]))).toBe(true);
    expect(await asUser(db, luke, `select public.doc_pblob_deletable($1, $2) ok`, [GROUP, id(1)])).toEqual([{ ok: false }]);
    await asUser(db, luke, `update public.doc_pfiles set deleted_at = now() where id = $1`, [id(1)]);
    expect(await asUser(db, luke, `select public.doc_ppurge_file($1) ok`, [id(1)])).toEqual([{ ok: false }]);
    await db.query(`update public.doc_pfiles set deleted_at = now() - interval '31 days' where id = $1`, [id(1)]);
    expect(await asUser(db, stranger, `select public.doc_pblob_deletable($1, $2) ok`, [GROUP, id(1)])).toEqual([{ ok: false }]);
    expect(await asUser(db, luke, `select public.doc_pblob_deletable($1, $2) ok`, [GROUP, id(1)])).toEqual([{ ok: true }]);
    expect(await asUser(db, stranger, `select public.doc_ppurge_file($1) ok`, [id(1)])).toEqual([{ ok: false }]);
    expect(await asUser(db, luke, `select public.doc_ppurge_file($1) ok`, [id(1)])).toEqual([{ ok: true }]);
    // an upload that never got a row may be cleaned up, but only in my scopes
    expect(await asUser(db, luke, `select public.doc_pblob_deletable($1, $2) ok`, [GROUP, id(77)])).toEqual([{ ok: true }]);
    expect(await asUser(db, stranger, `select public.doc_pblob_deletable($1, $2) ok`, [GROUP, id(77)])).toEqual([{ ok: false }]);
  });

  it("usage counts both kinds, only for members", async () => {
    const [{ n }] = await asUser(db, luke, `select public.doc_usage_all($1) n`, [GROUP]);
    expect(Number(n)).toBeGreaterThan(0);
    expect(await asUser(db, stranger, `select public.doc_usage_all($1) n`, [GROUP])).toEqual([{ n: null }]);
  });
});
