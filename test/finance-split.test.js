import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const split = require("../netlify/functions/_finance-split.js");
const { handler } = require("../netlify/functions/simplefin.js");

// FINANCE_SPLIT_DESIGN.md §2.1: one SimpleFIN connection, split on the server.
// "LUKE" owns personal account A2; "WIFE" is a household member with none.
const G = "g1";
const LUKE = "luke-id";
const WIFE = "wife-id";

const acct = (id, balance, txns = []) => ({ id, org: "Bank", name: id, currency: "USD", balance, available: null, balanceDate: null, transactions: txns });

describe("_finance-split: pure helpers", () => {
  const views = new Map([["A2", LUKE]]);
  it("sorts accounts into household and each owner's", () => {
    const out = split.splitAccounts([acct("A1", 1), acct("A2", 2), acct("A3", 3)], views);
    expect(out.household.map((a) => a.id)).toEqual(["A1", "A3"]);
    expect(Object.keys(out.byOwner)).toEqual([LUKE]);
    expect(out.byOwner[LUKE].map((a) => a.id)).toEqual(["A2"]);
  });
  it("with no assignments everything is household (today's behaviour)", () => {
    const out = split.splitAccounts([acct("A1", 1), acct("A2", 2)], new Map());
    expect(out.household).toHaveLength(2);
    expect(out.byOwner).toEqual({});
  });
  it("a member gets household accounts plus only their own personal ones", () => {
    const household = [acct("A1", 1), acct("A2", 2)]; // A2 left over in an old cache
    const personal = [acct("A2", 2)];
    expect(split.accountsForMember({ householdAccounts: household, personalAccounts: personal, views, userId: LUKE }).map((a) => `${a.id}:${a.scope || "household"}`)).toEqual(["A1:household", "A2:personal"]);
    expect(split.accountsForMember({ householdAccounts: household, personalAccounts: personal, views, userId: WIFE }).map((a) => a.id)).toEqual(["A1"]);
  });
  it("owner helpers", () => {
    expect(split.ownsAny(views, LUKE)).toBe(true);
    expect(split.ownsAny(views, WIFE)).toBe(false);
    expect(split.ownersOf(views)).toEqual([LUKE]);
    expect(split.personalScopeId(LUKE)).toBe(`u-${LUKE}`);
  });
  it("loadAccountViews: rows → map; missing table → empty; other errors fail closed", async () => {
    const ok = (body) => async () => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
    const err = (status, text) => async () => ({ ok: false, status, json: async () => ({}), text: async () => text });
    expect([...(await split.loadAccountViews({ serviceKey: "s", groupId: G, fetchImpl: ok([{ linked_id: "A2", owner_id: LUKE }]) })).map]).toEqual([["A2", LUKE]]);
    expect(await split.loadAccountViews({ serviceKey: "s", groupId: G, fetchImpl: err(404, '{"code":"PGRST205"}') })).toMatchObject({ ok: true });
    expect((await split.loadAccountViews({ serviceKey: "s", groupId: G, fetchImpl: err(500, "boom") })).ok).toBe(false);
    expect((await split.loadAccountViews({ serviceKey: "s", groupId: G, fetchImpl: async () => { throw new Error("net"); } })).ok).toBe(false);
  });
});

// ── simplefin.js against a fake Supabase + bridge ────────────────────────────
let db, writes, caller, viewsRows, viewsStatus, bridgeAccounts;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

