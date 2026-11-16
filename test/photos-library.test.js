// photos/library.js and photos/grid.js: the Photos page's data and layout, with a
// fake server and a fake device cache.
import { describe, it, expect } from "vitest";
import { createPhotoLibrary, viewOf, daysLeft, byTakenDesc, PAGE } from "../photos/library.js";
import { layout, visibleRows, columnsFor, monthLabel, durationText } from "../photos/grid.js";

const id = (n) => `e0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

function fakeStore() {
  const meta = new Map(); const items = new Map(); const thumbs = new Map();
  return {
    meta, items, thumbs,
    getMeta: async (s) => meta.get(s) || null,
    setMeta: async (s, m) => { meta.set(s, m); },
    getAll: async (s) => [...(items.get(s) || new Map()).values()],
    putMany: async (s, rows) => { if (!items.has(s)) items.set(s, new Map()); for (const r of rows) items.get(s).set(r.id, r); },
    getThumb: async (i) => thumbs.get(i) || null,
    putThumb: async (i, b) => { thumbs.set(i, b); },
    dropThumb: async (i) => { thumbs.delete(i); },
  };
}

// A server holding rows; answers the library's paged, cursor-filtered reads.
function fakeServer(rows) {
  const calls = [];
  const rest = async (path, opts = {}) => {
    calls.push({ path, ...opts });
    if (opts.method === "PATCH") {
      const m = path.match(/id=eq\.([^&]+)/);
      const r = rows.find((x) => x.id === decodeURIComponent(m[1]));
      Object.assign(r, opts.body, { updated_at: "2026-11-20T00:00:00.000Z" });
      return { data: null };
    }
    const q = new URLSearchParams(path.split("?")[1]);
    let out = rows.filter((r) => `eq.${r.scope}` === q.get("scope"));
    const or = q.get("or");
    if (or) {
      const [, at, , id2] = or.match(/updated_at\.gt\.([^,]+),and\(updated_at\.eq\.([^,]+),id\.gt\.([^)]+)\)/);
      out = out.filter((r) => r.updated_at > at || (r.updated_at === at && r.id > id2));
    }
    out.sort((a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : 1) : (a.updated_at < b.updated_at ? -1 : 1)));
    return { data: out.slice(0, Number(q.get("limit"))) };
  };
  return { rest, calls };
}

const row = (n, extra = {}) => ({ id: id(n), scope: "u-1", kind: "photo", taken_at: `2026-0${1 + (n % 9)}-01T00:00:00.000Z`, favorite: false, has_thumb: true, deleted_at: null, updated_at: "2026-11-16T10:00:00.000Z", ...extra });

describe("pulling changes", () => {
  it("pages through a big library without skipping rows written in one statement", async () => {
    const rows = Array.from({ length: PAGE * 2 + 7 }, (_, i) => row(i + 1)); // all one updated_at
    const { rest, calls } = fakeServer(rows);
    const store = fakeStore();
    const lib = createPhotoLibrary({ rest, presign: async () => [], store });
    const { changed, items } = await lib.open("u-1");
    expect(changed).toBe(rows.length);
    expect(new Set(items.map((r) => r.id)).size).toBe(rows.length);
    expect(calls.length).toBe(3);
  });

  it("shows the device copy first, then asks only for what changed", async () => {
    const rows = [row(1), row(2)];
    const server = fakeServer(rows);
    const store = fakeStore();
    await createPhotoLibrary({ rest: server.rest, presign: async () => [], store }).open("u-1");
    rows.push(row(3, { updated_at: "2026-11-17T00:00:00.000Z" }));
    const again = fakeServer(rows);
    let cached = null;
    const lib = createPhotoLibrary({ rest: again.rest, presign: async () => [], store });
    const { changed } = await lib.open("u-1", { onCached: (items) => { cached = items.length; } });
    expect(cached).toBe(2);
    expect(changed).toBe(1);
    expect(again.calls[0].path).toContain("or=");
  });

  it("keeps libraries apart", async () => {
    const { rest } = fakeServer([row(1), row(2, { scope: "u-2" })]);
    const lib = createPhotoLibrary({ rest, presign: async () => [], store: fakeStore() });
    const { items } = await lib.open("u-1");
    expect(items.map((r) => r.id)).toEqual([id(1)]);
  });

  it("saves a change here and on the device at once", async () => {
    const rows = [row(1)];
    const { rest, calls } = fakeServer(rows);
    const store = fakeStore();
    const lib = createPhotoLibrary({ rest, presign: async () => [], store });
    await lib.open("u-1");
    await lib.update(id(1), { favorite: true });
    expect(lib.get(id(1)).favorite).toBe(true);
    expect((await store.getAll("u-1"))[0].favorite).toBe(true);
    expect(calls.at(-1)).toMatchObject({ method: "PATCH", body: { favorite: true } });
  });
});

describe("thumbnails", () => {
  it("come from the device when kept, otherwise are signed 25 at a time, fetched and kept", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(i + 1));
    const { rest } = fakeServer(rows);
    const store = fakeStore();
    store.thumbs.set(id(1), "cached-blob");
    const signs = [];
    const presign = async (op, items) => { signs.push({ op, n: items.length, tier: items[0].tier }); return items.map((it) => ({ url: `https://r2/${it.fileId}` })); };
    const fetchImpl = async (url) => ({ ok: true, blob: async () => `blob:${url}` });
    const lib = createPhotoLibrary({ rest, presign, store, fetchImpl });
    await lib.open("u-1");
    const got = await lib.thumbs(rows.map((r) => r.id));
    expect(got.size).toBe(30);
    expect(got.get(id(1))).toBe("cached-blob");
    expect(signs).toEqual([{ op: "get", n: 25, tier: "photos" }, { op: "get", n: 4, tier: "photos" }]);
    expect(store.thumbs.get(id(2))).toBe(`blob:https://r2/${id(2)}`);
  });

  it("skips photos with no thumbnail yet and survives a failed download", async () => {
    const { rest } = fakeServer([row(1, { has_thumb: false }), row(2)]);
    const lib = createPhotoLibrary({ rest, presign: async (op, items) => items.map(() => ({ url: "x" })), store: fakeStore(), fetchImpl: async () => ({ ok: false }) });
    await lib.open("u-1");
    expect((await lib.thumbs([id(1), id(2)])).size).toBe(0);
  });
});

