import { describe, it, expect, vi } from "vitest";
import { createFinanceTxnStore, buildSyncQuery } from "../finance-txn-store.js";
import { createMemoryStorage } from "../content-store/storage.js";

// A fake PostgREST that honors the keyset `or=(updated_at.gt.U,and(updated_at.eq.U,id.gt."I"))`
// + order=updated_at.asc,id.asc + limit, over an in-memory table.
function fakeServer(table) {
  const calls = [];
  async function fetchJson(query) {
    calls.push(query);
    const params = new URLSearchParams(query.split("?")[1]);
    const limit = Number(params.get("limit"));
    let out = [...table].sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : a.updated_at < b.updated_at ? -1 : 1));
    const or = params.get("or");
    if (or) {
      const m = or.match(/updated_at\.gt\."([^"]+)",and\(updated_at\.eq\."[^"]+",id\.gt\."(.*)"\)\)$/);
      const [u, id] = [m[1], m[2]];
      out = out.filter((r) => r.updated_at > u || (r.updated_at === u && r.id > id));
    }
    return out.slice(0, limit);
  }
  return { fetchJson, calls };
}

const row = (id, updated_at, o = {}) => ({ id, updated_at, account_id: "A", amount: -1, status: "active", ...o });

describe("buildSyncQuery", () => {
  it("first page has no cursor; later pages use the (updated_at,id) keyset", () => {
    expect(buildSyncQuery("g1", null)).not.toContain("or=");
    const q = buildSyncQuery("g1", { updatedAt: "2026-09-26T00:00:00Z", id: "t9" });
    expect(q).toContain("order=updated_at.asc,id.asc");
    expect(decodeURIComponent(q)).toContain('or=(updated_at.gt."2026-09-26T00:00:00Z",and(updated_at.eq."2026-09-26T00:00:00Z",id.gt."t9"))');
  });
});

describe("createFinanceTxnStore", () => {
  it("a bulk insert with 2,500 IDENTICAL updated_at values pages through every row exactly once", async () => {
    const table = Array.from({ length: 2500 }, (_, i) => row(`t${String(i).padStart(4, "0")}`, "2026-09-26T00:00:00Z"));
    const srv = fakeServer(table);
    const store = createFinanceTxnStore({ storage: createMemoryStorage(), fetchJson: srv.fetchJson, groupId: "g1" });
    const { changed, rows } = await store.sync();
    expect(changed).toBe(2500);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
    expect(srv.calls).toHaveLength(3); // 1000 + 1000 + 500 (short page ends it)
  });

  it("second sync fetches only changes; a soft delete arrives as a status change", async () => {
    const table = [row("a", "2026-09-01"), row("b", "2026-09-02")];
    const srv = fakeServer(table);
    const store = createFinanceTxnStore({ storage: createMemoryStorage(), fetchJson: srv.fetchJson, groupId: "g1" });
    await store.sync();
    table[0] = row("a", "2026-09-05", { status: "deleted" });
    const { changed, rows } = await store.sync();
    expect(changed).toBe(1);
    expect(rows.find((r) => r.id === "a").status).toBe("deleted");
    expect(rows).toHaveLength(2);
  });

  it("mirror survives a reload (boot/offline) without any network read", async () => {
    const storage = createMemoryStorage();
    const srv = fakeServer([row("a", "2026-09-01")]);
    await createFinanceTxnStore({ storage, fetchJson: srv.fetchJson, groupId: "g1" }).sync();
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const reopened = createFinanceTxnStore({ storage, fetchJson: offline, groupId: "g1" });
    expect(reopened.rows()).toBe(null);           // not ready before load
    expect((await reopened.load()).map((r) => r.id)).toEqual(["a"]);
    expect(offline).not.toHaveBeenCalled();
    await expect(reopened.sync()).rejects.toThrow("offline"); // sync failure is surfaced, mirror intact
    expect(reopened.rows().map((r) => r.id)).toEqual(["a"]);
  });

  it("concurrent sync() calls share one in-flight request (no double-fetch storm)", async () => {
    const srv = fakeServer([row("a", "2026-09-01")]);
    const store = createFinanceTxnStore({ storage: createMemoryStorage(), fetchJson: srv.fetchJson, groupId: "g1" });
    await Promise.all([store.sync(), store.sync(), store.sync()]);
    expect(srv.calls).toHaveLength(1);
  });

  it("mirror is per group (an account/group switch never reads another group's rows)", async () => {
    const storage = createMemoryStorage();
    await createFinanceTxnStore({ storage, fetchJson: fakeServer([row("a", "2026-09-01")]).fetchJson, groupId: "g1" }).sync();
    const other = createFinanceTxnStore({ storage, fetchJson: fakeServer([]).fetchJson, groupId: "g2" });
    expect(await other.load()).toEqual([]);
  });

  it("stops at the hard page bound even if the server misbehaves", async () => {
    let n = 0;
    const endless = async () => Array.from({ length: 1000 }, () => row(`x${n++}`, `2026-09-${String(n).padStart(8, "0")}`));
    const store = createFinanceTxnStore({ storage: createMemoryStorage(), fetchJson: endless, groupId: "g1" });
    const { changed } = await store.sync();
    expect(changed).toBe(50 * 1000);
  });
});
