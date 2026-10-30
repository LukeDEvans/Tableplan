// Applies the messaging migrations (2026-10-30, 2026-10-31) to a PGlite database shaped like prod
// (auth stubs, live_groups/members, live_spaces/members), then checks every access
// rule as Luke, his wife (same household), a stranger, and anon.
//
//   npm i --no-save @electric-sql/pglite@0.2
//   node scripts/check-messaging-migration.mjs migrations/2026-10-30-messaging.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Every messaging migration, in order (the second adds limits; §18).
const MIG_FILES = process.argv.length > 2 ? process.argv.slice(2) : ["migrations/2026-10-30-messaging.sql", "migrations/2026-10-31-messaging-limits.sql"];
const MIG = MIG_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
const db = new PGlite();
const LUKE = "11111111-1111-1111-1111-111111111111";
const WIFE = "22222222-2222-2222-2222-222222222222";
const STRANGER = "33333333-3333-3333-3333-333333333333";
const COWORKER = "44444444-4444-4444-4444-444444444444";
const GROUP = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
const SPACE = "55555555-5555-5555-5555-555555555555";
const DEV = { luke: "a0000000-0000-0000-0000-000000000001", luke2: "a0000000-0000-0000-0000-000000000002", wife: "b0000000-0000-0000-0000-000000000001", stranger: "c0000000-0000-0000-0000-000000000001", cow: "d0000000-0000-0000-0000-000000000001" };
const CONV = "e0000000-0000-0000-0000-000000000001";
const CONV2 = "e0000000-0000-0000-0000-000000000002";
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : " — " + detail}`); };
const isErr = (r) => typeof r === "string" && r.startsWith("ERR");
const k = (c) => c.repeat(43);
const sig = (c) => c.repeat(86);

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
insert into auth.users values ('${LUKE}', 'l@x'), ('${WIFE}', 'w@x'), ('${STRANGER}', 's@x'), ('${COWORKER}', 'c@x');
create table public.live_groups (id uuid primary key, created_by uuid not null);
create table public.live_group_members (group_id uuid not null, user_id uuid not null, display_name text not null default '', role text not null default 'member', primary key (group_id, user_id));
create table public.live_spaces (id uuid primary key, kind text, name text, created_by uuid);
create table public.live_space_members (space_id uuid not null, user_id uuid not null, role text, display_name text, primary key (space_id, user_id));
insert into public.live_groups values ('${GROUP}', '${LUKE}');
insert into public.live_group_members values ('${GROUP}', '${LUKE}', 'Luke', 'admin'), ('${GROUP}', '${WIFE}', 'Marijane', 'member');
insert into public.live_spaces values ('${SPACE}', 'business', 'Urban Greens', '${LUKE}');
insert into public.live_space_members values ('${SPACE}', '${LUKE}', 'owner', 'Luke'), ('${SPACE}', '${COWORKER}', 'member', 'Sam');
-- Supabase's default privileges: every new table and function is granted to anon and authenticated.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
`);
await db.exec(MIG);

async function as(uid, sql) {
  const role = uid === "service" ? "service_role" : uid ? "authenticated" : "anon";
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid && uid !== "service" ? uid : ""}', false); set role ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) {
    return "ERR: " + e.message;
  } finally {
    await db.exec("reset role;");
  }
}

const device = (id, user, kind, c) => `insert into public.msg_devices (device_id, user_id, kind, label, sign_pub, dh_pub, created_at_ms, identity_sig, device_sig, spk_id, spk_pub, spk_sig, spk_created_at_ms)
  values ('${id}', '${user}', '${kind}', 'test', '${k(c + "s")}'::text, '${k(c + "d")}'::text, 1, '${sig("A")}', '${sig("B")}', 1, '${k("P")}', '${sig("C")}', 1) returning device_id`;
// k() repeats a 1-char string; build distinct 43-char keys from two chars:
const key2 = (c) => (c.repeat(22) + c[0].repeat(21)).slice(0, 43);
const dev = (id, user, kind, c) => device(id, user, kind, c).replace(`'${k(c + "s")}'`, `'${key2(c + "s")}'`).replace(`'${k(c + "d")}'`, `'${key2(c + "d")}'`);

