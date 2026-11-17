// The photo-sync Edge Function (supabase/functions/photo-sync/index.ts), run in Node
// against the real migrations in PGlite: its RPC calls go to the database as the
// server role, so the database's own rules decide, exactly as they will live.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife } = USERS;
const ENV = {
  SUPABASE_URL: "https://proj.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
  DOC_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com", DOC_S3_BUCKET: "liv-documents",
  DOC_S3_ACCESS_KEY_ID: "AK", DOC_S3_SECRET_ACCESS_KEY: "SK",
};
const SIGNED_IN = { "Bearer luke.token": luke, "Bearer wife.token": wife };
const RPC_SQL = {
  photo_sync_register: ["select public.photo_sync_register($1::uuid, $2, $3, $4) as r", (a) => [a.p_user, a.p_device_key, a.p_name, a.p_secret_hash], "scalar"],
  photo_sync_device: ["select * from public.photo_sync_device($1::uuid, $2)", (a) => [a.p_device, a.p_secret_hash], "rows"],
  photo_sync_mine: ["select * from public.photo_sync_mine($1::uuid, $2, $3::uuid[])", (a) => [a.p_device, a.p_secret_hash, a.p_ids], "rows"],
  photo_sync_add: ["select * from public.photo_sync_add($1::uuid, $2, $3::jsonb) as photo_sync_add", (a) => [a.p_device, a.p_secret_hash, JSON.stringify(a.p_items)], "column"],
  photo_sync_done: ["select public.photo_sync_done($1::uuid, $2, $3::uuid[], $4::int[]) as r", (a) => [a.p_device, a.p_secret_hash, a.p_ids, a.p_bytes], "scalar"],
};

let db;
let handler;
let env = { ...ENV };
const rpcCalls = [];
const realFetch = globalThis.fetch;
const read = (f) => readFileSync(fileURLToPath(new URL(`../migrations/${f}`, import.meta.url)), "utf8");

beforeAll(async () => {
  db = await createDocumentsDatabase();
  await db.exec(read("2026-11-16-photos.sql"));
  await db.exec(read("2026-11-16b-photo-sync-devices.sql"));
  globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) {
      const id = SIGNED_IN[init.headers.authorization];
      return id ? new Response(JSON.stringify({ id }), { status: 200 }) : new Response("{}", { status: 401 });
    }
    const m = u.match(/\/rest\/v1\/rpc\/(\w+)$/);
    if (m) {
      expect(init.headers.authorization).toBe("Bearer service");
      rpcCalls.push(m[1]);
      const [sql, args, shape] = RPC_SQL[m[1]];
      try {
        await db.exec("reset role; select set_config('request.jwt.claim.sub', '', false); set role service_role;");
        const rows = (await db.query(sql, args(JSON.parse(init.body)))).rows;
        const out = shape === "scalar" ? rows[0]?.r : shape === "column" ? rows.map((r) => r.photo_sync_add) : rows;
        return new Response(JSON.stringify(out), { status: 200 });
      } catch (e) {
        return new Response(JSON.stringify({ code: e.code || "XX000", message: e.message }), { status: 400 });
      } finally { await db.exec("reset role;"); }
    }
    throw new Error(`unexpected fetch ${u}`);
  };
  const out = await build({ entryPoints: [fileURLToPath(new URL("../supabase/functions/photo-sync/index.ts", import.meta.url))], bundle: true, format: "esm", write: false, platform: "neutral", logLevel: "silent" });
  await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}, 60_000);
afterAll(() => { globalThis.fetch = realFetch; delete globalThis.Deno; });

