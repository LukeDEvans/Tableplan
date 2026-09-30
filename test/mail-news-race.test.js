// The news pending row has two writers — the mail sweep (saveNewsBatch) and a
// swipe (removePendingNews). Both go through updateRawRow's optimistic lock, so a
// write that lands between the other's read and write is retried, not lost.
// A small fake of PostgREST's tableplan_states (GET / upsert POST / conditional
// PATCH on updated_at) stands in for Supabase.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const N = require("../netlify/functions/_news-links.js");

const USER = "u1";
const PENDING = `mailnews_${USER}`;
const SEEN = `mailnewsseen_${USER}`;
const iso = () => new Date().toISOString();
const card = (id) => ({ id, url: `https://www.nytimes.com/2026/09/29/us/${id}.html`, title: id, publishedAt: iso() });

let rows;
let stamp;
let beforeNextPatch; // runs once, just before the next PATCH lands (a concurrent writer)
const realFetch = globalThis.fetch;

function fakeFetch(url, opts = {}) {
  const u = new URL(url);
  const id = decodeURIComponent((u.searchParams.get("id") || "").replace(/^eq\./, ""));
  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  const method = opts.method || "GET";
  if (method === "GET") return json(rows.has(id) ? [rows.get(id)] : []);
  const body = JSON.parse(opts.body || "{}");
  if (method === "POST") {
    rows.set(body.id, { state: body.state, updated_at: `t${++stamp}` });
    return Promise.resolve(new Response(null, { status: 201 }));
  }
  if (method === "PATCH") {
    if (beforeNextPatch) { const f = beforeNextPatch; beforeNextPatch = null; f(); }
    const want = decodeURIComponent((u.searchParams.get("updated_at") || "").replace(/^eq\./, ""));
    const row = rows.get(id);
    if (!row || row.updated_at !== want) return json([]); // lost the race
    const next = { state: body.state, updated_at: `t${++stamp}` };
    rows.set(id, next);
    return json([next]);
  }
  throw new Error(`unexpected ${method}`);
}

// The "other writer": replaces the pending row directly, as its own write would.
const writeDirect = (state) => rows.set(PENDING, { state, updated_at: `t${++stamp}` });

beforeEach(() => {
  rows = new Map();
  stamp = 0;
  beforeNextPatch = null;
  globalThis.fetch = fakeFetch;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("news pending row — sweep vs swipe", () => {
  it("a swipe that lands mid-sweep isn't undone by the sweep's write", async () => {
    writeDirect({ newsPending: [card("old1"), card("old2")] });
    // While the sweep is between its read and write, the user swipes old1 away.
    beforeNextPatch = () => writeDirect({ newsPending: [card("old2")] });
    const r = await N.saveNewsBatch("key", USER, [{ cards: [card("new1")], seenIds: ["new1"] }]);
    const ids = rows.get(PENDING).state.newsPending.map((c) => c.id).sort();
    expect(ids).toEqual(["new1", "old2"]); // old1 stays gone, new1 arrived
    expect(r.added).toBe(1);
    expect(Object.keys(rows.get(SEEN).state.newsSeen)).toEqual(["new1"]);
  });

  it("cards collected mid-swipe aren't dropped by the swipe's write", async () => {
    writeDirect({ newsPending: [card("a"), card("b")] });
    // While the swipe is between its read and write, the sweep adds c.
    beforeNextPatch = () => writeDirect({ newsPending: [card("a"), card("b"), card("c")] });
    const after = await N.removePendingNews("key", USER, ["a"]);
    expect(after.map((c) => c.id).sort()).toEqual(["b", "c"]);
    expect(rows.get(PENDING).state.newsPending.map((c) => c.id).sort()).toEqual(["b", "c"]);
  });

  it("creates the pending row on the first batch and skips writing when a swipe removes nothing", async () => {
    await N.saveNewsBatch("key", USER, [{ cards: [card("x")], seenIds: ["x"] }]);
    expect(rows.get(PENDING).state.newsPending.map((c) => c.id)).toEqual(["x"]);
    const before = rows.get(PENDING).updated_at;
    const after = await N.removePendingNews("key", USER, ["not-there"]);
    expect(after.map((c) => c.id)).toEqual(["x"]);
    expect(rows.get(PENDING).updated_at).toBe(before); // no write
  });
});
