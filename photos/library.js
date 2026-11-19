// photos/library.js — the Photos page's data (PHOTOS_DESIGN.md §7, step 3).
//
// Keeps a copy of one library's records on the device and asks the server only for
// what changed since last time (by updated_at, with the id as a tie-break so a batch
// written in one statement is never half-skipped). A library of 17,000 photos costs
// ~3 MB once per device; after that a visit costs a few hundred bytes.
//
// Thumbnails are cached on the device too: a thumbnail is fetched from storage once
// (through a short-lived signed link) and then read locally.
//
// Dependencies are injected so tests can run it without a network or IndexedDB:
//   rest(path, { method, body, prefer }) → { data, headers }   (PostgREST, signed in)
//   presign(op, items) → [{ url }]                              (doc-storage, photos tier)
//   store — { getMeta, setMeta, getAll, putMany, getThumb, putThumb, dropThumb } (photos/cache.js)
//   fetchImpl — for thumbnail downloads

export const PAGE = 1000;
export const SIGN_BATCH = 25;
export const COLUMNS = "id,kind,is_screenshot,is_live,taken_at,width,height,duration,favorite,has_thumb,deleted_at,updated_at";
export const RECENTLY_DELETED_DAYS = 30;

// Records newest first; photos with no date go last.
export function byTakenDesc(a, b) {
  const x = a.taken_at || "";
  const y = b.taken_at || "";
  if (x === y) return a.id < b.id ? 1 : -1;
  if (!x) return 1;
  if (!y) return -1;
  return x < y ? 1 : -1;
}

// What each tab shows.
export function viewOf(items, tab, now = Date.now()) {
  const cutoff = now - RECENTLY_DELETED_DAYS * 24 * 3600 * 1000;
  if (tab === "deleted") {
    return items.filter((p) => p.deleted_at && Date.parse(p.deleted_at) >= cutoff)
      .sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
  }
  const live = items.filter((p) => !p.deleted_at);
  return (tab === "favorites" ? live.filter((p) => p.favorite) : live).sort(byTakenDesc);
}

// Days left before a deleted photo is removed for good.
export function daysLeft(deletedAt, now = Date.now()) {
  const left = RECENTLY_DELETED_DAYS - Math.floor((now - Date.parse(deletedAt)) / (24 * 3600 * 1000));
  return Math.max(0, left);
}

const enc = encodeURIComponent;

export function createPhotoLibrary({ rest, presign, store, fetchImpl = (...a) => globalThis.fetch(...a), now = () => Date.now() }) {
  let scope = null;
  let byId = new Map();

  // Everything changed after the saved cursor, page by page.
  async function pull(signal) {
    const meta = (await store.getMeta(scope)) || {};
    let cursor = meta.cursor || null; // { at, id }
    let changed = 0;
    for (;;) {
      if (signal?.aborted) break;
      const after = cursor ? `&or=${enc(`(updated_at.gt.${cursor.at},and(updated_at.eq.${cursor.at},id.gt.${cursor.id}))`)}` : "";
      const { data } = await rest(`photo_items?select=${COLUMNS}&scope=eq.${enc(scope)}${after}&order=updated_at.asc,id.asc&limit=${PAGE}`);
      const rows = Array.isArray(data) ? data : [];
      if (rows.length) {
        await store.putMany(scope, rows);
        for (const r of rows) byId.set(r.id, r);
        changed += rows.length;
        const last = rows[rows.length - 1];
        cursor = { at: last.updated_at, id: last.id };
        await store.setMeta(scope, { ...meta, cursor, at: now() });
      }
      if (rows.length < PAGE) break;
    }
    return changed;
  }

  return {
    // Shows what's on the device at once (onCached), then what changed.
    async open(nextScope, { onCached, signal } = {}) {
      scope = nextScope;
      byId = new Map((await store.getAll(scope)).map((r) => [r.id, r]));
      onCached?.(this.items());
      const changed = await pull(signal);
      return { changed, items: this.items() };
    },
    refresh: (signal) => pull(signal),
    items: () => [...byId.values()],
    get: (id) => byId.get(id) || null,

    // A change made here, shown at once and saved; the server's copy comes back on
    // the next pull with its new updated_at.
    async update(id, patch) {
      const cur = byId.get(id);
      if (!cur) return null;
      await rest(`photo_items?id=eq.${enc(id)}`, { method: "PATCH", prefer: "return=minimal", body: patch });
      const next = { ...cur, ...patch };
      byId.set(id, next);
      await store.putMany(scope, [next]);
      return next;
    },

    // The phone's own id for a photo, if this phone holds it (photo_sources).
    async localIdFor(id, deviceKey) {
      if (!deviceKey) return null;
      const { data } = await rest(`photo_sources?select=local_id,missing_at&photo_id=eq.${enc(id)}&kind=eq.iphone&device_key=eq.${enc(deviceKey)}&limit=1`);
      const row = Array.isArray(data) ? data[0] : null;
      return row && !row.missing_at ? row.local_id : null;
    },

    // Photos deleted in Liv elsewhere (the laptop) whose original is still on this
    // phone: they're removed from the phone the next time Liv's Photos opens here.
    async pendingPhoneDeletes(deviceKey) {
      if (!deviceKey) return [];
      const { data } = await rest(`photo_sources?select=photo_id,local_id,photo_items!inner(deleted_at,scope)&kind=eq.iphone&device_key=eq.${enc(deviceKey)}&missing_at=is.null&photo_items.deleted_at=not.is.null&photo_items.scope=eq.${enc(scope)}&limit=100`);
      return (Array.isArray(data) ? data : []).map((r) => ({ id: r.photo_id, localId: r.local_id }));
    },

    async markMissing(ids, deviceKey) {
      if (!ids.length) return;
      await rest(`photo_sources?photo_id=in.(${ids.map(enc).join(",")})&kind=eq.iphone&device_key=eq.${enc(deviceKey)}`, { method: "PATCH", prefer: "return=minimal", body: { missing_at: new Date(now()).toISOString() } });
    },

    // Thumbnails: from the device if there, otherwise signed and fetched (25 per
    // signing call), then kept. Returns Map id → Blob for those it could get.
    async thumbs(ids) {
      const out = new Map();
      const need = [];
      for (const id of ids) {
        const blob = await store.getThumb(id);
        if (blob) out.set(id, blob); else if (byId.get(id)?.has_thumb) need.push(id);
      }
      for (let i = 0; i < need.length; i += SIGN_BATCH) {
        const group = need.slice(i, i + SIGN_BATCH);
        let urls = [];
        try { urls = await presign("get", group.map((id) => ({ tier: "photos", fileId: id, part: "thumb" }))); } catch { continue; }
        await Promise.all(group.map(async (id, n) => {
          try {
            const res = await fetchImpl(urls[n]?.url, { method: "GET" });
            if (!res.ok) return;
            const blob = await res.blob();
            await store.putThumb(id, blob);
            out.set(id, blob);
          } catch { /* shown blank; tried again next time */ }
        }));
      }
      return out;
    },
    dropThumb: (id) => store.dropThumb(id),
  };
}
