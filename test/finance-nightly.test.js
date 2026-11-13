// The nightly bank job (FINANCE_AUDIT.md A1): netlify/functions/_finance-nightly.js
// and the Supabase Edge Function that runs it (supabase/functions/finance-nightly),
// against a small stand-in for Supabase and the bank bridge.
import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { snapshotFinanceBalances } from "../netlify/functions/_finance-nightly.js";
import { bundleFinanceNightly } from "../scripts/build-finance-nightly.mjs";

const G = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
const KEY = "k".repeat(64);
const realFetch = globalThis.fetch;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let db, txnWrites, bridgeCalls, bridge, env;
function install() {
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const method = init.method || "GET";
    if (u.startsWith("https://bridge.example/")) {
      bridgeCalls.push({ url: u, authorization: init.headers?.authorization });
      return bridge(init);
    }
    if (u.includes("/rest/v1/rpc/finance_nightly_key_ok")) return json(JSON.parse(init.body).p_key === KEY);
    if (u.includes("/rest/v1/live_finance_account_views")) return json([]);
    if (u.includes("/rest/v1/finance_transactions")) {
      if (method === "GET") return json(u.includes("posted=lt.") ? [{ id: "old" }] : []);
      if (method === "POST") { txnWrites.push(...JSON.parse(init.body)); return json([], 201); }
      return json([], 204);
    }
    if (u.includes("/rest/v1/tableplan_states")) {
      if (method === "POST") { const row = JSON.parse(init.body); db[row.id] = row.state; return new Response(null, { status: 201 }); }
      if (u.includes("id=like.simplefin")) return json(Object.keys(db).filter((k) => k.startsWith("simplefin_")).map((id) => ({ id, state: db[id] })));
      const id = decodeURIComponent(/id=eq\.([^&]+)/.exec(u)?.[1] || "");
      return json(db[id] ? [{ state: db[id] }] : []);
    }
    throw new Error(`unexpected fetch ${method} ${u}`);
  };
}
const accounts = () => ({
  errors: ["Connection to Some Bank may need attention. Auth required"],
  accounts: [{ id: "A1", org: { name: "Bank" }, name: "Checking", balance: "100.50", "balance-date": Math.floor(Date.now() / 1000),
    transactions: [{ id: "t1", posted: Math.floor(Date.now() / 1000) - 86400, amount: "-12.34", description: "COFFEE" }] }],
});