const call = (body, headers = {}) => handler(new Request("https://proj.supabase.co/functions/v1/photo-sync", {
  method: "POST", headers: { "content-type": "application/json", origin: "capacitor://localhost", ...headers }, body: JSON.stringify(body),
}));
const id = (n) => `c0000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const item = (n, extra = {}) => ({ id: id(n), local_id: `L${n}/L0/001`, kind: "photo", taken_at: "2026-11-02T10:00:00Z", bytes: 2500000, thumb_bytes: 30000, ...extra });

let cred;
describe("photo-sync", () => {
  it("registers a device only for a signed-in person and gives its secret once", async () => {
    expect((await call({ op: "register", deviceKey: "dev-a" })).status).toBe(401);
    expect((await call({ op: "register", deviceKey: "dev-a" }, { authorization: "Bearer stolen.token" })).status).toBe(401);
    expect((await call({ op: "register", deviceKey: "bad key!" }, { authorization: "Bearer luke.token" })).status).toBe(400);
    const res = await call({ op: "register", deviceKey: "dev-a", name: "Luke's iPhone" }, { authorization: "Bearer luke.token" });
    expect(res.status).toBe(200);
    const { deviceId, secret } = await res.json();
    expect(deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stored = (await db.query(`select secret_hash, user_id from public.photo_sync_devices where id = $1`, [deviceId])).rows[0];
    expect(stored.user_id).toBe(luke);
    expect(stored.secret_hash).not.toContain(secret);
    cred = { "x-photo-device": `${deviceId}.${secret}` };
  });

  it("adds records into the owner's Personal library and drops fields a device may not set", async () => {
    const res = await call({ op: "add", items: [item(1, { scope: GROUP, added_by: wife, has_thumb: true }), item(2, { kind: "video", duration: 30 })] }, cred);
    expect(res.status).toBe(200);
    expect((await res.json()).ids.sort()).toEqual([id(1), id(2)]);
    const rows = (await db.query(`select id, scope, added_by, has_thumb from public.photo_items where id = any($1) order by id`, [[id(1), id(2)]])).rows;
    expect(rows).toEqual([
      { id: id(1), scope: `u-${luke}`, added_by: luke, has_thumb: false },
      { id: id(2), scope: `u-${luke}`, added_by: luke, has_thumb: false },
    ]);
  });

  it("signs uploads only for this device's photos, at the size given", async () => {
    const ok = await call({ op: "sign", items: [{ id: id(1), size: 31000 }] }, cred);
    expect(ok.status).toBe(200);
    const { urls } = await ok.json();
    expect(urls[0].url).toMatch(new RegExp(`/liv-documents/ph/${id(1)}/thumb\\?`));
    expect(urls[0].url).toContain("X-Amz-SignedHeaders=content-length%3Bhost");
    await asUser(db, wife, `insert into public.photo_items (id, scope) values ($1, $2)`, [id(60), GROUP]);
    expect((await call({ op: "sign", items: [{ id: id(1), size: 1 }, { id: id(60), size: 1 }] }, cred)).status).toBe(403);
    expect((await call({ op: "sign", items: [{ id: id(1), size: 3 * 1024 * 1024 }] }, cred)).status).toBe(400);
  });

  it("marks thumbnails done and reports what it already has", async () => {
    const done = await call({ op: "done", ids: [id(1), id(60)], bytes: [31000, 5] }, cred);
    expect(await done.json()).toEqual({ count: 1 });
    const mine = await (await call({ op: "mine", ids: [id(1), id(2), id(60)] }, cred)).json();
    expect(mine.items.sort((a, b) => a.id.localeCompare(b.id))).toEqual([{ id: id(1), has_thumb: true }, { id: id(2), has_thumb: false }]);
    expect((await db.query(`select has_thumb from public.photo_items where id = $1`, [id(60)])).rows[0].has_thumb).toBe(false);
  });

  it("refuses a wrong or revoked key, and junk", async () => {
    const [deviceId] = cred["x-photo-device"].split(".");
    const wrong = { "x-photo-device": `${deviceId}.${"A".repeat(43)}` };
    for (const body of [{ op: "mine", ids: [id(1)] }, { op: "add", items: [item(3)] }, { op: "sign", items: [{ id: id(1), size: 5 }] }, { op: "done", ids: [id(1)], bytes: [1] }]) {
      expect((await call(body, wrong)).status).toBe(401);
      expect((await call(body, {})).status).toBe(401);
    }
    for (const body of [{ op: "nope" }, { op: "add", items: [] }, { op: "add", items: [{ id: "x" }] }, { op: "add", items: [item(4, { local_id: "" })] }, { op: "mine", ids: [] }, { op: "done", ids: [id(1)], bytes: [1, 2] }]) {
      expect((await call(body, cred)).status).toBe(400);
    }
    await asUser(db, luke, `update public.photo_sync_devices set revoked_at = now() where id = $1`, [deviceId]);
    expect((await call({ op: "mine", ids: [id(1)] }, cred)).status).toBe(401);
    expect((await call({ op: "add", items: [item(5)] }, cred)).status).toBe(401);
    expect((await call({ op: "sign", items: [{ id: id(1), size: 5 }] }, cred)).status).toBe(401);
  });

  it("is off when switched off", async () => {
    env = { ...ENV, PHOTO_SYNC_DISABLED: "1" };
    expect((await call({ op: "mine", ids: [id(1)] }, cred)).status).toBe(503);
    env = { ...ENV };
  });

  it("its URL signer is the same file as doc-storage's", () => {
    const a = readFileSync(fileURLToPath(new URL("../supabase/functions/photo-sync/s3-presign.js", import.meta.url)), "utf8");
    const b = readFileSync(fileURLToPath(new URL("../supabase/functions/doc-storage/s3-presign.js", import.meta.url)), "utf8");
    expect(a).toBe(b);
  });
});