describe("what each tab shows", () => {
  const now = Date.parse("2026-11-16T12:00:00Z");
  const items = [
    row(1, { taken_at: "2026-11-01T00:00:00Z" }),
    row(2, { taken_at: "2026-11-10T00:00:00Z", favorite: true }),
    row(3, { taken_at: null }),
    row(4, { deleted_at: "2026-11-10T00:00:00Z" }),
    row(5, { deleted_at: "2026-09-01T00:00:00Z" }), // past 30 days
  ];
  it("All: live photos, newest first, undated last", () => {
    expect(viewOf(items, "all", now).map((p) => p.id)).toEqual([id(2), id(1), id(3)]);
  });
  it("Favourites", () => { expect(viewOf(items, "favorites", now).map((p) => p.id)).toEqual([id(2)]); });
  it("Recently deleted: the last 30 days, with days left", () => {
    expect(viewOf(items, "deleted", now).map((p) => p.id)).toEqual([id(4)]);
    expect(daysLeft("2026-11-10T00:00:00Z", now)).toBe(24);
  });
  it("sorts by date", () => { expect([items[0], items[1]].sort(byTakenDesc)[0].id).toBe(id(2)); });
});

describe("the timeline layout", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  const items = [
    ...Array.from({ length: 5 }, (_, i) => row(i, { taken_at: "2026-11-02T00:00:00Z" })),
    ...Array.from({ length: 3 }, (_, i) => row(10 + i, { taken_at: "2025-06-02T00:00:00Z" })),
  ];
  it("puts a heading over each month and fills rows of square cells", () => {
    const g = layout(items, { width: 360, gap: 2, headH: 44, now });
    expect(g.cols).toBe(4);
    expect(g.rows.map((r) => (r.type === "head" ? r.label : `${r.start}-${r.end}`))).toEqual(["November", "0-4", "4-5", "June 2025", "5-8"]);
    expect(g.cell).toBe(Math.floor((360 - 6) / 4));
    const last = g.rows.at(-1);
    expect(g.height).toBe(last.y + last.h + 2);
  });
  it("Recently deleted has no headings", () => {
    expect(layout(items, { width: 360, grouped: false, now }).rows.every((r) => r.type === "cells")).toBe(true);
  });
  it("finds only the rows near the screen", () => {
    const big = Array.from({ length: 4000 }, (_, i) => row(i, { taken_at: "2026-11-02T00:00:00Z" }));
    const g = layout(big, { width: 360, now });
    const vis = visibleRows(g.rows, 50000, 800, 300);
    expect(vis.length).toBeGreaterThan(5);
    expect(vis.length).toBeLessThan(30);
    expect(vis[0].y + vis[0].h).toBeGreaterThanOrEqual(50000 - 300);
    expect(vis.at(-1).y).toBeLessThanOrEqual(50000 + 800 + 300);
  });
  it("small helpers", () => {
    expect(columnsFor(360)).toBe(4);
    expect(columnsFor(1400)).toBe(8);
    expect(monthLabel(null)).toBe("No date");
    expect(durationText(65)).toBe("1:05");
    expect(durationText(3725)).toBe("1:02:05");
  });
});
