// Passwords' data layer (PASSWORDS_DESIGN.md §4–5): the logins of one scope, on top of
// the vault keys (vaults.js) and the server (server.js). No UI here.
//
// Rules carried over from the Documents library:
//   - rows below the vault's SETTLED version are never shown (rowVersionAllowed);
//   - each login carries `rev` inside the encryption; this device keeps the highest rev
//     it has seen per login and refuses an older copy (a server replaying an old row);
//   - a row that doesn't open is not shown.
//
// Egress: one read of the rows changed since the last one, when the page opens (and
// after this device's own edits); never a poll. The rows read are kept in the Safe's
// locked store (`logins:<scope>`), still encrypted, so an open reads only what changed.
// Rows purged after 30 days in Recently deleted never come back as a change, so the
// cache drops its own copies of those.

import { toB64, fromB64 } from "../../messaging/crypto/bytes.js";
import { deriveLoginsKey, encryptLogin, decryptLogin, rowVersionAllowed, LOGIN_LIMITS } from "../crypto/index.js";

export const LOGINS_DELETED_DAYS = 30;
const DAY = 24 * 3600 * 1000;

export function createLoginsLibrary({ server, vaults, store, now = () => Date.now(), newId = () => crypto.randomUUID() }) {
  const ctx = (k, loginId, keyVersion) => ({ vaultId: k.vaultId, scope: k.scope, loginId, keyVersion });
  const keyRing = new Map(); // `${vaultId}:${version}` → logins key (this session)

  function loginsKey(k, version) {
    const vk = k.keys.get(version);
    if (!vk) return null;
    const id = `${k.vaultId}:${version}`;
    if (!keyRing.has(id)) keyRing.set(id, deriveLoginsKey(vk, { vaultId: k.vaultId, scope: k.scope, keyVersion: version }));
    return keyRing.get(id);
  }

  const cacheKey = (scope) => `logins:${scope}`;
  async function cached(scope) {
    const c = await store.get(cacheKey(scope));
    return c && typeof c === "object" && c.rows ? c : { since: null, rows: {} };
  }

  function open(k, row) {
    if (!rowVersionAllowed(row.key_version, k.settled)) return null;
    const key = loginsKey(k, row.key_version);
    if (!key) return null;
    try {
      return decryptLogin(key, fromB64(row.enc), ctx(k, row.id, row.key_version));
    } catch { return null; }
  }

  // Every login of the scope, Recently deleted included (deletedAt set).
  async function list(scope) {
    const k = await vaults.keysFor(scope);
    const c = await cached(scope);
    const fresh = await server.logins(scope, c.since);
    let since = c.since;
    for (const row of fresh) {
      if (!since || row.updated_at > since) since = row.updated_at;
      const prev = c.rows[row.id];
      const login = open(k, row);
      if (!login) continue;
      // Never step back to an older copy: keep the cached row when it opens at a
      // higher rev than what the server sent.
      if (prev) {
        const was = open(k, prev);
        if (was && was.rev > login.rev) continue;
      }
      c.rows[row.id] = { id: row.id, enc: row.enc, key_version: row.key_version, updated_at: row.updated_at, deleted_at: row.deleted_at, created_by: row.created_by };
    }
    const out = [];
    const cutoff = now() - (LOGINS_DELETED_DAYS + 1) * DAY;
    for (const [id, row] of Object.entries(c.rows)) {
      if (row.deleted_at && Date.parse(row.deleted_at) < cutoff) { delete c.rows[id]; continue; }
      const login = open(k, row);
      if (!login) continue;
      out.push({ ...login, id, keyVersion: row.key_version, updatedAt: row.updated_at, deletedAt: row.deleted_at || null, createdBy: row.created_by || null });
    }
    await store.set(cacheKey(scope), { since, rows: c.rows });
    return out;
  }

  const nowIso = () => new Date(now()).toISOString();
  const pick = (f) => ({
    kind: f.kind || "login", title: f.title || "", sites: f.sites || [], exactSite: f.exactSite === true,
    username: f.username || "", password: f.password || "", totp: f.totp || "", notes: f.notes || "",
    tags: f.tags || [], favorite: f.favorite === true,
  });

  // Add (prev = null) or change a login. A changed password goes into the history.
  async function save(scope, prev, fields) {
    const k = await vaults.keysFor(scope);
    const at = nowIso();
    const next = pick({ ...(prev || {}), ...fields });
    let history = [...(prev?.history || [])];
    if (prev && prev.password && prev.password !== next.password && !history.some((h) => h.password === prev.password)) {
      history = [{ password: prev.password, changed: at }, ...history];
    }
    if (fields.history) history = fields.history;
    const login = { v: 1, ...next, history: history.slice(0, LOGIN_LIMITS.history), rev: (prev?.rev || 0) + 1, created: prev?.created || at, updated: at };
    const id = prev?.id || newId();
    const enc = toB64(encryptLogin(loginsKey(k, k.version), login, ctx(k, id, k.version)));
    if (prev) await server.updateLogin(id, { enc, key_version: k.version });
    else await server.addLogin({ id, scope, key_version: k.version, enc });
    return id;
  }

  // Many new logins at once (import), in batches, one request each.
  async function addMany(scope, list, { onProgress } = {}) {
    const k = await vaults.keysFor(scope);
    const at = nowIso();
    const key = loginsKey(k, k.version);
    const rows = list.map((f) => {
      const id = newId();
      const login = { v: 1, ...pick(f), history: (f.history || []).slice(0, LOGIN_LIMITS.history), rev: 1, created: at, updated: at };
      return { id, scope, key_version: k.version, enc: toB64(encryptLogin(key, login, ctx(k, id, k.version))) };
    });
    for (let i = 0; i < rows.length; i += 50) {
      await server.addLogins(rows.slice(i, i + 50));
      onProgress?.(Math.min(rows.length, i + 50), rows.length);
    }
    return rows.length;
  }

  const trash = (scope, id) => server.updateLogin(id, { deleted_at: nowIso() });
  const restore = (scope, id) => server.updateLogin(id, { deleted_at: null });

  // Household ⇄ Personal: a new row in the other scope, then the old one goes to
  // Recently deleted (row ids and scopes never change).
  async function move(fromScope, login, toScope) {
    const id = await save(toScope, null, { ...login, history: login.history || [] });
    await trash(fromScope, login.id);
    return id;
  }

  async function purgeExpired(scope) {
    const c = await cached(scope);
    const cutoff = now() - LOGINS_DELETED_DAYS * DAY;
    for (const row of Object.values(c.rows)) {
      if (row.deleted_at && Date.parse(row.deleted_at) < cutoff) await server.purgeLogin(row.id).catch(() => {});
    }
  }

  return { list, save, addMany, trash, restore, move, purgeExpired };
}
