import { describe, it, expect } from "vitest";
import { createReceiptsSync, planReceiptPush, applyReceiptRows, receiptScope, receiptSig } from "../receipts-sync.js";

const G = "7aa1feaf-4c11-4b20-a1b4-234082e90c97";
const U = "11111111-1111-1111-1111-111111111111";
const scopes = { groupId: G, userId: U };

describe("receiptScope", () => {
  it("household by default, the person's own scope for a Personal purchase", () => {
    expect(receiptScope({ id: "a" }, scopes)).toBe(G);
    expect(receiptScope({ id: "a", view: "personal" }, scopes)).toBe(`u-${U}`);
  });
});

describe("planReceiptPush", () => {
  it("sends new and changed receipts, not unchanged ones", () => {
    const a = { id: "a", total: 1 }, b = { id: "b", total: 2 };
    const synced = new Map([["a", { sig: receiptSig(a, G), scope: G }], ["b", { sig: receiptSig({ id: "b", total: 1 }, G), scope: G }]]);
    const { write } = planReceiptPush([a, b, { id: "c" }], synced, scopes);
    expect(write.map((w) => w.id)).toEqual(["b", "c"]);
  });
  it("marking a receipt Personal sends it with the new scope", () => {
    const a = { id: "a", total: 1 };
    const synced = new Map([["a", { sig: receiptSig(a, G), scope: G }]]);
    expect(planReceiptPush([{ ...a, view: "personal" }], synced, scopes).write[0].scope).toBe(`u-${U}`);
  });
  it("removes only what the app recorded deleting, never a receipt that just isn't loaded", () => {
    const synced = new Map([["a", { sig: "x", scope: G }], ["b", { sig: "y", scope: G }]]);
    expect(planReceiptPush([], synced, scopes, (id) => id === "b").remove).toEqual([{ id: "b", scope: G }]);
    expect(planReceiptPush([], synced, scopes).remove).toEqual([]);
  });
});

describe("applyReceiptRows", () => {
  it("adds, replaces and drops; leaves the list alone when nothing changed", () => {
    const list = [{ id: "a", total: 1 }, { id: "b", total: 2 }];
    const out = applyReceiptRows(list, [
      { id: "a", data: { id: "a", total: 9 } },
      { id: "b", deleted_at: "2026-11-12T00:00:00Z" },
      { id: "c", data: { id: "c", total: 3 } },
      { id: "d", data: { id: "other", total: 3 } }, // data must belong to its row
    ]);
    expect(out.receipts).toEqual([{ id: "a", total: 9 }, { id: "c", total: 3 }]);
    expect(out.removed).toEqual(["b"]);
    expect(applyReceiptRows(list, [{ id: "a", data: { id: "a", total: 1 } }]).changed).toBe(false);
  });
});

