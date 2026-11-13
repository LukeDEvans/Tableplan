// Applies migrations/2026-11-12-fin-receipts.sql to PGlite (with stand-ins for
// auth, live_groups, live_group_members, tableplan_states and Document's
// doc_can_access) and checks who can read and write receipts.
//
//   npm i --no-save @electric-sql/pglite@0.2
//   node scripts/check-fin-receipts-migration.mjs migrations/2026-11-12-fin-receipts.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
const LUKE = "11111111-1111-1111-1111-111111111111";
const WIFE = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const G = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : " — " + detail}`); };

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
insert into auth.users values ('${LUKE}', 'l'), ('${WIFE}', 'w'), ('${STRANGER}', 's');
create table public.live_groups (id uuid primary key);
insert into public.live_groups values ('${G}');
create table public.live_group_members (group_id uuid, user_id uuid);
insert into public.live_group_members values ('${G}', '${LUKE}'), ('${G}', '${WIFE}');
create function public.doc_can_access(p_scope text) returns boolean language sql stable security definer set search_path = '' as $$
  select p_scope = 'u-' || (select auth.uid())::text
      or exists (select 1 from public.live_group_members m where m.group_id::text = p_scope and m.user_id = (select auth.uid())) $$;
grant execute on function public.doc_can_access(text) to authenticated;
create table public.tableplan_states (id text primary key, state jsonb);
insert into public.tableplan_states values
  ('${G}:grocery', '{"receipts":[{"id":"r1","storeName":"Costco","total":10},{"id":"r2","storeName":"Aldi","total":5},{"storeName":"no id"}]}'),
  ('not-a-group:grocery', '{"receipts":[{"id":"x1"}]}'),
  ('${G}:finance', '{"receipts":[{"id":"nope"}]}');
`);
async function as(uid, sql) {
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); set role ${uid ? "authenticated" : "anon"};`);
    return (await db.query(sql)).rows;
  } catch (e) { return "ERR: " + e.message; } finally { await db.exec("reset role;"); }
}
await db.exec(MIG);
await db.exec(MIG);
check(true, "applies twice");
const copied = (await db.query("select id, scope from public.fin_receipts order by id")).rows;
check(copied.length === 2 && copied.every((r) => r.scope === G), "copies the household's receipts once, keeping their ids", JSON.stringify(copied));

check((await as(LUKE, "select id from public.fin_receipts")).length === 2, "Luke reads the household's receipts");
check((await as(WIFE, "select id from public.fin_receipts")).length === 2, "his wife reads them too");
check((await as(STRANGER, "select id from public.fin_receipts")).length === 0, "a stranger reads none");
check(String(await as(null, "select id from public.fin_receipts")).startsWith("ERR"), "anon can't read");

const ins = await as(LUKE, `insert into public.fin_receipts (id, scope, data) values ('p1', 'u-${LUKE}', '{"id":"p1","view":"personal"}') returning created_by`);
check(Array.isArray(ins) && ins[0]?.created_by === LUKE, "Luke adds a Personal receipt (author set by the database)", String(ins));
check((await as(WIFE, "select id from public.fin_receipts where id = 'p1'")).length === 0, "his wife can't see his Personal receipt");
check(String(await as(WIFE, `insert into public.fin_receipts (id, scope, data) values ('p2', 'u-${LUKE}', '{}')`)).startsWith("ERR"), "she can't write into his Personal scope");
check(String(await as(STRANGER, `insert into public.fin_receipts (id, scope, data) values ('s1', '${G}', '{}')`)).startsWith("ERR"), "a stranger can't add to the household");

const moved = await as(LUKE, `update public.fin_receipts set scope = 'u-${LUKE}' where id = 'r2' returning scope`);
check(Array.isArray(moved) && moved[0]?.scope === `u-${LUKE}`, "Luke moves a household receipt to Personal");
check((await as(WIFE, "select id from public.fin_receipts where id = 'r2'")).length === 0, "…and then she can't see it");
const stolen = await as(WIFE, `update public.fin_receipts set scope = '${G}' where id = 'r2' returning id`);
check(Array.isArray(stolen) && stolen.length === 0, "she can't move it back");

check(String(await as(LUKE, "delete from public.fin_receipts where id = 'r1'")).startsWith("ERR"), "no hard deletes");
const del = await as(LUKE, "update public.fin_receipts set deleted_at = now() where id = 'r1' returning deleted_at");
check(Array.isArray(del) && del[0]?.deleted_at, "a removal is a deleted_at stamp");
check(String(await as(LUKE, "update public.fin_receipts set created_by = null where id = 'r1'")).startsWith("ERR"), "the author can't be changed");
const before = (await db.query("select updated_at from public.fin_receipts where id = 'r1'")).rows[0].updated_at;
await as(LUKE, `update public.fin_receipts set data = '{"id":"r1","total":11}' where id = 'r1'`);
const after = (await db.query("select updated_at from public.fin_receipts where id = 'r1'")).rows[0].updated_at;
check(after > before, "every change moves updated_at forward (changes-since reads see it)");
check(String(await as(LUKE, `insert into public.fin_receipts (id, scope, data) values ('big', '${G}', jsonb_build_object('x', repeat('a', 70000)))`)).startsWith("ERR"), "an oversized receipt is refused");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
