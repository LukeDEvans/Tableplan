// photos/sync.js — the first sync from an iPhone's library into Liv (PHOTOS_DESIGN.md
// §12 step 2). For each photo: a record in photo_items, where its original is in
// photo_sources, and a small thumbnail in R2 at 'ph/<photo id>/thumb'. No original
// leaves the phone.
//
// Safe to stop and run again at any point:
//  • a photo's record id is derived from (this install's device key, the phone's id
//    for the photo), so the same photo is always the same row, and inserts ignore
//    rows that are already there;
//  • a batch first asks which of its photos already have a thumbnail and skips them;
//  • the "listed up to" time is saved only after a run finishes, so an interrupted
//    run lists again from the same point next time.
//
// Dependencies are injected (the app passes the real ones; tests pass fakes):
//   plugin   — the PhotoLibrary plugin: deviceKey(), list(), thumbs()
//   rest     — (path, { method, body, prefer }) → { data, headers } against PostgREST
//   presign  — documents/storage.js edgePresigner: (op, items) → [{ url, headers }]
//   fetchImpl — for the uploads to the signed URLs
//   getSince / setSince — the saved "listed up to" time (ms), per device

export const BATCH = 50;
export const LIST_PAGE = 500;
export const PRESIGN_BATCH = 25;
const SINCE_MARGIN_MS = 60 * 1000;

const HEX = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// A UUID (version 8, RFC 9562 "custom") from sha256 of the photo's identity.
export async function photoIdFor(deviceKey, localId) {
  const data = new TextEncoder().encode(`live-photo|iphone|${deviceKey}|${localId}`);
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x80;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = HEX(h);
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const num = (v, lo, hi) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v, lo, hi) => { const n = num(v, lo, hi); return n === null ? null : Math.round(n); };
const iso = (v) => { const d = new Date(v); return typeof v === "string" && !Number.isNaN(d.getTime()) ? d.toISOString() : null; };

