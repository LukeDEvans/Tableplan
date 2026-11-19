// podcast-upcoming — once a day, list each saved show's announced-but-not-free
// episodes in podcast_upcoming (PODCAST_UPCOMING_DESIGN.md). Supabase Edge
// Function (Deno), called by pg_cron through pg_net
// (migrations/2026-11-19-podcast-upcoming.sql).
//
// Per feed: find its catalog id (cached in podcast_upcoming_sources), read the
// upcoming episodes from the source, and replace that feed's rows. A feed whose
// read fails keeps its old rows; they go stale after 3 days and the app then
// stops holding anything for that show (a broken lookup never hides episodes).
//
// Sources: only Apple today (./apple.js — the only file that knows Apple). To
// drop Apple, remove it from SOURCES; feeds then simply get no rows.
//
// Who may call it: only a caller holding the Vault key `podcast_upcoming_key`
// (checked by podcast_upcoming_key_ok). The gateway's JWT check is off because
// pg_net sends none. A second call within MIN_INTERVAL_MS is skipped.
//
// Provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional secret: PODCAST_UPCOMING_DISABLED=1 switches it off.
//
// Result: the server-only row `podcastupcoming_status` in tableplan_states (no
// ":" in the id, so no app reads it): times and counts only.

import * as apple from "./apple.js";

const SOURCES = { [apple.SOURCE]: apple };
const STATUS_ID = "podcastupcoming_status";
const MIN_INTERVAL_MS = 60 * 60 * 1000;
const RECHECK_UNLISTED_MS = 7 * 24 * 60 * 60 * 1000; // a feed the source doesn't list
const RECHECK_LISTED_MS = 30 * 24 * 60 * 60 * 1000;  // confirm a cached id still matches
const PAUSE_MS = 1500; // between feeds, to be gentle with the source

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Ctx = { url: string; key: string };
const headers = (c: Ctx, extra: Record<string, string> = {}) => ({
  apikey: c.key, authorization: `Bearer ${c.key}`, accept: "application/json",
  "content-type": "application/json", "x-live-writer": "2", ...extra,
});

