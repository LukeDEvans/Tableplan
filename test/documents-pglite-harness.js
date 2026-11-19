// Test harness for Documents: a real Postgres (PGlite) with the messaging
// migrations (devices live there) and the Documents migration, row security on.
// Reuses the messaging harness's database shape and PostgREST-shaped transport.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTestDatabase as createMessagingDatabase, pgliteTransport, USERS } from "./messaging-pglite-harness.js";

export { pgliteTransport, USERS };

export const DOC_MIGRATIONS = ["2026-11-03-documents.sql", "2026-11-03b-documents-v2.sql", "2026-11-04-documents-everyday.sql", "2026-11-09-documents-editor.sql", "2026-11-09b-documents-sheet-versions.sql"];
// Supabase provides realtime.messages / realtime.topic(); the word processor's
// migration adds policies to it, so stand them in here.
const REALTIME_STUB = `
  create schema if not exists realtime;
  create table if not exists realtime.messages (id bigserial primary key, topic text not null, extension text not null default 'broadcast', payload jsonb);
  create or replace function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '') $$;
  grant usage on schema realtime to authenticated, anon;
  grant select, insert on realtime.messages to authenticated;
  grant usage on all sequences in schema realtime to authenticated;
  alter table realtime.messages enable row level security;
  grant execute on function realtime.topic() to authenticated, anon;`;
const SQL = DOC_MIGRATIONS
  .map((f) => readFileSync(fileURLToPath(new URL(`../migrations/${f}`, import.meta.url)), "utf8"))
  .join("\n");

export const GROUP = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";

export async function createDocumentsDatabase() {
  const db = await createMessagingDatabase();
  await db.exec(REALTIME_STUB);
  await db.exec(SQL);
  return db;
}

// Runs one statement as a signed-in user (or anon with user = null). Returns rows,
// or the string "ERR: …" when Postgres refuses.
export async function asUser(db, user, sql, params = []) {
  try {
    await db.exec(user
      ? `reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`
      : `reset role; select set_config('request.jwt.claim.sub', '', false); set role anon;`);
    return (await db.query(sql, params)).rows;
  } catch (e) {
    return `ERR: ${e.message}`;
  } finally {
    await db.exec("reset role;");
  }
}
