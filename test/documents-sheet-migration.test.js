// migrations/2026-11-09b-documents-sheet-versions.sql: spreadsheets keep version rows
// like documents (SPREADSHEET_DESIGN.md §13); plain files still don't.

import { describe, it, expect, beforeAll } from "vitest";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger } = USERS;
const isErr = (r) => typeof r === "string";
const id = (n) => `e1000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let db;
beforeAll(async () => {
  db = await createDocumentsDatabase();
  for (const [n, kind, mime] of [[1, "sheet", "application/vnd.live.sheet"], [2, "doc", "application/vnd.live.doc"], [3, "file", "application/pdf"], [4, "slides", "application/vnd.live.slides"]]) {
    await asUser(db, luke, `insert into public.doc_pfiles (id, scope, kind, name, mime, size) values ($1, $2, $3, 'x', $4, 10)`, [id(n), GROUP, kind, mime]);
  }
}, 60_000);

const putVersion = (who, file, slot = "h03") => asUser(db, who,
  `insert into public.doc_pversions (file_id, scope, slot, size) values ($1, $2, $3, 5) returning saved_by`, [file, GROUP, slot]);

describe("spreadsheet version rows", () => {
  it("household members write a spreadsheet's slots, as for documents", async () => {
    expect((await putVersion(wife, id(1)))[0].saved_by).toBe(wife);
    expect((await putVersion(luke, id(2)))[0].saved_by).toBe(luke);
  });
  it("still not for plain files or kinds not built yet, nor outsiders", async () => {
    expect(isErr(await putVersion(luke, id(3)))).toBe(true);
    expect(isErr(await putVersion(luke, id(4)))).toBe(true);
    expect(isErr(await putVersion(stranger, id(1), "h04"))).toBe(true);
  });
});