console.log("Contacts");
const lc = await as(LUKE, "select user_id::text, display_name from public.msg_contacts() order by 2");
check(Array.isArray(lc) && lc.map((r) => r.display_name).join(",") === "Luke,Marijane,Sam", "Luke can message himself, Marijane (household) and Sam (business space)", JSON.stringify(lc));
const wc = await as(WIFE, "select display_name from public.msg_contacts() order by 1");
check(Array.isArray(wc) && wc.map((r) => r.display_name).join(",") === "Luke,Marijane", "Marijane sees only the household", JSON.stringify(wc));
check((await as(STRANGER, "select * from public.msg_contacts()")).length === 0, "a stranger has no contacts");
check(isErr(await as(null, "select * from public.msg_contacts()")), "anon can't list contacts");

console.log("Identities");
check(!isErr(await as(LUKE, `insert into public.msg_identities (user_id, sign_pub) values ('${LUKE}', '${k("L")}')`)), "Luke registers his identity");
check(!isErr(await as(WIFE, `insert into public.msg_identities (user_id, sign_pub) values ('${WIFE}', '${k("W")}')`)), "Marijane registers hers");
check(!isErr(await as(STRANGER, `insert into public.msg_identities (user_id, sign_pub) values ('${STRANGER}', '${k("S")}')`)), "a stranger registers theirs");
check(isErr(await as(STRANGER, `insert into public.msg_identities (user_id, sign_pub) values ('${COWORKER}', '${k("X")}')`)), "nobody registers an identity for someone else");
check(isErr(await as(LUKE, `insert into public.msg_identities (user_id, sign_pub) values ('${LUKE}', 'not-a-key')`)), "malformed keys are refused");
check((await as(WIFE, "select user_id from public.msg_identities")).length === 2, "Marijane reads Luke's and her own identity");
check((await as(STRANGER, `select user_id from public.msg_identities where user_id = '${LUKE}'`)).length === 0, "a stranger can't read Luke's identity");
const upd = await as(LUKE, `update public.msg_identities set sign_pub = '${k("Z")}' where user_id = '${LUKE}' returning user_id`);
check(isErr(upd) || upd.length === 0, "an identity can't be swapped directly (only via reset)", JSON.stringify(upd));

console.log("Devices");
check(!isErr(await as(LUKE, dev(DEV.luke, LUKE, "phone", "l"))), "Luke registers his phone");
check(!isErr(await as(LUKE, dev(DEV.luke2, LUKE, "linked", "m"))), "Luke registers a linked browser");
check(!isErr(await as(WIFE, dev(DEV.wife, WIFE, "phone", "w"))), "Marijane registers her phone");
check(!isErr(await as(STRANGER, dev(DEV.stranger, STRANGER, "phone", "s"))), "a stranger registers a phone");
check(!isErr(await as(COWORKER, dev(DEV.cow, COWORKER, "phone", "c"))), "Sam registers a phone");
check(isErr(await as(WIFE, dev("b0000000-0000-0000-0000-000000000009", LUKE, "phone", "q"))), "nobody registers a device for someone else");
const dupKeys = dev("b0000000-0000-0000-0000-000000000008", WIFE, "linked", "l");
check(isErr(await as(WIFE, dupKeys)), "a device's keys can't be registered twice (unique sign/dh keys)");
check((await as(WIFE, "select device_id from public.msg_devices")).length === 3, "Marijane sees Luke's two devices and her own");
check((await as(STRANGER, `select device_id from public.msg_devices where user_id = '${LUKE}'`)).length === 0, "a stranger can't see Luke's devices");
check((await as(COWORKER, `select device_id from public.msg_devices where user_id = '${WIFE}'`)).length === 0, "Sam (business) can't see Marijane's devices");
check(!isErr(await as(LUKE, `update public.msg_devices set spk_id = 2, spk_pub = '${k("Q")}', label = 'iPhone' where device_id = '${DEV.luke}'`)), "Luke rotates his signed prekey and renames the device");
check(isErr(await as(LUKE, `update public.msg_devices set dh_pub = '${k("R")}' where device_id = '${DEV.luke}'`)), "a device's certified keys can't change");
const wifeEdit = await as(WIFE, `update public.msg_devices set label = 'mine' where device_id = '${DEV.luke}' returning device_id`);
check(Array.isArray(wifeEdit) && wifeEdit.length === 0, "Marijane can't edit Luke's devices");

