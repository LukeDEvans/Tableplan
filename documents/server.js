// Documents' only door to Supabase (DOCUMENTS_DESIGN.md §6). Same transport shape as
// messaging/server.js, so the same calls run against PostgREST in the app and
// against a real Postgres (PGlite, with the real migration and row security) in tests.
//
// transport: { rpc(name, args), select(table, query), insert(table, rows),
//              update(table, query, patch), remove(table, query) }
//
// Egress: every read names its columns and is bounded to one vault or scope; no loops
// live here — callers decide when to call. Nothing returned here is trusted for
// security: keys, versions and removals are proven on the device (documents/crypto).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPE_RE = /^[A-Za-z0-9_-]{1,64}$/;

function uuid(v, what) {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`documents server: bad ${what}`);
  return v.toLowerCase();
}
function scopeId(v) {
  if (typeof v !== "string" || !SCOPE_RE.test(v)) throw new Error("documents server: bad scope");
  return v;
}
function version(v) {
  if (!Number.isInteger(v) || v < 1) throw new Error("documents server: bad key version");
  return v;
}
const inList = (ids) => `(${ids.map((x) => uuid(x, "id")).join(",")})`;
const enc = encodeURIComponent;

const GRANT_COLS = "vault_id,key_version,device_id,sealed,granter_user_id,granter_device_id,granter_sig";
const FILE_KEY_COLS = "id,wrapped_key,key_version";

export function createDocumentsServer(transport) {
  return {
    // ---- vaults -------------------------------------------------------------------------
    vault: async (scope) => (await transport.select("doc_vaults", `scope=eq.${enc(scopeId(scope))}&select=id,scope,key_version`))[0] || null,
    createVault: (id, scope) => transport.insert("doc_vaults", [{ id: uuid(id, "vault"), scope: scopeId(scope) }]),
    setVaultVersion: (vaultId, v) => transport.update("doc_vaults", `id=eq.${uuid(vaultId, "vault")}`, { key_version: version(v) }),

    // ---- device box keys -------------------------------------------------------------------
    boxes: (userIds) => userIds.length
      ? transport.select("doc_device_boxes", `user_id=in.${inList(userIds)}&select=device_id,user_id,box_pub,box_sig`)
      : Promise.resolve([]),
    addBox: (row) => transport.insert("doc_device_boxes", [{
      device_id: uuid(row.device_id, "device"), user_id: uuid(row.user_id, "user"), box_pub: row.box_pub, box_sig: row.box_sig,
    }]),

    // ---- grants -------------------------------------------------------------------------------
    myGrant: async (vaultId, v, deviceId) => (await transport.select("doc_vault_grants",
      `vault_id=eq.${uuid(vaultId, "vault")}&key_version=eq.${version(v)}&device_id=eq.${uuid(deviceId, "device")}&select=${GRANT_COLS}`))[0] || null,
    grantsAt: (vaultId, v) => transport.select("doc_vault_grants", `vault_id=eq.${uuid(vaultId, "vault")}&key_version=eq.${version(v)}&select=device_id`),
    addGrants: (rows) => rows.length ? transport.insert("doc_vault_grants", rows) : Promise.resolve(null),

    // ---- older keys and settled statements ------------------------------------------------------
    oldKeys: (vaultId) => transport.select("doc_vault_keys_old", `vault_id=eq.${uuid(vaultId, "vault")}&select=key_version,wrapped`),
    addOldKey: (vaultId, v, wrapped) => transport.insert("doc_vault_keys_old", [{ vault_id: uuid(vaultId, "vault"), key_version: version(v), wrapped }]),
    settled: (vaultId) => transport.select("doc_vault_settled", `vault_id=eq.${uuid(vaultId, "vault")}&select=key_version,signer_user_id,removed_device_ids,sig&order=key_version`),
    addSettled: (row) => transport.insert("doc_vault_settled", [{
      vault_id: uuid(row.vault_id, "vault"), key_version: version(row.key_version), signer_user_id: uuid(row.signer_user_id, "user"),
      removed_device_ids: row.removed_device_ids.map((d) => uuid(d, "device")), sig: row.sig,
    }]),

    // ---- recovery ---------------------------------------------------------------------------------
    recoveryKey: async (userId) => (await transport.select("doc_recovery_keys", `user_id=eq.${uuid(userId, "user")}&select=user_id,generation,recovery_pub,params,sig`))[0] || null,
    addRecoveryKey: (row) => transport.insert("doc_recovery_keys", [row]),
    replaceRecoveryKey: (userId, patch) => transport.update("doc_recovery_keys", `user_id=eq.${uuid(userId, "user")}`, patch),
    recoveryWraps: (userId) => transport.select("doc_recovery_wraps", `user_id=eq.${uuid(userId, "user")}&select=vault_id,key_version,kind,wrapped`),
    addRecoveryWrap: (row) => transport.insert("doc_recovery_wraps", [row]),
    removeRecoveryWraps: (userId, vaultId) => transport.remove("doc_recovery_wraps", `user_id=eq.${uuid(userId, "user")}&vault_id=eq.${uuid(vaultId, "vault")}`),

    // ---- folders and files (the library) -------------------------------------------------------------
    folders: (scope) => transport.select("doc_folders", `scope=eq.${enc(scopeId(scope))}&select=id,enc_name,key_version,kind,sort,updated_at,deleted_at&order=sort`),
    addFolder: (row) => transport.insert("doc_folders", [row]),
    updateFolder: (id, patch) => transport.update("doc_folders", `id=eq.${uuid(id, "folder")}`, patch),
    removeFolder: (id) => transport.remove("doc_folders", `id=eq.${uuid(id, "folder")}`),
    // Changed since `since` (ISO time), or everything. Bounded by the scope.
    files: (scope, since = null) => transport.select("doc_files",
      `scope=eq.${enc(scopeId(scope))}${since ? `&updated_at=gt.${enc(since)}` : ""}&select=id,folder_id,wrapped_key,key_version,enc_meta,parts,size,added_by,created_at,updated_at,deleted_at&order=updated_at`),
    addFile: (row) => transport.insert("doc_files", [row]),
    updateFile: (id, patch) => transport.update("doc_files", `id=eq.${uuid(id, "file")}`, patch),
    removeFile: (id) => transport.remove("doc_files", `id=eq.${uuid(id, "file")}`),
    usage: (scope) => transport.rpc("doc_usage", { p_scope: scopeId(scope) }),

    // ---- re-wrapping on rotation ---------------------------------------------------------------------
    fileKeys: (scope) => transport.select("doc_files", `scope=eq.${enc(scopeId(scope))}&select=${FILE_KEY_COLS}`),
    rewrapFile: (id, wrapped, v) => transport.update("doc_files", `id=eq.${uuid(id, "file")}`, { wrapped_key: wrapped, key_version: version(v) }),
    folderNames: (scope) => transport.select("doc_folders", `scope=eq.${enc(scopeId(scope))}&select=id,enc_name,key_version`),
    rewrapFolder: (id, encName, v) => transport.update("doc_folders", `id=eq.${uuid(id, "folder")}`, { enc_name: encName, key_version: version(v) }),
  };
}