// One record from what the phone listed. Only what the table's checks accept goes in.
export function rowFor(item, { id, scope, thumbBytes = 0 }) {
  const burst = typeof item.burst === "string" && item.burst.length <= 100 ? item.burst : null;
  return {
    id,
    scope,
    kind: item.kind === "video" ? "video" : "photo",
    is_screenshot: item.screenshot === true,
    is_live: item.live === true,
    burst_id: burst,
    taken_at: iso(item.taken),
    width: int(item.width, 0, 100000),
    height: int(item.height, 0, 100000),
    duration: item.kind === "video" ? num(item.duration, 0, 86400) : null,
    bytes: int(item.bytes, 0, 50_000_000_000),
    lat: num(item.lat, -90, 90),
    lng: num(item.lng, -180, 180),
    favorite: item.favorite === true,
    has_thumb: false,
    thumb_bytes: int(thumbBytes, 0, 2_000_000) || 0,
  };
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const inList = (ids) => `in.(${ids.join(",")})`;
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function createPhotoSync({ plugin, rest, presign, fetchImpl = (...a) => globalThis.fetch(...a), scope, getSince, setSince, now = () => Date.now(), onProgress = () => {} }) {
  if (!/^u-[0-9a-f-]{36}$/.test(scope || "")) throw new Error("photos: sync only into a Personal library");

  async function listAll(since, signal) {
    const items = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      if (signal?.aborted) return null;
      const page = await plugin.list({ offset, limit: LIST_PAGE, ...(since ? { since } : {}) });
      const got = Array.isArray(page?.items) ? page.items : [];
      items.push(...got);
      onProgress({ phase: "listing", done: items.length, total: Number(page?.total) || items.length });
      if (got.length < LIST_PAGE || items.length >= (Number(page?.total) || 0)) break;
    }
    const seen = new Set();
    return items.filter((it) => typeof it?.id === "string" && it.id && !seen.has(it.id) && seen.add(it.id));
  }

  async function uploadThumbs(entries) {
    const done = [];
    for (const group of chunks(entries, PRESIGN_BATCH)) {
      const signed = await presign("put", group.map((e) => ({ tier: "photos", fileId: e.id, part: "thumb", size: e.bytes.length })));
      const results = await Promise.all(group.map(async (e, i) => {
        try {
          const res = await fetchImpl(signed[i].url, { method: "PUT", headers: signed[i].headers || {}, body: e.bytes });
          return res.ok ? e.id : null;
        } catch { return null; }
      }));
      done.push(...results.filter(Boolean));
    }
    return done;
  }

  async function run({ signal } = {}) {
    const started = now();
    const { key: deviceKey } = await plugin.deviceKey();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(deviceKey || "")) throw new Error("photos: no device key");
    const since = getSince(deviceKey);
    const listed = await listAll(since ? since - SINCE_MARGIN_MS : null, signal);
    const stats = { listed: listed?.length || 0, added: 0, skipped: 0, thumbsFailed: 0, stopped: false };
    if (!listed) return { ...stats, stopped: true };

    // Newest first, so the photos you know best show up first.
    listed.sort((a, b) => String(b.taken || "").localeCompare(String(a.taken || "")));
    let processed = 0;
    for (const batch of chunks(listed, BATCH)) {
      if (signal?.aborted) return { ...stats, stopped: true };
      const ids = await Promise.all(batch.map((it) => photoIdFor(deviceKey, it.id)));
      const have = await rest(`photo_items?select=id&has_thumb=is.true&id=${inList(ids)}`);
      const done = new Set((have.data || []).map((r) => r.id));
      const todo = batch.map((it, i) => ({ it, id: ids[i] })).filter((t) => !done.has(t.id));
      stats.skipped += batch.length - todo.length;

      if (todo.length) {
        const shot = await plugin.thumbs({ ids: todo.map((t) => t.it.id) });
        const byLocal = new Map((shot?.items || []).filter((x) => x && typeof x.b64 === "string" && x.b64).map((x) => [x.id, b64ToBytes(x.b64)]));
        const entries = todo.map((t) => ({ ...t, bytes: byLocal.get(t.it.id) || null }));
        await rest("photo_items?on_conflict=id", {
          method: "POST",
          prefer: "resolution=ignore-duplicates,return=minimal",
          body: entries.map((e) => rowFor(e.it, { id: e.id, scope, thumbBytes: e.bytes?.length || 0 })),
        });
        await rest("photo_sources?on_conflict=kind,device_key,local_id", {
          method: "POST",
          prefer: "resolution=ignore-duplicates,return=minimal",
          body: entries.map((e) => ({ photo_id: e.id, kind: "iphone", device_key: deviceKey, local_id: e.it.id })),
        });
        const withThumb = entries.filter((e) => e.bytes && e.bytes.length);
        const uploaded = withThumb.length ? await uploadThumbs(withThumb) : [];
        if (uploaded.length) {
          await rest(`photo_items?id=${inList(uploaded)}`, { method: "PATCH", prefer: "return=minimal", body: { has_thumb: true } });
        }
        stats.added += todo.length;
        stats.thumbsFailed += todo.length - uploaded.length;
      }
      processed += batch.length;
      onProgress({ phase: "syncing", done: processed, total: listed.length, added: stats.added });
    }
    if (!stats.thumbsFailed) setSince(deviceKey, started);
    return stats;
  }

  return { run };
}

// What's in Personal so far: how many, thumbnail storage, and the newest few with
// short-lived links to their thumbnails.
export async function photosSummary({ rest, presign, scope, recent = 12 }) {
  const head = await rest(`photo_items?select=id&scope=eq.${scope}&deleted_at=is.null`, { method: "HEAD", prefer: "count=exact" });
  const range = head.headers?.get?.("content-range") || "";
  const count = Number(range.split("/")[1]) || 0;
  const usage = await rest("rpc/photo_usage", { method: "POST", body: { p_scope: scope } });
  const rows = (await rest(`photo_items?select=id,kind,duration&scope=eq.${scope}&has_thumb=is.true&deleted_at=is.null&order=taken_at.desc.nullslast&limit=${recent}`)).data || [];
  let urls = [];
  if (rows.length) urls = await presign("get", rows.map((r) => ({ tier: "photos", fileId: r.id, part: "thumb" })));
  return { count, thumbBytes: Number(usage.data) || 0, recent: rows.map((r, i) => ({ ...r, url: urls[i]?.url || "" })) };
}
