// Applies migrations/2026-10-20-finance-account-views.sql to PGlite (with a
// minimal live_groups / auth stand-in) and checks who can read and write it.
//
//   npm i --no-save @electric-sql/pglite@0.2
//   node scripts/check-finance-account-views-migration.mjs migrations/2026-10-20-finance-account-views.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
const LUKE = "11111111-1111-1111-1111-111111111111";
const WIFE = "22222222-2222-2222-2222-222222222222";
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
insert into auth.users values ('${LUKE}', 'luke@x'), ('${WIFE}', 'wife@x');
create table public.live_groups (id uuid primary key, created_by uuid);
insert into public.live_groups values ('${G}', '${LUKE}');
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
await db.exec(`insert into public.live_finance_account_views (group_id, linked_id, owner_id) values ('${G}', 'ACT-2', '${LUKE}')`);
check((await as(LUKE, "select linked_id from public.live_finance_account_views")).length === 1, "Luke reads his own personal accounts");
check((await as(WIFE, "select linked_id from public.live_finance_account_views")).length === 0, "his wife reads none of them");
const anon = await as(null, "select * from public.live_finance_account_views");
check(typeof anon === "string" && /permission denied/.test(anon), "anon has no access", JSON.stringify(anon));
for (const [who, uid] of [["Luke", LUKE], ["his wife", WIFE]]) {
  const ins = await as(uid, `insert into public.live_finance_account_views (group_id, linked_id, owner_id) values ('${G}', 'ACT-9', '${uid}')`);
  check(typeof ins === "string" && /permission denied/.test(ins), `${who} can't mark an account from the app`, JSON.stringify(ins));
  const del = await as(uid, `delete from public.live_finance_account_views`);
  check(typeof del === "string" && /permission denied/.test(del), `${who} can't un-mark one`, JSON.stringify(del));
}
const bad = await db.query(`insert into public.live_finance_account_views (group_id, linked_id, owner_id, view) values ('${G}', 'ACT-3', '${LUKE}', 'household')`).then(() => "inserted", (e) => e.message);
check(/check constraint/.test(bad), "only 'personal' rows exist (no row = household)", bad);
console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