console.log("Prekeys");
check(!isErr(await as(WIFE, `insert into public.msg_prekeys values ('${DEV.wife}', 1, '${k("1")}'), ('${DEV.wife}', 2, '${k("2")}')`)), "Marijane uploads one-time prekeys");
check(isErr(await as(LUKE, `insert into public.msg_prekeys values ('${DEV.wife}', 3, '${k("3")}')`)), "Luke can't upload prekeys for her device");
check((await as(LUKE, "select * from public.msg_prekeys")).length === 0, "Luke can't list her prekeys");
const c1 = await as(LUKE, `select * from public.msg_claim_prekey('${DEV.wife}')`);
check(Array.isArray(c1) && c1.length === 1 && c1[0].prekey_id === 1, "Luke claims her lowest prekey", JSON.stringify(c1));
const c2 = await as(LUKE, `select * from public.msg_claim_prekey('${DEV.wife}')`);
check(Array.isArray(c2) && c2[0]?.prekey_id === 2, "the next claim gets the next one (each used once)");
const c3 = await as(LUKE, `select * from public.msg_claim_prekey('${DEV.wife}')`);
check(Array.isArray(c3) && c3.length === 0, "none left → empty (X3DH runs without one)");
check(isErr(await as(STRANGER, `select * from public.msg_claim_prekey('${DEV.wife}')`)), "a stranger can't claim her prekeys");
check((await as(WIFE, "select count(*)::int n from public.msg_prekeys"))[0].n === 0, "claimed prekeys are gone");

console.log("Conversations");
check(!isErr(await as(LUKE, `select public.msg_create_conversation('${CONV}', array['${WIFE}']::uuid[])`)), "Luke starts a conversation with Marijane");
check(isErr(await as(LUKE, `select public.msg_create_conversation('${CONV}', array['${WIFE}']::uuid[])`)), "a conversation id can't be taken over");
check(isErr(await as(LUKE, `select public.msg_create_conversation('${CONV2}', array['${STRANGER}']::uuid[])`)), "nobody can add a stranger");
check((await as(WIFE, `select user_id from public.msg_conversation_members where conversation_id = '${CONV}'`)).length === 2, "Marijane sees the members");
check((await as(STRANGER, `select user_id from public.msg_conversation_members`)).length === 0, "a stranger sees nothing");
check(isErr(await as(STRANGER, `select public.msg_add_members('${CONV}', array['${STRANGER}']::uuid[])`)), "a stranger can't add themselves");
check(isErr(await as(WIFE, `select public.msg_add_members('${CONV}', array['${COWORKER}']::uuid[])`)), "Marijane can't add Sam (she doesn't share a group with him)");
check(!isErr(await as(LUKE, `select public.msg_add_members('${CONV}', array['${COWORKER}']::uuid[])`)), "Luke can add Sam (business space)");
check(!isErr(await as(WIFE, `select public.msg_remove_member('${CONV}', '${COWORKER}')`)), "any member can remove someone (decision 7)");

