// Applies migrations/2026-11-11-finance-move-guard.sql to PGlite and checks the
// finance trigger: every older rule still holds, the move is taken as written,
// and afterwards nothing that left a row can be written back into it.
//
//   npm i --no-save @electric-sql/pglite@0.2
//   node scripts/check-finance-move-guard-migration.mjs migrations/2026-11-11-finance-move-guard.sql
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIG = readFileSync(process.argv[2], "utf8");
const db = new PGlite();
let pass = 0, fail = 0;
const check = (ok, name, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !detail ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await db.exec(`
create table public.tableplan_states (id text primary key, state jsonb, updated_at timestamptz default now());
`);
await db.exec(MIG);
await db.exec(MIG);
check(true, "applies twice");
await db.exec(`create trigger tp_protect_finance_merge_trg before update on public.tableplan_states for each row execute function public.tp_protect_finance_merge();`);

const ROW = "g1:finance";
const esc = (o) => JSON.stringify(o).replace(/'/g, "''");
// who: "client" (a signed-in app), "server" (service role, no move header), "move" (service role + header), "forged" (a client sending the header)
async function write(who, state, id = ROW) {
  const headers = who === "move" || who === "forged" ? { "x-live-finance-move": "1", "x-live-writer": "2" } : { "x-live-writer": "2" };
  const role = who === "move" || who === "server" ? "service_role" : "authenticated";
  await db.exec(`select set_config('request.headers', '${esc(headers)}', false); select set_config('request.jwt.claims', '${esc({ role })}', false);`);
  await db.exec(`update public.tableplan_states set state = '${esc(state)}'::jsonb where id = '${id}'`);
  return (await db.query(`select state from public.tableplan_states where id = '${id}'`)).rows[0].state;
}
async function reset(state, id = ROW) {
  await db.exec(`delete from public.tableplan_states where id = '${id}'; insert into public.tableplan_states (id, state) values ('${id}', '${esc(state)}'::jsonb);`);
}
const base = () => ({
  schemaVersion: 8,
  financeAccounts: [{ id: "acc-joint", linkedId: "B-JOINT" }, { id: "acc-card", linkedId: "B-CARD" }],
  financeCashAccountIds: ["acc-joint", "acc-card"],
  financeAccountSubLabels: { "acc-card": "Travel", "acc-joint": "Bills" },
  financeTxnLabels: { "T-j1": "cat:a:b", "T-c1": "cat:a:c" },
  financeTxnNoteOverrides: { "T-c1": "private note", "T-j1": "ok" },
  financeTxnReceipts: { "T-c1": { path: "p" } },
  financeLabelSkips: { "id:T-c1": true, "aldi": true },
  financeDismissedAlerts: { "large:T-c1": true, "large:T-j1": true },
  financeManualTxns: [{ id: "T-m1" }, { id: "T-m2" }],
  financeMonthActuals: { "2026-10": { total: 900 } },
  financeBudgetGroups: [{ id: "g", categories: [{ id: "c" }] }],
  financePeople: [{ id: "p" }],
});
const afterMove = () => {
  const s = base();
  s.financeAccounts = [{ id: "acc-joint", linkedId: "B-JOINT" }];
  s.financeCashAccountIds = ["acc-joint"];
  s.financeAccountSubLabels = { "acc-joint": "Bills" };
  s.financeTxnLabels = { "T-j1": "cat:a:b" };
  s.financeTxnNoteOverrides = { "T-j1": "ok" };
  s.financeTxnReceipts = {};
  s.financeLabelSkips = { aldi: true };
  s.financeDismissedAlerts = { "large:T-j1": true };
  s.financeManualTxns = [{ id: "T-m2" }];
  s.financeMonthActuals = {};
  s.financeMovedOut = { epoch: 1, accounts: ["acc-card"], linked: ["B-CARD"], txns: ["T-c1", "T-m1"] };
  return s;
};

console.log("\nThe older rules still hold (no move has happened)");
await reset(base());
let s = await write("client", { ...base(), financeTxnLabels: { "T-new": "income" } });
check(eq(Object.keys(s.financeTxnLabels).sort(), ["T-c1", "T-j1", "T-new"]), "a writer with an old copy can't drop another device's labels", s.financeTxnLabels);
await reset(base());
s = await write("client", { schemaVersion: 8, financeTxnLabels: {} });
check(s.financeAccounts.length === 2 && s.financePeople.length === 1, "keys a writer omits are kept");
await reset(base());
s = await write("client", { ...base(), schemaVersion: 7, financeAccounts: [{ id: "old" }], financeAnnualIncome: 5 });
check(s.financeAccounts.length === 2 && s.financeAccounts[0].id === "acc-joint", "an older-schema build can't change finance keys", s.financeAccounts);
await reset(base());
s = await write("client", { ...base(), financeAccounts: [], financePeople: [] });
check(s.financeAccounts.length === 2 && s.financePeople.length === 1, "an empty accounts / people list never erases a populated one");
await reset(base());
s = await write("client", { ...base(), financeBudgetGroups: [{ id: "g", categories: [] }] });
check(s.financeBudgetGroups[0].categories.length === 1, "empty budget groups never erase categories");
await reset(base());
s = await write("client", { ...base(), financeMovedOut: { epoch: 9, accounts: ["acc-joint"], linked: [], txns: ["T-j1"] } });
check(!("financeMovedOut" in s) && s.financeAccounts.length === 2 && "T-j1" in s.financeTxnLabels, "an app can't invent a record of moved accounts (and nothing is stripped)", s.financeMovedOut);
await reset({ a: 1 }, "g1:eat");
s = await write("client", { b: 2 }, "g1:eat");
check(eq(s, { b: 2 }), "other rows are untouched by this trigger");

console.log("\nThe move is taken as written");
await reset(base());
s = await write("move", afterMove());
check(eq(s.financeAccounts.map((a) => a.id), ["acc-joint"]), "the moved account is gone from the row");
check(eq(s.financeTxnLabels, { "T-j1": "cat:a:b" }) && eq(s.financeTxnNoteOverrides, { "T-j1": "ok" }), "its labels and notes are gone (no union)");
check(eq(s.financeMonthActuals, {}), "month totals are reset");
check(s.financeMovedOut?.epoch === 1, "what left is recorded");
check(!JSON.stringify({ ...s, financeMovedOut: null }).includes("T-c1") && !JSON.stringify({ ...s, financeMovedOut: null }).includes("private note"), "nothing about the moved transaction is left in the row");
await reset(base());
s = await write("move", { financeAccounts: [], financeMovedOut: { epoch: 1, accounts: ["acc-joint", "acc-card"], linked: [], txns: [] } });
check(s.financeAccounts.length === 0 && s.financePeople.length === 1, "a move may empty the accounts list; keys it omits are still kept");
await reset(base());
s = await write("forged", afterMove());
check("T-c1" in s.financeTxnLabels && s.financeTxnNoteOverrides["T-c1"] === "private note" && !("financeMovedOut" in s), "an app sending the move header is not the move (labels are unioned as usual, no record is taken)", { movedOut: s.financeMovedOut });
await reset(base());
s = await write("server", afterMove());
check("T-c1" in s.financeTxnLabels && !("financeMovedOut" in s), "a server write without the header is not the move either");

console.log("\nAfter the move, nothing that left can be written back");
await reset(base());
await write("move", afterMove());
s = await write("client", base()); // a device's copy from before the move, no financeMovedOut
check(eq(s.financeAccounts.map((a) => a.id), ["acc-joint"]), "the moved account doesn't come back", s.financeAccounts);
check(eq(s.financeCashAccountIds, ["acc-joint"]) && eq(s.financeAccountSubLabels, { "acc-joint": "Bills" }), "nor its card-list place or sub-label");
check(eq(s.financeTxnLabels, { "T-j1": "cat:a:b" }) && eq(s.financeTxnNoteOverrides, { "T-j1": "ok" }) && eq(s.financeTxnReceipts, {}), "nor its labels, notes or receipts", s.financeTxnLabels);
check(eq(s.financeLabelSkips, { aldi: true }) && eq(s.financeDismissedAlerts, { "large:T-j1": true }), "nor its per-transaction skips and alerts", s.financeLabelSkips);
check(eq(s.financeManualTxns, [{ id: "T-m2" }]), "nor its manual transactions", s.financeManualTxns);
check(eq(s.financeMonthActuals, {}), "and its old month totals (which counted the moved account) are refused", s.financeMonthActuals);
check(s.financeMovedOut?.epoch === 1 && eq(s.financeMovedOut.txns, ["T-c1", "T-m1"]), "the record of what left survives a write that omits it");
s = await write("client", { ...afterMove(), financeMovedOut: { epoch: 1, accounts: [], linked: [], txns: [] }, financeAccounts: [{ id: "acc-joint", linkedId: "B-JOINT" }, { id: "acc-card", linkedId: "B-CARD" }] });
check(eq(s.financeMovedOut.accounts, ["acc-card"]) && s.financeAccounts.length === 1, "an app can't shorten the record to let an account back in", s.financeMovedOut);
s = await write("client", { ...afterMove(), financeAccounts: [{ id: "acc-joint", linkedId: "B-JOINT" }, { id: "acc-relinked", linkedId: "B-CARD" }] });
check(eq(s.financeAccounts.map((a) => a.id), ["acc-joint"]), "a new entry for the same bank account is refused too");
s = await write("client", { ...afterMove(), financeMonthActuals: { "2026-11": { total: 120 } }, financeTxnLabels: { "T-j1": "cat:a:b", "T-j9": "income" } });
check(eq(s.financeMonthActuals, { "2026-11": { total: 120 } }), "a device that has seen the move saves rebuilt month totals", s.financeMonthActuals);
check("T-j9" in s.financeTxnLabels, "and ordinary labelling carries on");
s = await write("client", { ...base(), financeTxnLabels: { "T-j1": "mgmt" } });
check(s.financeTxnLabels["T-j1"] === "mgmt" && s.financeTxnLabels["T-j9"] === "income", "an old copy can still label what stayed");

console.log("\nMoving back");
s = await write("move", { ...base(), financeMovedOut: { epoch: 2, accounts: [], linked: [], txns: [] }, financeMonthActuals: {} });
check(s.financeAccounts.length === 2 && "T-c1" in s.financeTxnLabels && s.financeMovedOut.epoch === 2, "the move back restores the account and its labels");
s = await write("client", { ...base(), financeMovedOut: { epoch: 2, accounts: [], linked: [], txns: [] } });
check(s.financeAccounts.length === 2 && "T-c1" in s.financeTxnLabels, "and ordinary writes keep them");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
