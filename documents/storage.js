// The storage adapter (DOCUMENTS_DESIGN.md §5.1). Documents' encrypted blobs go
// straight between the device and the object store with short-lived URLs; this
// module only asks for those URLs and moves the bytes. Where the store is (R2 today,
// a home server later) is the presigner's business, so moving stores changes nothing
// here.
//
// presign(op, items) → [{ url, headers }] in the same order, where op is
// "put" | "get" | "delete" and items are { scope, fileId, part, size?, tier? }.
// tier "everyday": everyday documents (§25), kept under "p/" and not encrypted on the
// device; anything else is the Safe's encrypted blobs.
// In the app, presign is a call to the doc-storage function; in tests, the memory
// store below.
//
// Every Safe blob is already encrypted (documents/crypto) before it gets here.

const PARTS = new Set(["content", "thumb", "text"]);
const EVERYDAY_PARTS = new Set(["content", "thumb"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_PART_BYTES = 70 * 1024 * 1024;
export const MAX_BATCH = 25;

export function objectKey({ scope, fileId, part, tier }) {
  if (!SCOPE_RE.test(scope || "")) throw new Error("storage: bad scope");
  if (!UUID_RE.test(fileId || "")) throw new Error("storage: bad file id");
  if (!(tier === "everyday" ? EVERYDAY_PARTS : PARTS).has(part)) throw new Error("storage: bad part");
  return `${tier === "everyday" ? "p/" : ""}${scope}/${fileId.toLowerCase()}/${part}`;
}

export class StorageError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function createDocumentsStorage({ presign, fetchImpl = (...a) => globalThis.fetch(...a), tier = null }) {
  const withTier = (it) => (tier ? { ...it, tier } : it);
  async function urls(op, items) {
    items = items.map(withTier);
    items.forEach(objectKey);
    if (items.length > MAX_BATCH) throw new StorageError("TOO_MANY", "Too many parts in one request.");
    const out = await presign(op, items);
    if (!Array.isArray(out) || out.length !== items.length) throw new StorageError("PRESIGN", "The storage service didn't answer as expected.");
    return out;
  }

  return {
    // parts: { content: bytes, thumb?: bytes, text?: bytes } — all for one file.
    async put(scope, fileId, parts) {
      const items = Object.entries(parts).filter(([, b]) => b).map(([part, bytes]) => {
        if (!(bytes instanceof Uint8Array)) throw new Error("storage: parts must be bytes");
        if (bytes.length > MAX_PART_BYTES) throw new StorageError("TOO_LARGE", "That file is too large.");
        return { scope, fileId, part, size: bytes.length, bytes };
      });
      if (!items.some((i) => i.part === "content")) throw new Error("storage: content is required");
      const signed = await urls("put", items.map(({ bytes, ...i }) => i));
      await Promise.all(items.map(async (it, i) => {
        const res = await fetchImpl(signed[i].url, { method: "PUT", headers: signed[i].headers || {}, body: it.bytes });
        if (!res.ok) throw new StorageError("UPLOAD", `Upload failed (${res.status}).`, res.status);
      }));
      return items.reduce((n, i) => n + i.size, 0);
    },

    async get(scope, fileId, part) {
      const [signed] = await urls("get", [{ scope, fileId, part }]);
      const res = await fetchImpl(signed.url, { method: "GET", headers: signed.headers || {} });
      if (res.status === 404) throw new StorageError("MISSING", "That file isn't in storage.", 404);
      if (!res.ok) throw new StorageError("DOWNLOAD", `Download failed (${res.status}).`, res.status);
      return new Uint8Array(await res.arrayBuffer());
    },

    async remove(scope, fileId, parts = tier === "everyday" ? ["content", "thumb"] : ["content", "thumb", "text"]) {
      const items = parts.map((part) => ({ scope, fileId, part }));
      const signed = await urls("delete", items);
      await Promise.all(signed.map(async (s) => {
        const res = await fetchImpl(s.url, { method: "DELETE", headers: s.headers || {} });
        if (!res.ok && res.status !== 404) throw new StorageError("DELETE", `Delete failed (${res.status}).`, res.status);
      }));
    },
  };
}

// The app's presigner: the doc-storage Edge Function, called with the session token.
// getToken() returns the current Supabase access token.
export function edgePresigner({ functionsUrl, getToken, fetchImpl = (...a) => globalThis.fetch(...a) }) {
  return async (op, items) => {
    const res = await fetchImpl(`${functionsUrl.replace(/\/$/, "")}/doc-storage`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify({ op, items }),
    });
    if (res.status === 403) throw new StorageError("FORBIDDEN", "This account can't use that vault.", 403);
    if (res.status === 503) throw new StorageError("OFF", "Document storage isn't set up yet.", 503);
    if (!res.ok) throw new StorageError("PRESIGN", `The storage service failed (${res.status}).`, res.status);
    return (await res.json()).urls;
  };
}

// An in-memory object store with the same shape, for tests and local development.
// canAccess(scope) stands in for the server's access check.
export function memoryObjectStore({ canAccess = () => true } = {}) {
  const objects = new Map();
  const presign = async (op, items) => items.map((it) => {
    if (!canAccess(it.scope)) { const e = new StorageError("FORBIDDEN", "no", 403); throw e; }
    return { url: `mem://${op}/${objectKey(it)}`, headers: op === "put" ? { "content-length": String(it.size) } : {} };
  });
  const fetchImpl = async (url, init) => {
    const [, op, ...rest] = url.replace("mem://", "/").split("/");
    const key = rest.join("/");
    if (init.method === "PUT") {
      if (op !== "put") return { ok: false, status: 403 };
      if (Number(init.headers["content-length"]) !== init.body.length) return { ok: false, status: 403 };
      objects.set(key, init.body.slice());
      return { ok: true, status: 200 };
    }
    if (init.method === "GET") {
      if (op !== "get") return { ok: false, status: 403 };
      if (!objects.has(key)) return { ok: false, status: 404 };
      const b = objects.get(key);
      return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    }
    if (init.method === "DELETE") {
      if (op !== "delete") return { ok: false, status: 403 };
      objects.delete(key);
      return { ok: true, status: 204 };
    }
    return { ok: false, status: 405 };
  };
  return { presign, fetchImpl, objects };
}