console.log("Sending and the inbox");
const items = (pairs) => `'${JSON.stringify(pairs.map(([d, ct]) => ({ device: d, ct })))}'::jsonb`;
const sent = await as(LUKE, `select public.msg_send('${CONV}', '${DEV.luke}', ${items([[DEV.wife, "AAAA"], [DEV.luke2, "BBBB"]])}) n`);
check(Array.isArray(sent) && sent[0].n === 2, "Luke sends to Marijane's phone and his own browser in one call", JSON.stringify(sent));
check(isErr(await as(LUKE, `select public.msg_send('${CONV}', '${DEV.luke}', ${items([[DEV.stranger, "X"]])})`)), "can't send to a device outside the conversation");
check(isErr(await as(LUKE, `select public.msg_send('${CONV}', '${DEV.wife}', ${items([[DEV.luke2, "X"]])})`)), "can't send as someone else's device");
check(isErr(await as(STRANGER, `select public.msg_send('${CONV}', '${DEV.stranger}', ${items([[DEV.wife, "X"]])})`)), "a non-member can't send into the conversation");
check(!isErr(await as(LUKE, `select public.msg_send(null, '${DEV.luke}', ${items([[DEV.luke2, "SYNC"]])})`)), "sync to my own device needs no conversation");
check(isErr(await as(LUKE, `select public.msg_send(null, '${DEV.luke}', ${items([[DEV.wife, "X"]])})`)), "…but reaching anyone else does");
check(isErr(await as(LUKE, `select public.msg_send('${CONV}', '${DEV.luke}', '[]'::jsonb)`)), "an empty send is refused");
check(isErr(await as(LUKE, `select public.msg_send('${CONV}', '${DEV.luke}', ${items(Array.from({ length: 129 }, () => [DEV.wife, "X"]))})`)), "more than 128 rows is refused");
check(isErr(await as(LUKE, `select public.msg_send('${CONV}', '${DEV.luke}', ${items([[DEV.wife, "x".repeat(32769)]])})`)), "a message over 32768 characters is refused");
check(isErr(await as(LUKE, `insert into public.msg_inbox (recipient_device_id, sender_device_id, sender_user_id, ciphertext) values ('${DEV.wife}', '${DEV.luke}', '${LUKE}', 'X')`)), "nobody inserts into the inbox directly");
const wifeRows = await as(WIFE, `select id, ciphertext, sender_user_id::text s from public.msg_inbox where recipient_device_id = '${DEV.wife}' order by id`);
check(Array.isArray(wifeRows) && wifeRows.length === 1 && wifeRows[0].ciphertext === "AAAA" && wifeRows[0].s === LUKE, "Marijane fetches her message, with the server-recorded sender");
check((await as(WIFE, `select id from public.msg_inbox where recipient_device_id = '${DEV.luke2}'`)).length === 0, "she can't read Luke's device's rows");
const lukeAck = await as(LUKE, `delete from public.msg_inbox where recipient_device_id = '${DEV.wife}' returning id`);
check(Array.isArray(lukeAck) && lukeAck.length === 0, "Luke can't delete her rows");
const ack = await as(WIFE, `delete from public.msg_inbox where id = ${wifeRows[0].id} returning id`);
check(Array.isArray(ack) && ack.length === 1, "she acknowledges (deletes) her row");

check(!isErr(await as(LUKE, `select public.msg_send('${CONV}', '${DEV.luke}', ${items([[DEV.wife, "x".repeat(32768)]])})`)), "…one of 32768 is fine");
check(isErr(await as(LUKE, "select public.msg_rate_take('send', 1, 999999)")), "users can't call the rate counter directly");
check(isErr(await as(LUKE, "select * from public.msg_rate")), "…or read it");
const seen = await as(WIFE, `select last_seen_at from public.msg_devices where device_id = '${DEV.luke}'`);
check(isErr(seen), "last_seen_at isn't readable (not even one's contacts')", JSON.stringify(seen));
check(!isErr(await as(WIFE, `select device_id, sign_pub, spk_pub, revoked_at from public.msg_devices where device_id = '${DEV.luke}'`)), "…the key columns still are");
console.log("Removing devices and resetting");
check(!isErr(await as(LUKE, `update public.msg_devices set revoked_at = now() where device_id = '${DEV.luke2}'`)), "Luke removes his browser");
check(isErr(await as(LUKE, `update public.msg_devices set revoked_at = null where device_id = '${DEV.luke2}'`)), "a removed device can't be brought back");
check(isErr(await as(WIFE, `select public.msg_send('${CONV}', '${DEV.wife}', ${items([[DEV.luke2, "X"]])})`)), "nobody can send to a removed device");
check(isErr(await as(LUKE, `select * from public.msg_claim_prekey('${DEV.luke2}')`)), "a removed device's prekeys can't be claimed");
await as(LUKE, `insert into public.msg_prekeys values ('${DEV.luke}', 5, '${k("5")}')`);
await as(WIFE, `select public.msg_send('${CONV}', '${DEV.wife}', ${items([[DEV.luke, "HI"]])})`);
check(!isErr(await as(LUKE, `select public.msg_reset_identity('${k("N")}')`)), "Luke resets messaging");
check((await as(WIFE, `select sign_pub from public.msg_identities where user_id = '${LUKE}'`))[0]?.sign_pub === k("N"), "…his new identity is what Marijane sees");
check((await as(WIFE, `select device_id from public.msg_devices where user_id = '${LUKE}' and revoked_at is null`)).length === 0, "…all his devices are removed");
check((await as("service", `select count(*)::int n from public.msg_inbox where recipient_device_id = '${DEV.luke}'`))[0].n === 0, "…his undelivered messages are gone");
check((await as("service", `select count(*)::int n from public.msg_prekeys where device_id = '${DEV.luke}'`))[0].n === 0, "…and his prekeys");