async function fakeFetch(url, opts = {}) {
  const u = decodeURIComponent(String(url));
  const method = opts.method || "GET";
  if (u.includes("/auth/v1/user")) return json({ id: caller });
  if (u.includes("live_group_members")) return json([{ group_id: G }]);
  if (u.includes("live_finance_account_views")) return viewsStatus === 200 ? json(viewsRows) : json("boom", viewsStatus);
  if (u.startsWith("https://bridge.test")) return json({ accounts: bridgeAccounts, errors: [] });
  if (u.includes("/rest/v1/finance_transactions")) {
    if (method === "POST") { writes.push({ table: "finance_transactions", rows: JSON.parse(opts.body) }); return json(null); }
    return json([]); // reconcile read
  }
  if (u.includes("/rest/v1/tableplan_states")) {
    if (method === "POST") {
      const row = JSON.parse(opts.body);
      db[row.id] = row.state;
      writes.push({ table: "tableplan_states", id: row.id });
      return json(null);
    }
    const id = u.match(/id=eq\.([^&]+)/)?.[1];
    return json(id && db[id] ? [{ state: db[id] }] : []);
  }
  throw new Error("unexpected fetch " + u);
}
const call = (body, as = caller) => { caller = as; return handler({ httpMethod: "POST", headers: { authorization: "Bearer tok" }, body: JSON.stringify(body) }); };
const ids = (res) => JSON.parse(res.body).accounts.map((a) => `${a.id}:${a.scope || "household"}`);

beforeEach(() => {
  db = { [`simplefin_${G}`]: { accessUrl: "https://user:pw@bridge.test/simplefin" } };
  writes = [];
  viewsRows = [];
  viewsStatus = 200;
  caller = LUKE;
  bridgeAccounts = [
    { id: "A1", org: { name: "Joint Bank" }, name: "Joint", balance: "100", transactions: [{ id: "t1", posted: 1760000000, amount: "-5", description: "Groceries" }] },
    { id: "A2", org: { name: "My Bank" }, name: "Mine", balance: "50", transactions: [{ id: "t2", posted: 1760000000, amount: "-7", description: "Lunch" }] },
  ];
  process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
  globalThis.fetch = fakeFetch;
});
afterEach(() => { delete process.env.SUPABASE_SERVICE_ROLE_KEY; });

describe("simplefin accounts: split by assignment", () => {
  it("no personal accounts: exactly today's behaviour", async () => {
    const res = await call({ action: "accounts", force: true });
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(["A1:household", "A2:household"]);
    expect(db[`finaccts_${G}`].accounts.map((a) => a.id)).toEqual(["A1", "A2"]);
    expect(Object.keys(db).some((k) => k.startsWith("finaccts_u-"))).toBe(false);
    const groups = writes.filter((w) => w.table === "finance_transactions").flatMap((w) => w.rows.map((r) => r.group_id));
    expect(new Set(groups)).toEqual(new Set([G]));
  });

  it("a personal account is saved only to its owner's cache and store", async () => {
    viewsRows = [{ linked_id: "A2", owner_id: LUKE }];
    await call({ action: "accounts", force: true });
    expect(db[`finaccts_${G}`].accounts.map((a) => a.id)).toEqual(["A1"]);
    expect(db[`finaccts_u-${LUKE}`].accounts.map((a) => a.id)).toEqual(["A2"]);
    const txnWrites = writes.filter((w) => w.table === "finance_transactions").flatMap((w) => w.rows);
    expect(txnWrites.filter((r) => r.group_id === G).every((r) => r.account_id === "A1")).toBe(true);
    expect(txnWrites.filter((r) => r.group_id === `u-${LUKE}`).every((r) => r.account_id === "A2")).toBe(true);
    expect(txnWrites.some((r) => r.group_id === G && r.account_id === "A2")).toBe(false);
  });

  it("the owner sees it (marked personal); the other member never does", async () => {
    viewsRows = [{ linked_id: "A2", owner_id: LUKE }];
    expect(ids(await call({ action: "accounts", force: true }, LUKE))).toEqual(["A1:household", "A2:personal"]);
    expect(ids(await call({ action: "accounts" }, WIFE))).toEqual(["A1:household"]);
    expect(ids(await call({ action: "accounts", cacheOnly: true }, WIFE))).toEqual(["A1:household"]);
  });

  it("an older household cache that still holds the account is filtered", async () => {
    db[`finaccts_${G}`] = { accounts: [{ id: "A1" }, { id: "A2", balance: 50 }], errors: [], fetchedAt: new Date().toISOString() };
    viewsRows = [{ linked_id: "A2", owner_id: LUKE }];
    expect(ids(await call({ action: "accounts" }, WIFE))).toEqual(["A1:household"]);
  });

  it("fails closed: assignments unreadable → nothing served or saved", async () => {
    viewsStatus = 500;
    const res = await call({ action: "accounts", force: true }, WIFE);
    expect(res.statusCode).toBe(503);
    expect(writes).toEqual([]);
  });

  it("history: the owner also gets their personal history; others don't", async () => {
    db[`finhist_${G}`] = { days: { "2026-10-19": { netWorth: 100 } } };
    db[`finhist_u-${LUKE}`] = { days: { "2026-10-19": { netWorth: 50 } } };
    viewsRows = [{ linked_id: "A2", owner_id: LUKE }];
    const mine = JSON.parse((await call({ action: "history" }, LUKE)).body);
    expect(mine.personalDays["2026-10-19"].netWorth).toBe(50);
    const hers = JSON.parse((await call({ action: "history" }, WIFE)).body);
    expect(hers.personalDays).toBeUndefined();
    expect(hers.days["2026-10-19"].netWorth).toBe(100);
  });

  it("merging a relinked personal account is refused until the move exists", async () => {
    viewsRows = [{ linked_id: "A2", owner_id: LUKE }];
    const res = await call({ action: "remapAccount", oldAccountId: "A2", newAccountId: "A9" }, LUKE);
    expect(res.statusCode).toBe(409);
  });
});

