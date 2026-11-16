import { describe, it, expect } from "vitest";
import { createPhotoSync, photoIdFor, rowFor, photosSummary, b64ToBytes } from "../photos/sync.js";

const SCOPE = "u-11111111-2222-3333-4444-555555555555";

function fakePhone(n, { failThumb = new Set(), key = "dev-abc" } = {}) {
  const items = Array.from({ length: n }, (_, i) => ({
    id: `L${i}/L0/001`, kind: i % 10 === 0 ? "video" : "photo", screenshot: i % 7 === 0, live: i % 2 === 0,
    taken: new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString(), width: 4032, height: 3024,
    duration: i % 10 === 0 ? 12.5 : undefined, bytes: 3_000_000 + i, lat: 44.9, lng: -93.2, favorite: i === 3,
  }));
  const calls = { list: 0, thumbs: [] };
  return {
    items, calls,
    deviceKey: async () => ({ key }),
    list: async ({ offset, limit }) => { calls.list += 1; return { total: items.length, items: items.slice(offset, offset + limit) }; },
    thumbs: async ({ ids }) => {
      calls.thumbs.push(ids.length);
      return { items: ids.map((id) => (failThumb.has(id) ? { id, error: "unreadable" } : { id, b64: btoa(`jpeg:${id}`), width: 400, height: 300 })) };
    },
  };
}

