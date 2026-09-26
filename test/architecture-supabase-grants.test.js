import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// ARCHITECTURE FITNESS — SUPABASE DATA API GRANTS.
//
// From 2026-10-30 Supabase no longer auto-grants Data API (PostgREST) access to
// new tables in `public`. Any SQL here that CREATEs a table without an explicit
// GRANT leaves that table "permission denied" on a fresh project, preview branch
// or `db reset` — even though prod (whose tables predate the change) keeps working,
// so the gap would stay invisible until someone rebuilds the DB. This guard fails
// if a checked-in .sql file creates a table without granting it to at least
// `service_role` (plus `authenticated`/`anon` as the table's RLS policies need).

const root = fileURLToPath(new URL("..", import.meta.url));
const sqlFiles = [
  ...readdirSync(root).filter((f) => f.endsWith(".sql")),
  ...readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".sql")).map((f) => `migrations/${f}`),
];

const stripComments = (sql) => sql.replace(/--[^\n]*/g, "");
const bare = (name) => name.replace(/^public\./i, "").replace(/"/g, "").toLowerCase();

describe("Supabase SQL: every created table has explicit Data API grants", () => {
  for (const file of sqlFiles) {
    const sql = stripComments(readFileSync(join(root, file), "utf8"));
    const created = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)].map((m) => bare(m[1]));
    if (!created.length) continue;
    const grants = [...sql.matchAll(/grant\s+[\w\s,]+?\s+on\s+(?:table\s+)?([\w."]+)\s+to\s+([\w\s,]+?);/gi)]
      .map((m) => ({ table: bare(m[1]), roles: m[2].toLowerCase() }));
    it(`${file}`, () => {
      const missing = created.filter((t) => !grants.some((g) => g.table === t && g.roles.includes("service_role")));
      expect(missing, `tables created without a "grant … to service_role" (add grants in the same file)`).toEqual([]);
    });
  }
});
