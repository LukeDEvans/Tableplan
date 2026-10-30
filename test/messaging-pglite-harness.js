// Test harness: a real Postgres (PGlite) with the real messaging migration and row
// security, plus a PostgREST-shaped transport that runs every call as a given user.
// Lets the messaging client be tested end to end against the actual access rules
// rather than a mock. Shared by test/messaging-*.test.js.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATION = ["2026-10-30-messaging.sql", "2026-10-31-messaging-limits.sql"]
  .map((f) => readFileSync(fileURLToPath(new URL(`../migrations/${f}`, import.meta.url)), "utf8"))
  .join("\n");

export const USERS = {
  luke: "11111111-1111-1111-1111-111111111111",
  wife: "22222222-2222-2222-2222-222222222222",
  stranger: "33333333-3333-3333-3333-333333333333",
  coworker: "44444444-4444-4444-4444-444444444444",
};

export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    insert into auth.users values ('${USERS.luke}', 'l@x'), ('${USERS.wife}', 'w@x'), ('${USERS.stranger}', 's@x'), ('${USERS.coworker}', 'c@x');
    create table public.live_group_members (group_id uuid not null, user_id uuid not null, display_name text not null default '', role text not null default 'member', primary key (group_id, user_id));
    create table public.live_space_members (space_id uuid not null, user_id uuid not null, role text, display_name text, primary key (space_id, user_id));
    insert into public.live_group_members values ('7aa1feaf-4c11-4b20-a1b4-234082e90c97', '${USERS.luke}', 'Luke', 'admin'), ('7aa1feaf-4c11-4b20-a1b4-234082e90c97', '${USERS.wife}', 'Marijane', 'member');
    insert into public.live_space_members values ('55555555-5555-5555-5555-555555555555', '${USERS.luke}', 'owner', 'Luke'), ('55555555-5555-5555-5555-555555555555', '${USERS.coworker}', 'member', 'Sam');
    alter default privileges in schema public grant all on tables to anon, authenticated;
    alter default privileges in schema public grant all on functions to anon, authenticated;
  `);
  await db.exec(MIGRATION);
  return db;
}

// One request at a time: PGlite has a single connection and the role is per session.
let queue = Promise.resolve();
function serial(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

const OPS = { eq: "=", gt: ">", lt: "<", gte: ">=", lte: "<=" };

function parseQuery(query) {
  const out = { select: "*", where: [], params: [], order: null, limit: null };
  for (const part of query.split("&")) {
    const i = part.indexOf("=");
    const k = decodeURIComponent(part.slice(0, i));
    const v = decodeURIComponent(part.slice(i + 1));
    if (k === "select") out.select = v.split(",").map((c) => `"${c}"`).join(",");
    else if (k === "order") out.order = `"${v}"`;
    else if (k === "limit") out.limit = Number(v);
    else {
      const dot = v.indexOf(".");
      const op = v.slice(0, dot);
      const val = v.slice(dot + 1);
      if (op === "in") {
        const items = val.replace(/^\(|\)$/g, "").split(",");
        const ph = items.map((x) => { out.params.push(x); return `$${out.params.length}`; });
        out.where.push(`"${k}"::text in (${ph.join(",")})`);
      } else if (op === "is" && val === "null") {
        out.where.push(`"${k}" is null`);
      } else if (OPS[op]) {
        out.params.push(val);
        out.where.push(`"${k}" ${OPS[op]} $${out.params.length}`); // the column's type decides (bigint ids compare as numbers)
      } else throw new Error(`harness: unsupported filter ${part}`);
    }
  }
  return out;
}

// A transport (messaging/server.js) that acts as `userId`.
export function pgliteTransport(db, userId) {
  async function as(sql, params = []) {
    return serial(async () => {
      try {
        await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${userId}', false); set role authenticated;`);
        return (await db.query(sql, params)).rows;
      } catch (e) {
        const err = new Error(`messaging: 400 ${e.message}`);
        err.status = 400;
        throw err;
      } finally {
        await db.exec("reset role;");
      }
    });
  }
  const where = (q) => (q.where.length ? ` where ${q.where.join(" and ")}` : "");
  return {
    async rpc(name, args) {
      const keys = Object.keys(args);
      const params = keys.map((k) => (Array.isArray(args[k]) || (args[k] && typeof args[k] === "object") ? JSON.stringify(args[k]) : args[k]));
      const casts = { p_members: "::uuid[]", p_items: "::jsonb", p_conv: "::uuid", p_device: "::uuid", p_sender_device: "::uuid", p_user: "::uuid", p_sign_pub: "::text" };
      const argSql = keys.map((k, i) => {
        if (k === "p_members") return `${k} => (select array_agg(x::uuid) from jsonb_array_elements_text($${i + 1}::jsonb) x)`;
        return `${k} => $${i + 1}${casts[k] || ""}`;
      }).join(", ");
      const rows = await as(`select * from public.${name}(${argSql})`, params);
      if (name === "msg_contacts" || name === "msg_claim_prekey") return rows;
      return rows.length ? Object.values(rows[0])[0] : null;
    },
    async select(table, query) {
      const q = parseQuery(query);
      const rows = await as(`select ${q.select} from public.${table}${where(q)}${q.order ? ` order by ${q.order}` : ""}${q.limit ? ` limit ${q.limit}` : ""}`, q.params);
      return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v instanceof Date ? v.toISOString() : v])));
    },
    async insert(table, rows) {
      for (const row of rows) {
        const cols = Object.keys(row);
        await as(`insert into public.${table} (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => row[c]));
      }
      return null;
    },
    async update(table, query, patch) {
      const q = parseQuery(query);
      const cols = Object.keys(patch);
      const sets = cols.map((c, i) => `"${c}" = $${q.params.length + i + 1}`).join(", ");
      await as(`update public.${table} set ${sets}${where(q)}`, [...q.params, ...cols.map((c) => patch[c])]);
      return null;
    },
    async remove(table, query) {
      const q = parseQuery(query);
      await as(`delete from public.${table}${where(q)}`, q.params);
      return null;
    },
  };
}