describe("daily snapshot: split by assignment", () => {
  it("household history and backups never count a personal account; the owner's are separate", async () => {
    const { snapshotFinanceBalances } = await import("../netlify/functions/daily-briefing.js");
    viewsRows = [{ linked_id: "A2", owner_id: LUKE }];
    // A1 still listed in the household section; A2 already moved to Luke's.
    db[`${G}:finance`] = { financeAccounts: [{ id: "h1", linkedId: "A1" }, { id: "stale", linkedId: "A2" }, { id: "cash", manualBalance: 20 }], financeBudgetGroups: [] };
    db[`u-${LUKE}:finance`] = { financeAccounts: [{ id: "p1", linkedId: "A2" }], financeBudgetGroups: [] };
    // fake the "simplefin*" listing
    const base = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (String(url).includes("id=like.simplefin")
      ? json([{ id: `simplefin_${G}`, state: db[`simplefin_${G}`] }])
      : base(url, opts));
    await snapshotFinanceBalances("svc");
    globalThis.fetch = base;
    expect(db[`finaccts_${G}`].accounts.map((a) => a.id)).toEqual(["A1"]);
    expect(db[`finaccts_u-${LUKE}`].accounts.map((a) => a.id)).toEqual(["A2"]);
    const day = Object.values(db[`finhist_${G}`].days)[0];
    expect(day.balances).toEqual({ h1: 100, cash: 20 }); // the stale A2 entry is not counted
    expect(day.netWorth).toBe(120);
    const mine = Object.values(db[`finhist_u-${LUKE}`].days)[0];
    expect(mine.balances).toEqual({ p1: 50 });
    expect(db[`finbackup_u-${LUKE}`]).toBeTruthy();
    const txns = writes.filter((w) => w.table === "finance_transactions").flatMap((w) => w.rows);
    expect(txns.some((r) => r.group_id === G && r.account_id === "A2")).toBe(false);
  });

  it("assignments unreadable → the group is skipped entirely", async () => {
    const { snapshotFinanceBalances } = await import("../netlify/functions/daily-briefing.js");
    viewsStatus = 500;
    const base = globalThis.fetch;
    globalThis.fetch = async (url, opts) => (String(url).includes("id=like.simplefin")
      ? json([{ id: `simplefin_${G}`, state: db[`simplefin_${G}`] }])
      : base(url, opts));
    await snapshotFinanceBalances("svc");
    globalThis.fetch = base;
    expect(writes).toEqual([]);
  });
});
