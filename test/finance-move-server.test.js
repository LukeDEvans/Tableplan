import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { moveFinanceAccounts } = require("../netlify/functions/_finance-move.js");

// FINANCE_SPLIT_DESIGN.md §8: the move, against a fake Supabase. LUKE is the
// household's admin; WIFE a member. "acc-card" (bank id B-CARD) is the account
// Luke marks Personal.
const G = "g1", LUKE = "luke-id", WIFE = "wife-id", ME = `u-${LUKE}`;
const NOW = new Date("2026-11-12T12:00:00Z");

let states, txns, views, log, failOn;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const inValues = (u, field) => {
  const m = u.match(new RegExp(`[?&]${field}=in\\.\\(([^)]*)\\)`));
  return m ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]) : null;
};
const eqValue = (u, field) => u.match(new RegExp(`[?&]${field}=eq\\.([^&]+)`))?.[1];

async function fakeFetch(url, opts = {}) {
  const u = decodeURIComponent(String(url));
  const method = opts.method || "GET";
  const table = u.match(/\/rest\/v1\/([a-z_]+)/)[1];
  log.push({ method, table, u, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  if (failOn && failOn({ method, table, u, id: log.at(-1).body?.id })) return json("boom", 500);
  if (table === "live_group_members") return json([{ user_id: LUKE, role: "admin" }, { user_id: WIFE, role: "member" }]);
  if (table === "tableplan_states") {
    if (method === "POST") { const row = JSON.parse(opts.body); states[row.id] = JSON.parse(JSON.stringify(row.state)); return json(null); }
    const id = eqValue(u, "id");
    return json(states[id] ? [{ state: JSON.parse(JSON.stringify(states[id])) }] : []);
  }
  if (table === "finance_transactions") {
    const group = eqValue(u, "group_id");
    const accounts = inValues(u, "account_id");
    const ids = inValues(u, "id");
    const match = (r) => r.group_id === group && (!accounts || accounts.includes(r.account_id)) && (!ids || ids.includes(r.id));
    if (method === "PATCH") {
      const to = JSON.parse(opts.body).group_id;
      for (const r of txns.filter(match)) {
        if (txns.some((x) => x.group_id === to && x.id === r.id)) return json("duplicate key", 409);
        r.group_id = to;
      }
      return json(null);
    }
    if (method === "DELETE") { txns = txns.filter((r) => !match(r)); return json(null); }
    const offset = Number(u.match(/offset=(\d+)/)?.[1] || 0);
    const limit = Number(u.match(/limit=(\d+)/)?.[1] || 1000);
    return json(txns.filter(match).sort((a, b) => a.id.localeCompare(b.id)).slice(offset, offset + limit).map((r) => ({ id: r.id, account_id: r.account_id, description: r.description })));
  }
  if (table === "live_finance_account_views") {
    if (method === "POST") { for (const row of JSON.parse(opts.body)) { views = views.filter((v) => v.linked_id !== row.linked_id); views.push(row); } return json(null); }
    if (method === "DELETE") { const gone = inValues(u, "linked_id"); const owner = eqValue(u, "owner_id"); views = views.filter((v) => !(gone.includes(v.linked_id) && v.owner_id === owner)); return json(null); }
  }
  throw new Error("unexpected fetch " + method + " " + u);
}

const householdSection = () => ({
  schemaVersion: 8, financeTxnSource: "store",
  financeAccounts: [
    { id: "acc-joint", name: "Joint", linkedId: "B-JOINT" },
    { id: "acc-card", name: "Luke Card", linkedId: "B-CARD" },
  ],
  financeBudgetGroups: [{ id: "grp", label: "Needs", categories: [{ id: "cat-food", name: "Food", items: [{ id: "i1", name: "Food", amount: 500, note: "" }] }] }],
  financeTxnLabels: { "T-j1": "cat:grp:cat-food", "T-c1": "cat:grp:cat-food" },
  financeTxnNoteOverrides: { "T-c1": "private note" },
  financeMonthActuals: { "2026-10": { total: 1 } },
});

beforeEach(() => {
  log = []; failOn = null; views = [];
  states = {
    [`${G}:finance`]: householdSection(),
    [`finhist_${G}`]: { days: { "2026-11-10": { netWorth: 700, balances: { "acc-joint": 1000, "acc-card": -300 } } } },
    [`finaccts_${G}`]: { fetchedAt: "2026-11-11T10:00:00Z", errors: [], accounts: [{ id: "B-JOINT", balance: 1000, transactions: [] }, { id: "B-CARD", balance: -300, transactions: [{ id: "T-c1" }] }] },
    [`finbackup_${G}`]: { snapshots: { "2026-11-11": householdSection() } },
  };
  txns = [
    { group_id: G, id: "T-j1", account_id: "B-JOINT", description: "ALDI" },
    { group_id: G, id: "T-c1", account_id: "B-CARD", description: "WEST MARINE" },
    { group_id: G, id: "T-c2", account_id: "B-CARD", description: "WEST MARINE" },
  ];
});
const run = (extra = {}) => moveFinanceAccounts({ serviceKey: "svc", groupId: G, userId: LUKE, direction: "toPersonal", accountIds: ["acc-card"], dryRun: false, fetchImpl: fakeFetch, now: () => NOW, ...extra });
const writes = () => log.filter((l) => l.method !== "GET");

describe("who can move accounts", () => {
  it("a member who isn't the admin is refused, and nothing is written", async () => {
    const r = await run({ userId: WIFE });
    expect(r.status).toBe(403);
    expect(writes()).toEqual([]);
  });
  it("needs a direction and an account", async () => {
    expect((await run({ direction: "sideways" })).status).toBe(400);
    expect((await run({ accountIds: [] })).status).toBe(400);
    expect((await run({ accountIds: ["nope"] })).status).toBe(400);
    expect(writes()).toEqual([]);
  });
});

describe("the dry run", () => {
  it("reports what would move and writes nothing", async () => {
    const before = JSON.stringify({ states, txns, views });
    const r = await run({ dryRun: true });
    expect(r).toMatchObject({ ok: true, dryRun: true });
    expect(r.report.accounts[0]).toMatchObject({ id: "acc-card", transactions: 2, labels: 1, notes: 1 });
    expect(r.report.historyDays).toBe(1);
    expect(r.report.copiedCategories.map((c) => c.name)).toEqual(["Food"]);
    expect(writes()).toEqual([]);
    expect(JSON.stringify({ states, txns, views })).toBe(before);
  });
  it("defaults to a dry run", async () => {
    const r = await moveFinanceAccounts({ serviceKey: "svc", groupId: G, userId: LUKE, direction: "toPersonal", accountIds: ["acc-card"], fetchImpl: fakeFetch, now: () => NOW });
    expect(r.dryRun).toBe(true);
    expect(writes()).toEqual([]);
  });
});

describe("the move to Personal", () => {
  it("moves the section, the stored transactions, the assignment, the history and the cache", async () => {
    const r = await run();
    expect(r).toMatchObject({ ok: true, dryRun: false });
    expect(r.verified).toEqual({ accountsLeft: 0, annotationsLeft: 0, storeRowsLeft: 0, cacheAccountsLeft: 0, historyDaysLeft: 0, clean: true });
    // section
    const hh = states[`${G}:finance`], mine = states[`${ME}:finance`];
    expect(hh.financeAccounts.map((a) => a.id)).toEqual(["acc-joint"]);
    expect(mine.financeAccounts.map((a) => a.id)).toEqual(["acc-card"]);
    expect(hh.financeTxnLabels).toEqual({ "T-j1": "cat:grp:cat-food" });
    expect(mine.financeTxnLabels).toEqual({ "T-c1": "cat:grp:cat-food" });
    expect(mine.financeTxnNoteOverrides).toEqual({ "T-c1": "private note" });
    expect(mine.financeTxnSource).toBe("store");
    expect(mine.schemaVersion).toBe(8);
    expect(mine.financeBudgetGroups[0].categories[0].items[0].amount).toBe(0);
    expect(hh.financeMovedOut).toMatchObject({ epoch: 1, accounts: ["acc-card"], linked: ["B-CARD"] });
    // store, assignment
    expect(txns.map((t) => `${t.id}:${t.group_id}`).sort()).toEqual([`T-c1:${ME}`, `T-c2:${ME}`, `T-j1:${G}`]);
    expect(views).toEqual([{ group_id: G, linked_id: "B-CARD", owner_id: LUKE, view: "personal" }]);
    // history, cache
    expect(states[`finhist_${G}`].days["2026-11-10"]).toEqual({ netWorth: 1000, balances: { "acc-joint": 1000 } });
    expect(states[`finhist_${ME}`].days["2026-11-10"]).toEqual({ netWorth: -300, balances: { "acc-card": -300 } });
    expect(states[`finaccts_${G}`].accounts.map((a) => a.id)).toEqual(["B-JOINT"]);
    expect(states[`finaccts_${ME}`].accounts.map((a) => a.id)).toEqual(["B-CARD"]);
  });

  it("nothing about the moved account is left in anything the household can be served", async () => {
    await run();
    const served = JSON.stringify({ section: { ...states[`${G}:finance`], financeMovedOut: null }, cache: states[`finaccts_${G}`], hist: states[`finhist_${G}`], rows: txns.filter((t) => t.group_id === G) });
    for (const s of ["acc-card", "B-CARD", "T-c1", "T-c2", "private note", "WEST MARINE"]) expect(served.includes(s), s).toBe(false);
  });

  it("writes both sections with the move header, the receiving one first", async () => {
    await run();
    const sectionWrites = writes().filter((l) => l.table === "tableplan_states" && /:finance$/.test(l.body.id));
    expect(sectionWrites.map((l) => l.body.id)).toEqual([`${ME}:finance`, `${G}:finance`]);
    expect(sectionWrites.every((l) => l.headers["x-live-finance-move"] === "1")).toBe(true);
    const others = writes().filter((l) => l.table === "tableplan_states" && !/:finance$/.test(l.body.id));
    expect(others.every((l) => !l.headers["x-live-finance-move"])).toBe(true);
  });

  it("backs up first, and assigns before it moves any row", async () => {
    await run();
    const order = writes().map((l) => (l.table === "tableplan_states" ? l.body.id : `${l.method} ${l.table}`));
    expect(order[0]).toBe(`finmovebackup_${G}`);
    expect(order[1]).toBe("POST live_finance_account_views");
    expect(order.indexOf("PATCH finance_transactions")).toBeGreaterThan(1);
    expect(order.indexOf("PATCH finance_transactions")).toBeLessThan(order.indexOf(`${ME}:finance`));
    const backup = Object.values(states[`finmovebackup_${G}`].backups)[0];
    expect(backup.fromSection).toEqual(householdSection());
    expect(backup.fromHistory.days["2026-11-10"].balances["acc-card"]).toBe(-300);
    expect(backup.fromCache.accounts.length).toBe(2);
    expect(backup.txnIds.sort()).toEqual(["T-c1", "T-c2"]);
  });

  it("gives the nightly backup a fresh baseline for both scopes", async () => {
    await run();
    expect(states[`finbackup_${G}`].snapshots["2026-11-12"].financeAccounts.map((a) => a.id)).toEqual(["acc-joint"]);
    expect(states[`finbackup_${G}`].snapshots["2026-11-11"]).toBeTruthy(); // older days kept
    expect(states[`finbackup_${ME}`].snapshots["2026-11-12"].financeAccounts.map((a) => a.id)).toEqual(["acc-card"]);
  });

  it("drops move backups older than 30 days", async () => {
    states[`finmovebackup_${G}`] = { backups: { "2026-09-01T00:00:00.000Z": { old: true }, "2026-11-01T00:00:00.000Z": { recent: true } } };
    await run();
    expect(Object.keys(states[`finmovebackup_${G}`].backups).sort()).toEqual(["2026-11-01T00:00:00.000Z", NOW.toISOString()]);
  });
});

describe("stopping part-way and running again", () => {
  for (const [name, at] of [
    ["after the assignment", ({ method, table }) => method === "PATCH" && table === "finance_transactions"],
    ["after the stored transactions", ({ method, id }) => method === "POST" && String(id || "").startsWith("finhist_")],
    ["before the household's section is written", null],
  ]) {
    it(`a run that fails ${name} loses nothing, and a second run finishes`, async () => {
      if (name.startsWith("before")) {
        let seen = 0;
        failOn = ({ method, table }) => method === "POST" && table === "tableplan_states" && log.filter((l) => l.method === "POST" && l.table === "tableplan_states" && /:finance$/.test(l.body?.id || "")).length === 2 && seen++ === 0;
      } else if (at) failOn = at;
      if (failOn) await expect(run()).rejects.toThrow();
      // Nothing is lost: every label and note is still in one section or the other.
      const all = JSON.stringify([states[`${G}:finance`], states[`${ME}:finance`] || {}]);
      expect(all.includes("private note")).toBe(true);
      failOn = null;
      const r = await run();
      expect(r.verified?.clean ?? true).toBe(true);
      expect(states[`${G}:finance`].financeAccounts.map((a) => a.id)).toEqual(["acc-joint"]);
      expect(states[`${ME}:finance`].financeAccounts.map((a) => a.id)).toEqual(["acc-card"]);
      expect(states[`${ME}:finance`].financeTxnNoteOverrides).toEqual({ "T-c1": "private note" });
      expect(txns.filter((t) => t.group_id === ME).map((t) => t.id).sort()).toEqual(["T-c1", "T-c2"]);
      expect(views.length).toBe(1);
    });
  }

  it("a run that stopped after both sections were written finishes its backup baseline and check", async () => {
    failOn = ({ method, id }) => method === "POST" && String(id || "").startsWith("finbackup_");
    await expect(run()).rejects.toThrow();
    expect(states[`finbackup_${G}`].snapshots["2026-11-12"]).toBeUndefined();
    failOn = null;
    const dry = await run({ dryRun: true });
    expect(dry).toMatchObject({ ok: true, alreadyMoved: true });
    const r = await run();
    expect(r).toMatchObject({ ok: true, alreadyMoved: true });
    expect(r.verified.clean).toBe(true);
    expect(states[`finbackup_${G}`].snapshots["2026-11-12"].financeAccounts.map((a) => a.id)).toEqual(["acc-joint"]);
    expect(states[`${ME}:finance`].financeTxnNoteOverrides).toEqual({ "T-c1": "private note" });
  });

  it("a transaction a bank pull already stored on the receiving side isn't duplicated", async () => {
    txns.push({ group_id: ME, id: "T-c1", account_id: "B-CARD", description: "WEST MARINE" });
    const r = await run();
    expect(r.verified.clean).toBe(true);
    expect(txns.filter((t) => t.id === "T-c1").map((t) => t.group_id)).toEqual([ME]);
    expect(txns.filter((t) => t.group_id === ME).length).toBe(2);
  });
});

describe("the move back to Household", () => {
  it("returns the account, its labels, rows, history and cache, and removes the assignment", async () => {
    await run();
    log = [];
    const r = await run({ direction: "toHousehold" });
    expect(r.verified.clean).toBe(true);
    const hh = states[`${G}:finance`], mine = states[`${ME}:finance`];
    expect(hh.financeAccounts.map((a) => a.id).sort()).toEqual(["acc-card", "acc-joint"]);
    expect(hh.financeTxnNoteOverrides).toEqual({ "T-c1": "private note" });
    expect(hh.financeMovedOut).toEqual({ epoch: 2, accounts: [], linked: [], txns: [] });
    expect(mine.financeAccounts).toEqual([]);
    expect(mine.financeMovedOut.accounts).toEqual(["acc-card"]);
    expect(txns.every((t) => t.group_id === G)).toBe(true);
    expect(views).toEqual([]);
    expect(states[`finhist_${G}`].days["2026-11-10"]).toEqual({ netWorth: 700, balances: { "acc-joint": 1000, "acc-card": -300 } });
    expect(states[`finaccts_${G}`].accounts.map((a) => a.id).sort()).toEqual(["B-CARD", "B-JOINT"]);
    expect(states[`finaccts_${ME}`].accounts).toEqual([]);
  });
});

// ── The action in simplefin.js: a dry run unless confirmed AND switched on ────
describe("simplefin action moveAccounts", () => {
  const { handler } = require("../netlify/functions/simplefin.js");
  const realFetch = globalThis.fetch;
  const call = (body) => handler({ httpMethod: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ action: "moveAccounts", direction: "toPersonal", accountIds: ["acc-card"], ...body }) });
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
    delete process.env.FINANCE_MOVE_ENABLED;
    globalThis.fetch = async (url, opts) => {
      const u = decodeURIComponent(String(url));
      if (u.includes("/auth/v1/user")) return json({ id: LUKE });
      if (u.includes("live_group_members") && !u.includes("select=user_id,role")) return json([{ group_id: G }]);
      return fakeFetch(url, opts);
    };
    return () => { globalThis.fetch = realFetch; };
  });
  it("without confirm it only reports", async () => {
    const res = await call({});
    const out = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(out.dryRun).toBe(true);
    expect(out.report.accounts[0].transactions).toBe(2);
    expect(writes()).toEqual([]);
  });
  it("a confirmed move is refused until it is switched on", async () => {
    const res = await call({ confirm: true });
    expect(res.statusCode).toBe(409);
    expect(writes()).toEqual([]);
    expect(states[`${G}:finance`].financeAccounts.length).toBe(2);
  });
  it("switched on and confirmed, it moves", async () => {
    process.env.FINANCE_MOVE_ENABLED = "1";
    const res = await call({ confirm: true });
    const out = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(out.verified.clean).toBe(true);
    expect(states[`${G}:finance`].financeAccounts.map((a) => a.id)).toEqual(["acc-joint"]);
    delete process.env.FINANCE_MOVE_ENABLED;
  });
  it("a bad request comes back as an error, not a move", async () => {
    const res = await call({ accountIds: ["nope"], confirm: false });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBeTruthy();
  });
});
