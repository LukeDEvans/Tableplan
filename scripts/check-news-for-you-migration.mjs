// Applies migrations/2026-10-28-news-for-you.sql to PGlite (after a stand-in for
// the live news_articles table) and checks its shape and who can reach it.
//
//   npm i --no-save @electric-sql/pglite@0.2
//   node scripts/check-news-for-you-migration.mjs migrations/2026-10-28-news-for-you.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
const LUKE = "11111111-1111-1111-1111-111111111111";
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
insert into auth.users values ('${LUKE}', 'luke@x');
create table public.news_articles (
  user_id uuid not null, id text not null, url text not null, title text not null,
  paper text not null, section text not null default 'more', published_at timestamptz not null,
  read_at timestamptz, hidden_at timestamptz, primary key (user_id, id));
alter table public.news_articles enable row level security;
grant select, insert, update, delete on public.news_articles to service_role;
insert into public.news_articles (user_id, id, url, title, paper, published_at)
  values ('${LUKE}', 'a1', 'https://x/1', 'Old story', 'nyt', now());
`);
async function as(role, uid, sql) {
  try {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid || ""}', false); set role ${role};`);
    return (await db.query(sql)).rows;
  } catch (e) { return "ERR: " + e.message; } finally { await db.exec("reset role;"); }
}
await db.exec(MIG);
await db.exec(MIG);
check(true, "applies twice");

const old = (await db.query("select topics, rank_score, skips from public.news_articles where id = 'a1'")).rows[0];
check(old && old.topics === null && old.rank_score === null && old.skips === 0, "existing stories keep working (topics/rank null, skips 0)", JSON.stringify(old));
await db.exec(`insert into public.news_articles (user_id, id, url, title, paper, published_at, topics, rank_score)
  values ('${LUKE}', 'a2', 'https://x/2', 'New story', 'athletic', now(), array['team:nfl:minnesota-vikings','t:nfl'], 4.5)`);
const ranked = (await db.query(`select id from public.news_articles where user_id = '${LUKE}' and hidden_at is null and read_at is null order by rank_score desc nulls last`)).rows.map((r) => r.id);
check(ranked.join() === "a2,a1", "For you order: ranked first, unranked last", ranked.join());
const idx = (await db.query("select indexname from pg_indexes where tablename = 'news_articles' and indexname = 'news_articles_user_rank_idx'")).rows;
check(idx.length === 1, "rank index exists");

await db.exec(`insert into public.news_interest (user_id) values ('${LUKE}')`);
const row = (await db.query(`select teams, teams_sig, weights, muted from public.news_interest`)).rows[0];
check(Array.isArray(row.teams) && row.teams_sig === "" && JSON.stringify(row.weights) === "{}" && JSON.stringify(row.muted) === "{}", "interest row defaults", JSON.stringify(row));

for (const [who, role, uid] of [["anon", "anon", null], ["a signed-in user", "authenticated", LUKE]]) {
  const r = await as(role, uid, "select * from public.news_interest");
  check(typeof r === "string" && /permission denied/.test(r), `${who} can't read news_interest`, JSON.stringify(r));
  const w = await as(role, uid, `update public.news_interest set weights = '{}'::jsonb`);
  check(typeof w === "string" && /permission denied/.test(w), `${who} can't write news_interest`, JSON.stringify(w));
}
const svc = await as("service_role", null, "select user_id from public.news_interest");
check(Array.isArray(svc) && svc.length === 1, "the service role reads it", JSON.stringify(svc));
const rls = (await db.query("select relrowsecurity from pg_class where relname = 'news_interest'")).rows[0];
check(rls?.relrowsecurity === true, "RLS on");
const pol = (await db.query("select count(*)::int n from pg_policies where tablename = 'news_interest'")).rows[0];
check(pol.n === 0, "no policies (service role only)");
check(!/\bdrop\b/i.test(MIG.replace(/--.*$/gm, "")), "no DROP statements (runs through execute_sql)");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