// Just enough PostgREST for the calls sync.js makes.
function fakeDb() {
  const items = new Map();
  const sources = new Map();
  const ids = (path) => (path.match(/id=in\.\(([^)]*)\)/)?.[1] || "").split(",").filter(Boolean);
  const rest = async (path, { method = "GET", body, prefer = "" } = {}) => {
    if (method === "GET" && path.startsWith("photo_items?select=id&has_thumb=is.true")) {
      return { data: ids(path).filter((id) => items.get(id)?.has_thumb).map((id) => ({ id })) };
    }
    if (method === "POST" && path === "photo_items?on_conflict=id") {
      expect(prefer).toContain("ignore-duplicates");
      for (const r of body) if (!items.has(r.id)) items.set(r.id, { ...r });
      return { data: null };
    }
    if (method === "POST" && path.startsWith("photo_sources?on_conflict=kind,device_key,local_id")) {
      for (const r of body) { const k = `${r.kind}|${r.device_key}|${r.local_id}`; if (!sources.has(k)) sources.set(k, r); }
      return { data: null };
    }
    if (method === "PATCH" && path.startsWith("photo_items?id=in.")) {
      for (const id of ids(path)) Object.assign(items.get(id), body);
      return { data: null };
    }
    if (method === "HEAD") {
      const n = [...items.values()].filter((r) => r.scope === SCOPE).length;
      return { data: null, headers: new Map([["content-range", `0-0/${n}`]]) };
    }
    if (method === "POST" && path === "rpc/photo_usage") {
      return { data: [...items.values()].filter((r) => r.has_thumb).reduce((s, r) => s + r.thumb_bytes, 0) };
    }
    if (method === "GET" && path.startsWith("photo_items?select=id,kind,duration")) {
      const limit = Number(path.match(/limit=(\d+)/)[1]);
      return { data: [...items.values()].filter((r) => r.has_thumb).sort((a, b) => b.taken_at.localeCompare(a.taken_at)).slice(0, limit).map(({ id, kind, duration }) => ({ id, kind, duration })) };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  return { items, sources, rest };
}

function fakeStore({ failPut = () => false } = {}) {
  const objects = new Map();
  const presigns = [];
  const presign = async (op, list) => {
    presigns.push(list.length);
    expect(list.length).toBeLessThanOrEqual(25);
    return list.map((it) => { expect(it.tier).toBe("photos"); return { url: `mem://${op}/ph/${it.fileId}/thumb`, headers: {} }; });
  };
  const fetchImpl = async (url, init) => {
    const key = url.replace(/^mem:\/\/put\//, "");
    if (failPut(key)) return { ok: false, status: 500 };
    objects.set(key, init.body);
    return { ok: true, status: 200 };
  };
  return { objects, presigns, presign, fetchImpl };
}

function setup(phone, db, store, extra = {}) {
  const since = new Map();
  const progress = [];
  const sync = createPhotoSync({
    plugin: phone, rest: db.rest, presign: store.presign, fetchImpl: store.fetchImpl, scope: SCOPE,
    getSince: (k) => since.get(k) || null, setSince: (k, v) => since.set(k, v), now: () => 1_800_000_000_000,
    onProgress: (p) => progress.push(p), ...extra,
  });
  return { sync, since, progress };
}

describe("photo ids", () => {
  it("the same photo on the same phone is always the same id; another phone gives another", async () => {
    const a = await photoIdFor("dev-abc", "L1/L0/001");
    expect(a).toBe(await photoIdFor("dev-abc", "L1/L0/001"));
    expect(a).not.toBe(await photoIdFor("dev-xyz", "L1/L0/001"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("rows", () => {
  it("keep what the table accepts and drop the rest", () => {
    const r = rowFor({ kind: "video", duration: 90000, lat: 200, lng: -93, burst: "x".repeat(101), taken: "not a date", width: -1, bytes: 1e12, screenshot: "yes", favorite: true }, { id: "i", scope: SCOPE, thumbBytes: 5e6 });
    expect(r).toMatchObject({ kind: "video", duration: null, lat: null, lng: -93, burst_id: null, taken_at: null, width: null, bytes: null, is_screenshot: false, favorite: true, has_thumb: false, thumb_bytes: 0 });
    expect(rowFor({ kind: "photo", duration: 5 }, { id: "i", scope: SCOPE }).duration).toBeNull();
  });
  it("decode base64 thumbnails", () => {
    expect(Array.from(b64ToBytes(btoa("abc")))).toEqual([97, 98, 99]);
  });
});

describe("the first sync", () => {
  it("adds every photo once, newest first, with its source and a thumbnail at ph/<id>/thumb", async () => {
    const phone = fakePhone(120);
    const db = fakeDb();
    const store = fakeStore();
    const { sync, since, progress } = setup(phone, db, store);
    const stats = await sync.run();
    expect(stats).toEqual({ listed: 120, added: 120, skipped: 0, thumbsFailed: 0, stopped: false });
    expect(db.items.size).toBe(120);
    expect(db.sources.size).toBe(120);
    expect([...db.items.values()].every((r) => r.has_thumb && r.scope === SCOPE && r.thumb_bytes > 0)).toBe(true);
    expect(store.objects.size).toBe(120);
    const newest = await photoIdFor("dev-abc", "L119/L0/001");
    expect([...store.objects.keys()][0]).toBe(`ph/${newest}/thumb`);
    expect(phone.calls.thumbs).toEqual([50, 50, 20]);
    expect(since.get("dev-abc")).toBe(1_800_000_000_000);
    expect(progress.at(-1)).toEqual({ phase: "syncing", done: 120, total: 120, added: 120 });
    const video = db.items.get(await photoIdFor("dev-abc", "L10/L0/001"));
    expect(video).toMatchObject({ kind: "video", duration: 12.5, is_screenshot: false });
  });

  it("running again changes nothing and uploads nothing", async () => {
    const phone = fakePhone(120);
    const db = fakeDb();
    const store = fakeStore();
    const { sync } = setup(phone, db, store);
    await sync.run();
    const uploads = store.objects.size;
    phone.calls.thumbs.length = 0;
    const again = await sync.run();
    expect(again).toMatchObject({ added: 0, skipped: 120 });
    expect(phone.calls.thumbs).toEqual([]);
    expect(store.objects.size).toBe(uploads);
    expect(db.items.size).toBe(120);
  });

  it("stopped part way, it saves no 'listed up to' time and finishes cleanly next time", async () => {
    const phone = fakePhone(120);
    const db = fakeDb();
    const store = fakeStore();
    const controller = new AbortController();
    const { sync, since } = setup(phone, db, store, { onProgress: (p) => { if (p.phase === "syncing" && p.done === 50) controller.abort(); } });
    const first = await sync.run({ signal: controller.signal });
    expect(first.stopped).toBe(true);
    expect(db.items.size).toBe(50);
    expect(since.size).toBe(0);
    phone.calls.thumbs.length = 0;
    const second = await sync.run();
    expect(second).toMatchObject({ added: 70, skipped: 50, stopped: false });
    expect(phone.calls.thumbs).toEqual([50, 20]);
    expect(db.items.size).toBe(120);
  });

  it("a thumbnail the phone can't make, or an upload that fails, is retried next time", async () => {
    const phone = fakePhone(10, { failThumb: new Set(["L4/L0/001"]) });
    const db = fakeDb();
    let failing = true;
    const badUpload = await photoIdFor("dev-abc", "L7/L0/001");
    const store = fakeStore({ failPut: (key) => failing && key === `ph/${badUpload}/thumb` });
    const { sync, since } = setup(phone, db, store);
    const first = await sync.run();
    expect(first.thumbsFailed).toBe(2);
    expect(db.items.size).toBe(10);
    expect([...db.items.values()].filter((r) => !r.has_thumb)).toHaveLength(2);
    expect(since.size).toBe(0);
    phone.calls.thumbs.length = 0;
    failing = false;
    phone.thumbs = async ({ ids }) => { phone.calls.thumbs.push(ids.length); return { items: ids.map((id) => ({ id, b64: btoa(id) })) }; };
    const second = await sync.run();
    expect(second).toMatchObject({ added: 2, skipped: 8, thumbsFailed: 0 });
    expect(phone.calls.thumbs).toEqual([2]);
    expect([...db.items.values()].every((r) => r.has_thumb)).toBe(true);
    expect(db.items.size).toBe(10);
  });

  it("only syncs into a Personal library", () => {
    expect(() => createPhotoSync({ plugin: {}, rest: () => {}, presign: () => {}, scope: "7aa1feaf-4c11-4b20-a1b4-234082e90c97", getSince: () => null, setSince: () => {} })).toThrow(/Personal/);
  });
});

describe("summary", () => {
  it("counts the library, sums thumbnail storage and links the newest thumbnails", async () => {
    const phone = fakePhone(30);
    const db = fakeDb();
    const store = fakeStore();
    await setup(phone, db, store).sync.run();
    const s = await photosSummary({ rest: db.rest, presign: store.presign, scope: SCOPE, recent: 4 });
    expect(s.count).toBe(30);
    expect(s.thumbBytes).toBeGreaterThan(0);
    expect(s.recent).toHaveLength(4);
    expect(s.recent[0].url).toBe(`mem://get/ph/${await photoIdFor("dev-abc", "L29/L0/001")}/thumb`);
  });
});

describe("uploads on the iPhone", () => {
  it("go through the web view's own fetch (CapacitorWebFetch), never Capacitor's native HTTP, which mangles bytes", async () => {
    const phone = fakePhone(3);
    const db = fakeDb();
    const store = fakeStore();
    const seen = [];
    globalThis.CapacitorWebFetch = async (url, init) => { seen.push(init.body instanceof Uint8Array); return store.fetchImpl(url, init); };
    try {
      const { createPhotoSync: create } = await import("../photos/sync.js");
      const sync = create({ plugin: phone, rest: db.rest, presign: store.presign, scope: SCOPE, getSince: () => null, setSince: () => {} });
      const stats = await sync.run();
      expect(stats.thumbsFailed).toBe(0);
      expect(seen).toEqual([true, true, true]);
      expect(store.objects.size).toBe(3);
    } finally { delete globalThis.CapacitorWebFetch; }
  });

  it("say what went wrong: a failed upload's status, and the step a sync stopped at", async () => {
    const phone = fakePhone(2);
    const db = fakeDb();
    const store = fakeStore({ failPut: () => true });
    const stats = await setup(phone, db, store).sync.run();
    expect(stats).toMatchObject({ thumbsFailed: 2, uploadError: "HTTP 500" });
    const broken = fakePhone(2);
    broken.thumbs = async () => { throw new Error("boom"); };
    const err = await setup(broken, fakeDb(), fakeStore()).sync.run().catch((e) => e);
    expect(err.step).toBe("making thumbnails");
  });
});
