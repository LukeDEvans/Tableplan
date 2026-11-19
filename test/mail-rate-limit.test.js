// Gmail rate limits and the always-fresh folder cache (Mail page).
// Covers: gFetch's single safe retry, gBatchGet never answering a rate limit
// with a parallel fan-out, rate-limited batch rows retried once and otherwise
// shown (not dropped), and the list action's history-id check.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const shared = require("../netlify/functions/_gmail-shared.js");
const gmail = require("../netlify/functions/gmail.js");

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const BATCH = "https://gmail.googleapis.com/batch/gmail/v1";

const jsonRes = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
const rateLimited = () => jsonRes({ error: { code: 429, message: "Quota exceeded for quota metric 'Total Query Cost'", errors: [{ reason: "rateLimitExceeded" }] } }, 429);

// Build a multipart batch response. parts: [{ idx, status, body }]
function batchRes(parts) {
  const b = "batch_resp";
  const text = parts.map(({ idx, status = 200, body }) =>
    `--${b}\r\nContent-Type: application/http\r\nContent-ID: <response-item-${idx}>\r\n\r\n` +
    `HTTP/1.1 ${status} ${status === 200 ? "OK" : "Error"}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}\r\n`
  ).join("") + `--${b}--`;
  return new Response(text, { status: 200, headers: { "content-type": `multipart/mixed; boundary=${b}` } });
}

const thread = (id) => ({
  id,
  messages: [{ id: `m-${id}`, internalDate: "1700000000000", labelIds: ["INBOX"], payload: { headers: [
    { name: "From", value: "A <a@x.com>" }, { name: "Subject", value: `Subject ${id}` }, { name: "Date", value: "x" }
  ] } }]
});

let calls;
let realFetch;
beforeEach(() => {
  calls = [];
  realFetch = global.fetch;
  shared._setSleepForTests(async () => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  global.fetch = realFetch;
  shared._setSleepForTests((ms) => new Promise((r) => setTimeout(r, ms)));
  vi.restoreAllMocks();
});

function mockFetch(route) {
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || "GET", body: opts.body });
    return route(String(url), opts, calls.length);
  });
}

