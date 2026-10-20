// Applies migrations/2026-10-20-views-spaces.sql to a PGlite database that
// recreates today's prod shape (live_groups / members / invites, the
// live_get_my_* helpers, tableplan_states with the 2026-08-20 policies), then
// checks access as Luke, his wife and a stranger.
//
//   npm i --no-save @electric-sql/pglite@0.2
//   node scripts/check-views-spaces-migration.mjs migrations/2026-10-20-views-spaces.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
const LUKE = "11111111-1111-1111-1111-111111111111";
const WIFE = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const GROUP = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : " — " + detail}`); };

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', nullif(current_setting('request.jwt.claim.email', true), '')) $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
insert into auth.users values ('${LUKE}', 'mrlukedevans@gmail.com'), ('${WIFE}', 'wife@example.com'), ('${STRANGER}', 'x@example.com');

create table public.live_groups (id uuid primary key default gen_random_uuid(), created_by uuid references auth.users not null, disabled_pages text[] not null default '{}', created_at timestamptz default now());
create table public.live_group_members (group_id uuid references public.live_groups not null, user_id uuid references auth.users not null, display_name text not null default '', role text not null default 'member', joined_at timestamptz default now(), personal_disabled_pages text[] default '{}', primary key (group_id, user_id));
create table public.live_group_invites (id uuid primary key default gen_random_uuid(), group_id uuid references public.live_groups not null, email text not null, invited_by uuid references auth.users not null, created_at timestamptz default now(), accepted_at timestamptz, expires_at timestamptz);
create function public.live_get_my_group_ids() returns setof uuid language sql stable security definer set search_path to 'public' as $$ select group_id from live_group_members where user_id = auth.uid() $$;
create function public.live_get_my_admin_group_ids() returns setof uuid language sql stable security definer set search_path to 'public' as $$ select group_id from live_group_members where user_id = auth.uid() and role = 'admin' $$;
create function public.live_is_group_creator(gid uuid) returns boolean language sql stable security definer set search_path to 'public' as $$ select exists(select 1 from live_groups where id = gid and created_by = auth.uid()) $$;
alter table public.live_groups enable row level security;
alter table public.live_group_members enable row level security;
alter table public.live_group_invites enable row level security;
create policy "members can read their group" on public.live_groups for select to authenticated using (id in (select live_get_my_group_ids()));
create policy "admin can update their group" on public.live_groups for update to authenticated using (id in (select live_get_my_admin_group_ids()));
create policy "authenticated users can create groups" on public.live_groups for insert to authenticated with check (created_by = auth.uid());
create policy "members can read their group members" on public.live_group_members for select to authenticated using (group_id in (select live_get_my_group_ids()));
create policy "members can update own row" on public.live_group_members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "group creator can add themselves as admin" on public.live_group_members for insert to authenticated with check (user_id = auth.uid() and live_is_group_creator(group_id));
grant all on public.live_groups, public.live_group_members, public.live_group_invites to anon, authenticated, service_role;

create table public.tableplan_states (id text primary key, state jsonb, updated_at timestamptz default now());
alter table public.tableplan_states enable row level security;
grant select, insert, update on public.tableplan_states to authenticated;
grant all on public.tableplan_states to service_role;
create policy "state select (owner/user/group)" on public.tableplan_states for select to authenticated using (
  (id = 'personal' and lower(coalesce((select auth.jwt()) ->> 'email', '')) = 'mrlukedevans@gmail.com')
  or (split_part(id, ':'::text, 1) = ('u-'::text || ((select auth.uid()))::text))
  or (split_part(id, ':'::text, 1) in (select (g.g)::text from public.live_get_my_group_ids() g(g))));
create policy "state insert (owner/user/group)" on public.tableplan_states for insert to authenticated with check (true);
create policy "state update (owner/user/group)" on public.tableplan_states for update to authenticated using (true);

insert into public.live_groups (id, created_by) values ('${GROUP}', '${LUKE}');
insert into public.live_group_members (group_id, user_id, role, display_name) values ('${GROUP}', '${LUKE}', 'admin', 'Luke'), ('${GROUP}', '${WIFE}', 'member', 'Wife');
insert into public.tableplan_states (id, state) values ('${GROUP}:plan', '{}'), ('${GROUP}:eat', '{}'), ('u-${LUKE}:recreate', '{}'), ('u-${WIFE}:recreate', '{}'), ('personal', '{}');
`);