// A stand-in for PostgREST over one table, with "row security" per caller.
function fakeServer(visibleScopes) {
  const rows = new Map();
  let clock = 0;
  const stamp = () => new Date(Date.UTC(2026, 10, 12, 0, 0, clock++)).toISOString();
  const calls = [];
  const visible = (r) => visibleScopes.includes(r.scope);
  return {
    rows, calls,
    transport: {
      select: async (table, q) => {
        calls.push(["select", q]);
        const p = new URLSearchParams(q);
        let out = [...rows.values()].filter(visible);
        const since = p.get("updated_at"); if (since) out = out.filter((r) => r.updated_at > since.replace(/^gt\./, ""));
        const ids = p.get("id"); if (ids) { const want = ids.replace(/^in\.\(|\)$/g, "").split(",").map((x) => x.replace(/"/g, "")); out = out.filter((r) => want.includes(r.id)); }
        return out.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map((r) => ({ ...r }));
      },
      insert: async (table, list) => {
        calls.push(["insert", list.map((r) => r.id)]);
        for (const r of list) {
          if (!visibleScopes.includes(r.scope)) throw new Error("403");
          if (rows.has(r.id)) throw new Error("409");
          rows.set(r.id, { ...r, deleted_at: null, updated_at: stamp() });
        }
      },
      update: async (table, q, patch) => {
        calls.push(["update", q, Object.keys(patch)]);
        const id = decodeURIComponent(q.replace(/^id=eq\./, ""));
        const r = rows.get(id);
        if (!r || !visible(r)) return;
        if (patch.scope && !visibleScopes.includes(patch.scope)) throw new Error("403");
        rows.set(id, { ...r, ...patch, updated_at: stamp() });
      },
    },
  };
}
function memoryStore() { const m = new Map(); return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v) }; }
function device(server, initial = [], { userId = U, tombstones = [] } = {}) {
  const app = { receipts: initial, tombstones: [...tombstones] };
  const sync = createReceiptsSync({
    transport: server.transport, store: memoryStore(),
    getReceipts: () => app.receipts,
    setReceipts: (list, { removed }) => { app.receipts = list; app.tombstones.push(...removed); },
    scopes: () => ({ groupId: G, userId }),
    isRemoved: (id) => app.tombstones.includes(id),
  });
  return { app, sync };
}

describe("createReceiptsSync", () => {
  it("first sync on a device: reads the table, then sends what the table lacks", async () => {
    const server = fakeServer([G, `u-${U}`]);
    server.rows.set("a", { id: "a", scope: G, data: { id: "a", total: 1 }, deleted_at: null, updated_at: "2026-11-11T00:00:00.000Z" });
    const d = device(server, [{ id: "a", total: 1 }, { id: "new", total: 5 }]);
    const r = await d.sync.sync();
    expect(r).toEqual({ pulled: 1, pushed: 1 });
    expect(server.rows.get("new").data).toEqual({ id: "new", total: 5 });
    // The next sync reads back its own insert once (newer than the last read) and
    // sends nothing; after that, nothing at all.
    expect(await d.sync.sync()).toEqual({ pulled: 1, pushed: 0 });
    expect(await d.sync.sync()).toEqual({ pulled: 0, pushed: 0 });
  });

  it("a change on one phone reaches the other; a deletion too", async () => {
    const server = fakeServer([G, `u-${U}`]);
    const luke = device(server, [{ id: "a", total: 1 }]);
    await luke.sync.sync();
    const wife = device(fakeServerView(server, [G]), []);
    await wife.sync.sync();
    expect(wife.app.receipts).toEqual([{ id: "a", total: 1 }]);
    luke.app.receipts = [{ id: "a", total: 2 }];
    await luke.sync.sync({ pull: false });
    await wife.sync.sync();
    expect(wife.app.receipts).toEqual([{ id: "a", total: 2 }]);
    luke.app.receipts = []; luke.app.tombstones.push("a");
    await luke.sync.sync({ pull: false });
    await wife.sync.sync();
    expect(wife.app.receipts).toEqual([]);
    expect(wife.app.tombstones).toContain("a");
  });

  it("a receipt marked Personal leaves the household: the other person stops seeing it", async () => {
    const server = fakeServer([G, `u-${U}`]);
    const luke = device(server, [{ id: "a", total: 1 }]);
    await luke.sync.sync();
    luke.app.receipts = [{ id: "a", total: 1, view: "personal" }];
    await luke.sync.sync({ pull: false });
    expect(server.rows.get("a").scope).toBe(`u-${U}`);
    const wife = device(fakeServerView(server, [G]), []);
    await wife.sync.sync();
    expect(wife.app.receipts).toEqual([]);
  });

  it("a list that hasn't loaded yet deletes nothing", async () => {
    const server = fakeServer([G, `u-${U}`]);
    const d = device(server, [{ id: "a" }, { id: "b" }]);
    await d.sync.sync();
    d.app.receipts = [];
    await d.sync.sync({ pull: false });
    expect([...server.rows.values()].every((r) => !r.deleted_at)).toBe(true);
  });

  it("another person signing in on the device starts over", async () => {
    const server = fakeServer([G, `u-${U}`, "u-22222222-2222-2222-2222-222222222222"]);
    const store = memoryStore();
    let user = U;
    const app = { receipts: [{ id: "a" }] };
    const sync = createReceiptsSync({ transport: server.transport, store, getReceipts: () => app.receipts, setReceipts: (l) => { app.receipts = l; }, scopes: () => ({ groupId: G, userId: user }) });
    await sync.sync();
    user = "22222222-2222-2222-2222-222222222222";
    server.calls.length = 0;
    await sync.sync();
    expect(server.calls[0][1]).not.toMatch(/updated_at=gt/); // a full read, not "since"
  });
});

// The same rows, seen by someone with fewer scopes (row security).
function fakeServerView(server, scopesSeen) {
  const view = fakeServer(scopesSeen);
  view.rows = server.rows;
  const t = view.transport;
  return { ...view, transport: {
    select: async (table, q) => { const p = new URLSearchParams(q); let out = [...server.rows.values()].filter((r) => scopesSeen.includes(r.scope));
      const since = p.get("updated_at"); if (since) out = out.filter((r) => r.updated_at > since.replace(/^gt\./, ""));
      return out.sort((a, b) => a.updated_at.localeCompare(b.updated_at)).map((r) => ({ ...r })); },
    insert: t.insert, update: t.update,
  } };
}
