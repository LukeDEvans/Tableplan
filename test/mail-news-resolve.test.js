// gmail.js resolveNews (NEWS_INTAKE_DESIGN.md §3.3): a batch of swipe decisions
// saves accepted cards into the personal Media section (by the shared record id)
// and removes every decided card from the pending row in ONE write.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const gmail = require("../netlify/functions/gmail.js");

const USER = "u1";
const today = new Date().toISOString();
const card = (id) => ({ id, url: `https://www.nytimes.com/x/${id}.html`, title: `T ${id}`, paper: "nyt", source: "The New York Times", publishedAt: today });

function mock() {
  const st = { pending: [card("a"), card("b"), card("c")], media: null, pendingWrites: 0, calls: [] };
  const resp = (data, ok = true, status = 200) => ({ ok, status, json: async () => data, text: async () => JSON.stringify(data) });
  const fn = async (url, opts = {}) => {
    const u = String(url), method = opts.method || "GET";
    const body = opts.body ? JSON.parse(opts.body) : null;
    st.calls.push(`${method} ${u}`);
    if (u.includes("/auth/v1/user")) return resp({ id: USER });
    if (u.includes("mailnews_") && method === "GET") return resp([{ state: { newsPending: st.pending } }]);
    if (method === "POST" && body?.id === `mailnews_${USER}`) { st.pending = body.state.newsPending; st.pendingWrites++; return resp(null); }
    if (u.includes(`u-${USER}`) && method === "GET") return resp(st.media ? [st.media] : []);
    if (method === "POST" && body?.id === `u-${USER}:media`) { st.media = { id: body.id, state: body.state, updated_at: body.updated_at }; return resp(null); }
    return resp([]);
  };
  fn.st = st;
  return fn;
}
const call = (payload) => gmail.handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify(payload) });

beforeEach(() => { process.env.SUPABASE_SERVICE_ROLE_KEY = "svc"; });
afterEach(() => vi.restoreAllMocks());

describe("resolveNews", () => {
  it("accepts + dismisses in one batch: accepted → Media savedArticles, all removed in ONE pending write", async () => {
    const m = mock();
    vi.spyOn(global, "fetch").mockImplementation(m);
    const r = await call({ action: "resolveNews", decisions: [{ id: "a", decision: "accept" }, { id: "b", decision: "dismiss" }] });
    expect(r.statusCode).toBe(200);
    expect(m.st.pending.map((c) => c.id)).toEqual(["c"]);
    expect(m.st.pendingWrites).toBe(1);
    const saved = m.st.media.state.savedArticles;
    expect(saved.map((a) => a.id)).toEqual(["nl-a"]);
    expect(saved[0]).toMatchObject({ publication: "nyt", url: card("a").url, text: null });
  });

  it("rejects a malformed batch", async () => {
    vi.spyOn(global, "fetch").mockImplementation(mock());
    const r = await call({ action: "resolveNews", decisions: [{ id: "a", decision: "maybe" }] });
    expect(r.statusCode).toBe(400);
  });

  it("pendingNews returns the pending list", async () => {
    vi.spyOn(global, "fetch").mockImplementation(mock());
    const r = await call({ action: "pendingNews" });
    expect(JSON.parse(r.body).articles.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});