// Run `sql` as a signed-in user (or anon when uid is null). Returns rows or an error string.
async function as(uid, sql) {
  const email = uid === LUKE ? "mrlukedevans@gmail.com" : uid === WIFE ? "wife@example.com" : "x@example.com";
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); select set_config('request.jwt.claim.email', '${uid ? email : ""}', false); set role ${uid ? "authenticated" : "anon"};`);
    const r = await db.query(sql);
    return r.rows;
  } catch (e) {
    return "ERR: " + e.message;
  } finally {
    await db.exec("reset role;");
  }
}

console.log("Before the migration (today's prod)");
const escalate = await as(WIFE, `update public.live_group_members set role = 'admin' where user_id = '${WIFE}' returning role`);
check(Array.isArray(escalate) && escalate[0]?.role === "admin", "the hole is real: a member can make herself admin", JSON.stringify(escalate));
await db.exec(`update public.live_group_members set role = 'member' where user_id = '${WIFE}'`);

console.log("Applying the migration (twice, to prove it re-runs)");
await db.exec(MIG);
await db.exec(MIG);
const spaces = await db.query(`select s.kind, s.name, m.role, m.user_id from public.live_spaces s join public.live_space_members m on m.space_id = s.id`);
check(spaces.rows.length === 1 && spaces.rows[0].user_id === LUKE && spaces.rows[0].role === "owner" && spaces.rows[0].kind === "business", "one business space, Luke as owner (not duplicated on re-run)", JSON.stringify(spaces.rows));
const SPACE = (await db.query(`select id from public.live_spaces limit 1`)).rows[0].id;

console.log("Role escalation");
const esc2 = await as(WIFE, `update public.live_group_members set role = 'admin' where user_id = '${WIFE}' returning role`);
check(typeof esc2 === "string" && /permission denied/.test(esc2), "a member can no longer change her role", JSON.stringify(esc2));
const pdp = await as(WIFE, `update public.live_group_members set personal_disabled_pages = '{news}' where user_id = '${WIFE}' returning personal_disabled_pages`);
check(Array.isArray(pdp) && pdp.length === 1, "she can still save her own page switches (what the app PATCHes)", JSON.stringify(pdp));
const dn = await as(WIFE, `update public.live_group_members set display_name = 'W' where user_id = '${WIFE}' returning display_name`);
check(Array.isArray(dn) && dn.length === 1, "…and her display name");
const lukeOther = await as(LUKE, `update public.live_group_members set personal_disabled_pages = '{}' where user_id = '${WIFE}' returning user_id`);
check(Array.isArray(lukeOther) && lukeOther.length === 0, "nobody updates someone else's member row (unchanged)");
const roleCheck = (await db.query(`select role from public.live_group_members where user_id = '${WIFE}'`)).rows[0].role;
check(roleCheck === "member", "her role is still member");
const anonRead = await as(null, `select * from public.live_group_members`);
check(typeof anonRead === "string" && /permission denied/.test(anonRead), "anon has no access to group tables", JSON.stringify(anonRead));

console.log("Spaces");
check((await as(LUKE, `select id from public.live_spaces`)).length === 1, "Luke sees his business");
check((await as(LUKE, `select user_id from public.live_space_members`)).length === 1, "Luke sees its members");
check((await as(WIFE, `select id from public.live_spaces`)).length === 0, "his wife sees no business");
check((await as(WIFE, `select * from public.live_space_members`)).length === 0, "…and no members");
const selfAdd = await as(WIFE, `insert into public.live_space_members (space_id, user_id, role) values ('${SPACE}', '${WIFE}', 'owner')`);
check(typeof selfAdd === "string" && /permission denied/.test(selfAdd), "she can't add herself to it", JSON.stringify(selfAdd));
const makeSpace = await as(STRANGER, `insert into public.live_spaces (name, created_by) values ('X', '${STRANGER}')`);
check(typeof makeSpace === "string" && /permission denied/.test(makeSpace), "nobody creates spaces from the app (service role only, for now)", JSON.stringify(makeSpace));
const lukePromote = await as(LUKE, `update public.live_space_members set role = 'employee' returning role`);
check(typeof lukePromote === "string" && /permission denied/.test(lukePromote), "membership changes only through the service role", JSON.stringify(lukePromote));
const badRole = await db.query(`insert into public.live_space_members (space_id, user_id, role) values ('${SPACE}', '${WIFE}', 'admin')`).then(() => "inserted", (e) => e.message);
check(/check constraint/.test(badRole), "roles are owner / manager / employee only", badRole);
const badKind = await db.query(`insert into public.live_spaces (kind, name, created_by) values ('household', 'H', '${LUKE}')`).then(() => "inserted", (e) => e.message);
check(/check constraint/.test(badKind), "spaces are business only (Household stays live_groups)", badKind);

console.log("State rows");
const lukeIns = await as(LUKE, `insert into public.tableplan_states (id, state) values ('${SPACE}:plan', '{"planEvents":[]}') returning id`);
check(Array.isArray(lukeIns) && lukeIns.length === 1, "Luke writes the business calendar row", JSON.stringify(lukeIns));
const lukeUpd = await as(LUKE, `update public.tableplan_states set state = '{"planEvents":[1]}' where id = '${SPACE}:plan' returning id`);
check(Array.isArray(lukeUpd) && lukeUpd.length === 1, "…and updates it");
const wifeReadBiz = await as(WIFE, `select id from public.tableplan_states where id = '${SPACE}:plan'`);
check(Array.isArray(wifeReadBiz) && wifeReadBiz.length === 0, "his wife can't read business rows");
const wifeWriteBiz = await as(WIFE, `insert into public.tableplan_states (id, state) values ('${SPACE}:eat', '{}')`);
check(typeof wifeWriteBiz === "string" && /row-level security/.test(wifeWriteBiz), "…or write them", JSON.stringify(wifeWriteBiz));
const wifeUpdBiz = await as(WIFE, `update public.tableplan_states set state = '{}' where id = '${SPACE}:plan' returning id`);
check(Array.isArray(wifeUpdBiz) && wifeUpdBiz.length === 0, "…or overwrite them");
const lukeRows = (await as(LUKE, `select id from public.tableplan_states order by id`)).map((r) => r.id);
check(JSON.stringify(lukeRows) === JSON.stringify([`${SPACE}:plan`, `${GROUP}:eat`, `${GROUP}:plan`, "personal", `u-${LUKE}:recreate`].sort()), "Luke: household, personal and business rows — not his wife's own", JSON.stringify(lukeRows));
const wifeRows = (await as(WIFE, `select id from public.tableplan_states order by id`)).map((r) => r.id);
check(JSON.stringify(wifeRows) === JSON.stringify([`${GROUP}:eat`, `${GROUP}:plan`, `u-${WIFE}:recreate`].sort()), "his wife: household rows and her own — unchanged", JSON.stringify(wifeRows));
const strangerRows = await as(STRANGER, `select id from public.tableplan_states`);
check(Array.isArray(strangerRows) && strangerRows.length === 0, "a stranger sees nothing");
const lukeInsWifeRow = await as(LUKE, `insert into public.tableplan_states (id, state) values ('u-${WIFE}:config', '{}')`);
check(typeof lukeInsWifeRow === "string", "Luke can't write his wife's personal rows (unchanged)");

console.log("Server lookups that use limit=1 on live_group_members");
const lookup = (await db.query(`select group_id from public.live_group_members where user_id = '${LUKE}' limit 1`)).rows;
check(lookup.length === 1 && lookup[0].group_id === GROUP, "still find only the household group for Luke");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