describe("gFetch — one safe retry on rate limits", () => {
  it("retries a 429 once and returns the second answer", async () => {
    mockFetch((_u, _o, n) => (n === 1 ? rateLimited() : jsonRes({ ok: 1 })));
    const r = await shared.gFetch("t", "/threads");
    expect(r.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("never retries more than once, even if still rate limited", async () => {
    mockFetch(() => rateLimited());
    const r = await shared.gFetch("t", "/threads");
    expect(r.status).toBe(429);
    expect(calls).toHaveLength(2);
  });

  it("retries a 403 only when Gmail says it's a rate limit", async () => {
    mockFetch(() => jsonRes({ error: { code: 403, message: "Insufficient Permission", errors: [{ reason: "insufficientPermissions" }] } }, 403));
    const r = await shared.gFetch("t", "/threads");
    expect(r.status).toBe(403);
    expect(calls).toHaveLength(1);
    // …and the caller can still read the body
    expect((await r.json()).error.code).toBe(403);
  });

  it("treats a 403 userRateLimitExceeded as a rate limit", async () => {
    mockFetch((_u, _o, n) => (n === 1
      ? jsonRes({ error: { code: 403, errors: [{ reason: "userRateLimitExceeded" }] } }, 403)
      : jsonRes({ ok: 1 })));
    expect((await shared.gFetch("t", "/x")).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("doesn't retry ordinary failures", async () => {
    mockFetch(() => jsonRes({ error: { code: 500 } }, 500));
    await shared.gFetch("t", "/x");
    expect(calls).toHaveLength(1);
  });
});

describe("gBatchGet — rate limits never fan out", () => {
  const paths = ["/threads/a", "/threads/b", "/threads/c"];

  it("a rate-limited batch is retried once, then left unloaded — no individual fallback", async () => {
    mockFetch(() => rateLimited());
    const out = await shared.gBatchGet("t", paths);
    expect(out).toEqual([null, null, null]);
    expect(calls.map((c) => c.url)).toEqual([BATCH, BATCH]);
  });

  it("rate-limited rows inside a 200 batch get one smaller retry and are merged back", async () => {
    let batches = 0;
    mockFetch((url, opts) => {
      if (url !== BATCH) throw new Error("unexpected individual call " + url);
      batches++;
      if (batches === 1) {
        return batchRes([
          { idx: 0, body: thread("a") },
          { idx: 1, status: 429, body: { error: { code: 429, errors: [{ reason: "rateLimitExceeded" }] } } },
          { idx: 2, body: thread("c") }
        ]);
      }
      // the retry carries only the limited row, renumbered as item-0
      expect(opts.body).toContain("/threads/b");
      expect(opts.body).not.toContain("/threads/a");
      return batchRes([{ idx: 0, body: thread("b") }]);
    });
    const out = await shared.gBatchGet("t", paths);
    expect(out.map((t) => t?.id)).toEqual(["a", "b", "c"]);
    expect(batches).toBe(2);
  });

  it("rows still limited after the retry stay null (no second retry)", async () => {
    mockFetch(() => batchRes(paths.map((_, idx) => ({ idx, status: 429, body: { error: { code: 429 } } }))));
    const out = await shared.gBatchGet("t", paths);
    expect(out).toEqual([null, null, null]);
    expect(calls).toHaveLength(2);
  });

  it("a non-rate-limit error row (404) is left null without a retry", async () => {
    mockFetch(() => batchRes([
      { idx: 0, body: thread("a") },
      { idx: 1, status: 404, body: { error: { code: 404 } } },
      { idx: 2, body: thread("c") }
    ]));
    const out = await shared.gBatchGet("t", paths);
    expect(out.map((t) => t?.id ?? null)).toEqual(["a", null, "c"]);
    expect(calls).toHaveLength(1);
  });

  it("a transport failure still falls back to individual calls", async () => {
    mockFetch((url) => {
      if (url === BATCH) throw new Error("network down");
      return jsonRes(thread(url.split("/").pop()));
    });
    const out = await shared.gBatchGet("t", paths);
    expect(out.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

describe("list action — always-fresh folder cache", () => {
  const SUPA = "https://noyocjcltrenwdovqrql.supabase.co";
  const event = (body) => ({ httpMethod: "POST", headers: { authorization: "Bearer user" }, body: JSON.stringify({ action: "list", labelIds: ["INBOX"], maxResults: 2, ...body }) });

  function route({ history, threads = ["a", "b"], batch } = {}) {
    return (url) => {
      if (url.startsWith(`${SUPA}/auth/v1/user`)) return jsonRes({ id: "u1" });
      if (url.startsWith(`${SUPA}/rest/v1/tableplan_states`)) return jsonRes([{ state: { refreshToken: "r", accessToken: "tok", expiresAt: Date.now() + 3600e3 } }]);
      if (url.startsWith(`${GMAIL}/history?`)) return history();
      if (url === `${GMAIL}/profile`) return jsonRes({ historyId: "500" });
      if (url.startsWith(`${GMAIL}/threads?`)) return jsonRes({ threads: threads.map((id) => ({ id, snippet: `snip ${id}` })) });
      if (url.startsWith(`${GMAIL}/labels/`)) return jsonRes({ threadsTotal: 2 });
      if (url.startsWith(`${GMAIL}/messages?`)) return jsonRes({ messages: [] });
      if (url === BATCH) return batch ? batch() : batchRes(threads.map((id, idx) => ({ idx, body: thread(id) })));
      return jsonRes({});
    };
  }
  const gmailCalls = () => calls.filter((c) => c.url.startsWith("https://gmail.googleapis.com")).map((c) => c.url.replace(GMAIL, "").split("?")[0]);

  it("a fresh load returns the mailbox history id, read before the list", async () => {
    mockFetch(route());
    const res = await gmail.handler(event({}));
    const data = JSON.parse(res.body);
    expect(data.historyId).toBe("500");
    expect(data.messages.map((m) => m.threadId)).toEqual(["a", "b"]);
    const g = gmailCalls();
    expect(g.indexOf("/profile")).toBeLessThan(g.indexOf("/threads"));
  });

  it("unchanged mailbox → answers from one history call, no list", async () => {
    mockFetch(route({ history: () => jsonRes({ historyId: "500" }) }));
    const res = await gmail.handler(event({ ifUnchangedSince: "500" }));
    expect(JSON.parse(res.body)).toEqual({ unchanged: true, historyId: "500" });
    expect(gmailCalls()).toEqual(["/history"]);
  });

  it("changed mailbox → full load, using history's current id (no extra profile call)", async () => {
    mockFetch(route({ history: () => jsonRes({ historyId: "510", history: [{ id: "505" }] }) }));
    const data = JSON.parse((await gmail.handler(event({ ifUnchangedSince: "500" }))).body);
    expect(data.unchanged).toBeUndefined();
    expect(data.historyId).toBe("510");
    expect(gmailCalls()).not.toContain("/profile");
  });

  it("expired history id (404) → full load with a fresh id", async () => {
    mockFetch(route({ history: () => jsonRes({ error: { code: 404 } }, 404) }));
    const data = JSON.parse((await gmail.handler(event({ ifUnchangedSince: "1" }))).body);
    expect(data.historyId).toBe("500");
    expect(data.messages).toHaveLength(2);
  });

  it("searches and later pages are never cacheable", async () => {
    mockFetch(route({ history: () => { throw new Error("should not check history"); } }));
    const data = JSON.parse((await gmail.handler(event({ q: "from:x", ifUnchangedSince: "500" }))).body);
    expect(data.historyId).toBeNull();
    expect(gmailCalls()).not.toContain("/history");
    expect(gmailCalls()).not.toContain("/profile");
  });

  it("rows that couldn't load are shown, not dropped, and the page isn't cacheable", async () => {
    let n = 0;
    mockFetch(route({ batch: () => (++n === 1
      ? batchRes([{ idx: 0, body: thread("a") }, { idx: 1, status: 429, body: { error: { code: 429 } } }])
      : batchRes([{ idx: 0, status: 429, body: { error: { code: 429 } } }])) }));
    const data = JSON.parse((await gmail.handler(event({}))).body);
    expect(data.messages).toHaveLength(2);
    expect(data.messages[1]).toMatchObject({ threadId: "b", loadFailed: true });
    expect(data.partial).toBe(true);
    expect(data.historyId).toBeNull();
  });
});
