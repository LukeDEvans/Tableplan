// Access rules of migrations/2026-11-09-documents-editor.sql (the word processor's
// version rows and live-editing channels), against PGlite with row security.
// realtime.messages / realtime.topic() are stood in for here (Supabase provides them).

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger, coworker } = USERS;
const PERSONAL = `u-${luke}`;
const isErr = (r) => typeof r === "string";
const id = (n) => `e0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const SQL = readFileSync(fileURLToPath(new URL("../migrations/2026-11-09-documents-editor.sql", import.meta.url)), "utf8");

let db;
beforeAll(async () => {
  db = await createDocumentsDatabase();
  await db.exec(SQL); // re-runnable: the harness already applied it once
  await asUser(db, luke, `insert into public.doc_pfiles (id, scope, kind, name, mime, size) values ($1, $2, 'doc', 'Letter', 'application/vnd.live.doc', 10)`, [id(1), GROUP]);
  await asUser(db, luke, `insert into public.doc_pfiles (id, scope, kind, name, mime, size) values ($1, $2, 'doc', 'Diary', 'application/vnd.live.doc', 10)`, [id(2), PERSONAL]);
  await asUser(db, luke, `insert into public.doc_pfiles (id, scope, kind, name, mime, size) values ($1, $2, 'file', 'Scan', 'application/pdf', 10)`, [id(3), GROUP]);
}, 60_000);

const putVersion = (who, file, scope, slot, name = null) => asUser(db, who,
  `insert into public.doc_pversions (file_id, scope, slot, name, size) values ($1, $2, $3, $4, 5)
   on conflict (file_id, slot) do update set size = excluded.size, name = excluded.name returning saved_by, slot`, [file, scope, slot, name]);

describe("version rows", () => {
  it("household members write a household document's slots; the author is set by the database", async () => {
    const r = await putVersion(wife, id(1), GROUP, "h07");
    expect(r[0].saved_by).toBe(wife);
    const again = await putVersion(luke, id(1), GROUP, "h07");
    expect(again[0].saved_by).toBe(luke); // overwritten in place: one row per slot
    expect((await asUser(db, wife, `select count(*)::int n from public.doc_pversions where file_id = $1`, [id(1)]))[0].n).toBe(1);
  });

  it("only real slot names", async () => {
    for (const bad of ["h24", "d00", "d32", "w53", "nXYZ", "content", "../x"]) {
      expect(isErr(await putVersion(luke, id(1), GROUP, bad))).toBe(true);
    }
    for (const ok of ["h00", "h23", "d01", "d31", "w00", "w52", `n${"a".repeat(32)}`]) {
      expect(isErr(await putVersion(luke, id(1), GROUP, ok))).toBe(false);
    }
  });

  it("nobody outside the scope reads or writes; scope must be the file's; only documents", async () => {
    expect(isErr(await putVersion(wife, id(2), PERSONAL, "h01"))).toBe(true);
    expect(isErr(await putVersion(stranger, id(1), GROUP, "h01"))).toBe(true);
    expect(isErr(await putVersion(coworker, id(1), GROUP, "h01"))).toBe(true);
    expect(isErr(await putVersion(luke, id(1), PERSONAL, "h02"))).toBe(true); // file is Household's
    expect(isErr(await putVersion(luke, id(3), GROUP, "h01"))).toBe(true); // a scan, not a document
    expect(await asUser(db, stranger, `select slot from public.doc_pversions`)).toEqual([]);
    expect(isErr(await asUser(db, null, `select slot from public.doc_pversions`))).toBe(true);
    expect(isErr(await asUser(db, wife, `delete from public.doc_pversions where file_id = $1`, [id(1)]))).toBe(true);
    expect(isErr(await asUser(db, wife, `update public.doc_pversions set scope = $2 where file_id = $1`, [id(1), PERSONAL]))).toBe(true);
  });

  it("rows go when the file is purged", async () => {
    await db.exec(`update public.doc_pfiles set deleted_at = now() - interval '31 days' where id = '${id(1)}'`);
    expect(await asUser(db, luke, `select public.doc_ppurge_file($1) ok`, [id(1)])).toEqual([{ ok: true }]);
    expect((await db.query(`select count(*)::int n from public.doc_pversions where file_id = $1`, [id(1)])).rows[0].n).toBe(0);
  });
});

describe("live-editing channels", () => {
  it("members of the scope may use its document channels; others may not", async () => {
    // realtime.topic() reads a per-session setting; set it in the same statement batch.
    const as = async (who, topic) => {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who}', false); select set_config('realtime.topic', '${topic}', false); set role authenticated;`);
      try { await db.query(`insert into realtime.messages (topic, payload) values ($1, '{}')`, [topic]); return true; } catch { return false; } finally { await db.exec("reset role;"); }
    };
    const household = `livedoc:${GROUP}:${id(9)}`;
    expect(await as(luke, household)).toBe(true);
    expect(await as(wife, household)).toBe(true);
    expect(await as(stranger, household)).toBe(false);
    expect(await as(coworker, household)).toBe(false);
    expect(await as(wife, `livedoc:${PERSONAL}:${id(9)}`)).toBe(false);
    expect(await as(luke, `livedoc:${PERSONAL}:${id(9)}`)).toBe(true);
    expect(await as(luke, `other:${GROUP}:${id(9)}`)).toBe(false);
  });
});