async function rest(c: Ctx, path: string, init: RequestInit = {}) {
  const res = await fetch(`${c.url}/rest/v1/${path}`, { ...init, headers: { ...headers(c), ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${path.split("?")[0]} ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function keyOk(c: Ctx, key: string) {
  if (!key || key.length > 200) return false;
  try { return (await rest(c, "rpc/podcast_upcoming_key_ok", { method: "POST", body: JSON.stringify({ p_key: key }) })) === true; }
  catch { return false; }
}

async function readStatus(c: Ctx) {
  try { return (await rest(c, `tableplan_states?id=eq.${STATUS_ID}&select=state`))?.[0]?.state || null; } catch { return null; }
}
async function writeStatus(c: Ctx, state: Record<string, unknown>) {
  try {
    await rest(c, "tableplan_states?on_conflict=id", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ id: STATUS_ID, state, updated_at: new Date().toISOString() }),
    });
  } catch (e) { console.error("[podcast-upcoming] status save", String(e)); }
}

const eq = (v: string) => `eq.${encodeURIComponent(v)}`;

async function saveSource(c: Ctx, row: Record<string, unknown>) {
  await rest(c, "podcast_upcoming_sources?on_conflict=feed_url", {
    method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(row),
  });
}

async function replaceRows(c: Ctx, feedUrl: string, source: string, upcoming: Array<{ title: string; expectedAt: string | null }>) {
  const old = await rest(c, `podcast_upcoming?feed_url=${eq(feedUrl)}&select=title,first_seen_at`) || [];
  const firstSeen = new Map(old.map((r: { title: string; first_seen_at: string }) => [r.title, r.first_seen_at]));
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const rows = upcoming.filter((u) => u.title && !seen.has(u.title) && seen.add(u.title)).map((u) => ({
    feed_url: feedUrl, title: u.title.slice(0, 500), expected_at: u.expectedAt, source,
    fetched_at: now, first_seen_at: firstSeen.get(u.title) || now,
  }));
  await rest(c, `podcast_upcoming?feed_url=${eq(feedUrl)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
  if (rows.length) await rest(c, "podcast_upcoming", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
  return rows.length;
}

async function runOnce(c: Ctx) {
  const feeds: Array<{ feed_url: string; title: string }> = await rest(c, "rpc/podcast_upcoming_feeds", { method: "POST", body: "{}" }) || [];
  const cached: Array<Record<string, any>> = await rest(c, "podcast_upcoming_sources?select=*") || [];
  const byFeed = new Map(cached.map((r) => [r.feed_url, r]));
  const out = { feeds: feeds.length, listed: 0, unlisted: 0, failed: 0, upcoming: 0, candidates: 0 };
  const src = SOURCES[apple.SOURCE];

  for (const f of feeds) {
    const now = Date.now();
    let s = byFeed.get(f.feed_url);
    try {
      const age = s ? now - (Date.parse(s.checked_at) || 0) : Infinity;
      let ref: string | null = s?.source_ref ?? null;
      if (!s || (!ref && age > RECHECK_UNLISTED_MS)) {
        ref = await src.findAppleId(f.feed_url, f.title);
        s = { feed_url: f.feed_url, source: src.SOURCE, source_ref: ref, checked_at: new Date().toISOString(), last_ok_at: s?.last_ok_at ?? null, last_error: null };
        await saveSource(c, s);
      } else if (ref && age > RECHECK_LISTED_MS) {
        if (!(await src.appleIdStillMatches(ref, f.feed_url))) ref = await src.findAppleId(f.feed_url, f.title);
        s = { ...s, source_ref: ref, checked_at: new Date().toISOString() };
        await saveSource(c, s);
      }
      if (!ref) { out.unlisted++; await replaceRows(c, f.feed_url, src.SOURCE, []); continue; }
      out.listed++;
      const { upcoming, candidates } = await src.fetchUpcoming(ref);
      if (candidates.length) {
        out.candidates += candidates.length;
        // The real shape of an early-access episode (design §6) — kept in the logs.
        console.log("[podcast-upcoming] candidates", JSON.stringify({ ref, candidates }).slice(0, 8000));
      }
      out.upcoming += await replaceRows(c, f.feed_url, src.SOURCE, upcoming);
      await saveSource(c, { ...s, last_ok_at: new Date().toISOString(), last_error: null });
    } catch (e) {
      out.failed++;
      console.error("[podcast-upcoming] feed failed", String(e).slice(0, 300));
      try { await saveSource(c, { ...(s || { feed_url: f.feed_url, source: src.SOURCE, source_ref: null }), last_error: String(e).slice(0, 300) }); } catch { /* best effort */ }
    }
    await sleep(PAUSE_MS);
  }
  return out;
}

export async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (Deno.env.get("PODCAST_UPCOMING_DISABLED") === "1") return json(503, { error: "switched off" });
  const c: Ctx = {
    url: (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, ""),
    key: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  };
  if (!c.url || !c.key) return json(500, { error: "not configured" });
  if (!(await keyOk(c, req.headers.get("x-job-key") || ""))) return json(401, { error: "not allowed" });

  const last = await readStatus(c);
  if (Date.now() - (Date.parse(String(last?.startedAt || "")) || 0) < MIN_INTERVAL_MS) return json(200, { skipped: "ran recently" });

  const startedAt = new Date().toISOString();
  await writeStatus(c, { startedAt, finishedAt: null, ok: false, lastGood: last?.lastGood || null });
  const work = (async () => {
    try {
      const counts = await runOnce(c);
      const finishedAt = new Date().toISOString();
      await writeStatus(c, { startedAt, finishedAt, ok: counts.failed === 0, ...counts, lastGood: counts.failed < counts.feeds ? finishedAt : (last?.lastGood || null) });
    } catch (e) {
      console.error("[podcast-upcoming] run failed", String(e).slice(0, 300));
      await writeStatus(c, { startedAt, finishedAt: new Date().toISOString(), ok: false, error: String(e).slice(0, 300), lastGood: last?.lastGood || null });
    }
  })();
  // @ts-ignore EdgeRuntime is provided by Supabase
  if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(work); else await work;
  return json(202, { started: startedAt });
}

Deno.serve(handle);