let handle;
beforeAll(async () => {
  globalThis.Deno = { env: { get: (k) => env[k] } };
  const out = await build({ entryPoints: [fileURLToPath(new URL("../supabase/functions/finance-nightly/index.ts", import.meta.url))], bundle: true, format: "esm", write: false, platform: "neutral", logLevel: "silent" });
  ({ handle } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`));
});
afterAll(() => { globalThis.fetch = realFetch; delete globalThis.Deno; });
beforeEach(() => {
  env = { SUPABASE_URL: "https://noyocjcltrenwdovqrql.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc" };
  db = {
    [`simplefin_${G}`]: { accessUrl: "https://us%C3%A9r:p%40ss@bridge.example/simplefin" },
    [`${G}:finance`]: { financeAccounts: [{ id: "h1", linkedId: "A1" }, { id: "loan", manualBalance: -40 }], financeBudgetGroups: [{ categories: [{ id: "c" }] }], financeTxnLabels: { t1: "cat:x:c" } },
  };
  txnWrites = []; bridgeCalls = [];
  bridge = () => json(accounts());
  install();
});
const call = (key = KEY, method = "POST") => handle(new Request("https://noyocjcltrenwdovqrql.supabase.co/functions/v1/finance-nightly", { method, headers: key ? { "x-nightly-key": key } : {}, body: method === "POST" ? "{}" : undefined }));

describe("the bundle", () => {
  it("is up to date with netlify/functions/_finance-nightly.js", async () => {
    const committed = readFileSync(new URL("../supabase/functions/finance-nightly/nightly.bundle.js", import.meta.url), "utf8");
    expect(committed).toBe(await bundleFinanceNightly());
  });
  it("needs nothing Deno lacks", () => {
    const committed = readFileSync(new URL("../supabase/functions/finance-nightly/nightly.bundle.js", import.meta.url), "utf8");
    expect(committed).not.toMatch(/\bBuffer\b|\bprocess\.|\brequire\(/);
  });
});

describe("the nightly job", () => {
  it("one pull writes the bank cache, the store, the history and the backup", async () => {
    const runs = await snapshotFinanceBalances("svc");
    expect(bridgeCalls).toHaveLength(1);
    expect(bridgeCalls[0].url).toMatch(/^https:\/\/bridge\.example\/simplefin\/accounts\?start-date=\d+$/);
    expect(Buffer.from(bridgeCalls[0].authorization.replace("Basic ", ""), "base64").toString("utf8")).toBe("usér:p@ss");
    expect(db[`finaccts_${G}`].accounts.map((a) => a.id)).toEqual(["A1"]);
    expect(db[`finaccts_${G}`].errors).toHaveLength(1);
    expect(txnWrites.map((r) => r.id)).toEqual(["t1"]);
    const day = Object.values(db[`finhist_${G}`].days)[0];
    expect(day).toEqual({ netWorth: 60.5, balances: { h1: 100.5, loan: -40 } });
    expect(Object.keys(db[`finbackup_${G}`].snapshots)).toHaveLength(1);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: true, stoppedAt: "", bridgeStatus: 200, accounts: 1, bridgeErrors: 1, cache: true, snapshot: true });
    expect(JSON.stringify(runs)).not.toContain(G); // no ids in the summary
  });

  it("a bank call that never answers is given up on, and nothing is written", async () => {
    bridge = (init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("timed out"), { name: "TimeoutError" }))));
    const runs = await snapshotFinanceBalances("svc", { bridgeTimeoutMs: 20 });
    expect(runs[0]).toMatchObject({ ok: false, stoppedAt: "bridge", error: "TimeoutError", cache: false, snapshot: false });
    expect(db[`finaccts_${G}`]).toBeUndefined();
    expect(db[`finhist_${G}`]).toBeUndefined();
  });

  it("a refused bank call writes nothing", async () => {
    bridge = () => json({}, 403);
    const runs = await snapshotFinanceBalances("svc");
    expect(runs[0]).toMatchObject({ ok: false, stoppedAt: "bridge", bridgeStatus: 403 });
    expect(db[`finhist_${G}`]).toBeUndefined();
    expect(db[`finbackup_${G}`]).toBeUndefined();
  });

  it("an answer with no account list still backs up, but adds no history point", async () => {
    bridge = () => json({ errors: ["down"] });
    const runs = await snapshotFinanceBalances("svc");
    expect(db[`finbackup_${G}`]).toBeTruthy();
    expect(db[`finhist_${G}`]).toBeUndefined(); // manual balances alone would be a false drop
    expect(db[`finaccts_${G}`]).toBeUndefined(); // the last good cache is left alone
    expect(runs[0].ok).toBe(false);
  });
});

describe("finance-nightly (Edge Function)", () => {
  it("refuses a caller without the key, before any bank call", async () => {
    expect((await call("")).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect((await call(KEY, "GET")).status).toBe(405);
    expect(bridgeCalls).toEqual([]);
    expect(db.finnightly_status).toBeUndefined();
  });

  it("runs once with the key and records the result", async () => {
    const res = await call();
    expect(res.status).toBe(202);
    expect(bridgeCalls).toHaveLength(1);
    const s = db.finnightly_status;
    expect(s.ok).toBe(true);
    expect(s.finishedAt).toBeTruthy();
    expect(s.lastGood).toBe(s.finishedAt);
    expect(s.runs[0].snapshot).toBe(true);
  });

  it("a second call soon after is skipped (the bank's request budget)", async () => {
    await call();
    const res = await call();
    expect(await res.json()).toEqual({ skipped: "ran recently" });
    expect(bridgeCalls).toHaveLength(1);
  });

  it("a failed run keeps the time of the last good one", async () => {
    await call();
    const good = db.finnightly_status.lastGood;
    db.finnightly_status.startedAt = new Date(Date.now() - 3600e3).toISOString();
    bridge = () => json({}, 500);
    await call();
    expect(db.finnightly_status.ok).toBe(false);
    expect(db.finnightly_status.lastGood).toBe(good);
  });

  it("can be switched off", async () => {
    env.FINANCE_NIGHTLY_DISABLED = "1";
    expect((await call()).status).toBe(503);
    expect(bridgeCalls).toEqual([]);
  });
});