console.log("Anon and maintenance");
for (const t of ["msg_identities", "msg_devices", "msg_prekeys", "msg_conversation_members", "msg_inbox"]) {
  check(isErr(await as(null, `select * from public.${t}`)), `anon can't read ${t}`);
}
for (const t of ["msg_identities", "msg_devices", "msg_prekeys", "msg_conversation_members", "msg_inbox"]) {
  check(isErr(await as(STRANGER, `truncate public.${t}`)), `a signed-in user can't TRUNCATE ${t} (it would bypass row security)`);
}
check(isErr(await as(STRANGER, `delete from public.msg_identities where user_id = '${WIFE}'`)) || (await as("service", `select count(*)::int n from public.msg_identities where user_id = '${WIFE}'`))[0].n === 1, "nobody deletes identities");
check(isErr(await as(null, `select public.msg_send('${CONV}', '${DEV.wife}', '[]'::jsonb)`)), "anon can't send");
check(isErr(await as(LUKE, "select public.msg_prune()")), "users can't run the cleanup");
check(!isErr(await as("service", "select public.msg_prune()")), "the service role can");
console.log("Rate limits");
await as("service", `update public.msg_rate set n = 2999 where user_id = '${WIFE}' and kind = 'send'`);
const overSend = await as(WIFE, `select public.msg_send(null, '${DEV.wife}', ${items([[DEV.wife, "A"], [DEV.wife, "B"]])})`);
check(isErr(overSend) && /rate limited/.test(overSend), "over 3000 rows an hour is refused", JSON.stringify(overSend));
await as("service", `update public.msg_rate set window_start = now() - interval '61 minutes' where user_id = '${WIFE}'`);
check(!isErr(await as(WIFE, `select public.msg_send(null, '${DEV.wife}', ${items([[DEV.wife, "A"]])})`)), "…and allowed again after the hour");
await as("service", `insert into public.msg_rate values ('${LUKE}', 'claim', now(), 200) on conflict (user_id, kind) do update set n = 200, window_start = now()`);
const overClaim = await as(LUKE, `select * from public.msg_claim_prekey('${DEV.wife}')`);
check(isErr(overClaim) && /rate limited/.test(overClaim), "over 200 prekey claims an hour is refused", JSON.stringify(overClaim));
await as("service", `insert into public.msg_inbox (recipient_device_id, sender_device_id, sender_user_id, conversation_id, ciphertext)
  select '${DEV.wife}', '${DEV.luke}', '${LUKE}', '${CONV}', 'Q' from generate_series(1, 2000)`);
await as("service", `delete from public.msg_rate`);
const full = await as(WIFE, `select public.msg_send(null, '${DEV.wife}', ${items([[DEV.wife, "Z"]])})`);
check(isErr(full) && /inbox full/.test(full), "a device with 2000 waiting rows takes no more", JSON.stringify(full));
const again = await db.exec(MIG).then(() => "ok", (e) => "ERR " + e.message);
check(again === "ok", "the migration can be re-run safely", again);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
