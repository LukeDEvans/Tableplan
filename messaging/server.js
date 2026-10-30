// Messaging's only door to Supabase (MESSAGING_DESIGN.md §8). Everything goes through
// a small transport, so the same calls run against PostgREST in the app and against
// a real Postgres (PGlite, with the real migration and row security) in tests.
//
// transport: { rpc(name, args), select(table, query), insert(table, rows),
//              update(table, query, patch), remove(table, query) }
// where `query` is a PostgREST query string ("user_id=eq.…&select=…").
//
// Egress: every read names its columns; fetches are cursor-based and bounded; writes
// return nothing. No loops live here — callers decide when to call.

const DEVICE_COLUMNS = "device_id,user_id,kind,label,sign_pub,dh_pub,created_at_ms,identity_sig,device_sig,spk_id,spk_pub,spk_sig,spk_created_at_ms,revoked_at";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(v, what) {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new Error(`messaging server: bad ${what}`);
  return v.toLowerCase();
}

const inList = (ids) => `(${ids.map((x) => uuid(x, "id")).join(",")})`;

export function createMessagingServer(transport) {
  return {
    // People I can message (household and business-space members), me included.
    contacts: () => transport.rpc("msg_contacts", {}),

    identities: (userIds) => userIds.length
      ? transport.select("msg_identities", `user_id=in.${inList(userIds)}&select=user_id,sign_pub`)
      : Promise.resolve([]),

    createIdentity: (userId, signPub) => transport.insert("msg_identities", [{ user_id: uuid(userId, "user"), sign_pub: signPub }]),

    // New identity: revokes every device of mine and empties their inboxes (server side).
    resetIdentity: (signPub) => transport.rpc("msg_reset_identity", { p_sign_pub: signPub }),

    // Live devices of these people (removed ones are filtered out here and by the
    // server's send checks).
    devices: (userIds) => userIds.length
      ? transport.select("msg_devices", `user_id=in.${inList(userIds)}&revoked_at=is.null&select=${DEVICE_COLUMNS}&order=created_at_ms`)
      : Promise.resolve([]),

    device: async (deviceId) => (await transport.select("msg_devices", `device_id=eq.${uuid(deviceId, "device")}&select=${DEVICE_COLUMNS}`))[0] || null,

    registerDevice: (row) => transport.insert("msg_devices", [row]),

    updateSignedPrekey: (deviceId, spk) => transport.update("msg_devices", `device_id=eq.${uuid(deviceId, "device")}`, spk),

    touchDevice: (deviceId) => transport.update("msg_devices", `device_id=eq.${uuid(deviceId, "device")}`, { last_seen_at: new Date().toISOString() }),

    removeDevice: (deviceId) => transport.update("msg_devices", `device_id=eq.${uuid(deviceId, "device")}`, { revoked_at: new Date().toISOString() }),

    uploadPrekeys: (deviceId, keys) => keys.length
      ? transport.insert("msg_prekeys", keys.map((k) => ({ device_id: uuid(deviceId, "device"), prekey_id: k.id, pub: k.pub })))
      : Promise.resolve(null),

    prekeyCount: async (deviceId) => (await transport.select("msg_prekeys", `device_id=eq.${uuid(deviceId, "device")}&select=prekey_id`)).length,

    // One of a device's one-time prekeys, or null when it has none left.
    claimPrekey: async (deviceId) => {
      const rows = await transport.rpc("msg_claim_prekey", { p_device: uuid(deviceId, "device") });
      return Array.isArray(rows) && rows.length ? { id: rows[0].prekey_id, pub: rows[0].pub } : null;
    },

    createConversation: (conv, memberIds) => transport.rpc("msg_create_conversation", { p_conv: uuid(conv, "conversation"), p_members: memberIds.map((m) => uuid(m, "member")) }),
    addMembers: (conv, memberIds) => transport.rpc("msg_add_members", { p_conv: uuid(conv, "conversation"), p_members: memberIds.map((m) => uuid(m, "member")) }),
    removeMember: (conv, userId) => transport.rpc("msg_remove_member", { p_conv: uuid(conv, "conversation"), p_user: uuid(userId, "member") }),
    members: (conv) => transport.select("msg_conversation_members", `conversation_id=eq.${uuid(conv, "conversation")}&select=user_id`),

    // items: [{ device, ct }] — one row per recipient device.
    send: (conv, senderDevice, items) => transport.rpc("msg_send", {
      p_conv: conv === null ? null : uuid(conv, "conversation"),
      p_sender_device: uuid(senderDevice, "device"),
      p_items: items.map((i) => ({ device: uuid(i.device, "device"), ct: i.ct })),
    }),

    // This device's undelivered rows after the cursor, oldest first.
    fetchInbox: (deviceId, afterId = 0, max = 100) => transport.select(
      "msg_inbox",
      `recipient_device_id=eq.${uuid(deviceId, "device")}&id=gt.${Number(afterId) | 0}&order=id&limit=${Math.min(Math.max(max | 0, 1), 200)}&select=id,sender_device_id,sender_user_id,conversation_id,ciphertext,created_at`
    ),

    // Delivered: delete them (the inbox only ever holds what's in flight).
    ack: (deviceId, ids) => ids.length
      ? transport.remove("msg_inbox", `recipient_device_id=eq.${uuid(deviceId, "device")}&id=in.(${ids.map((i) => Number(i) | 0).join(",")})`)
      : Promise.resolve(null),
  };
}

// PostgREST over fetch. baseUrl() and headers() come from the app (supabaseBaseUrl /
// supabaseHeaders), so the signed-in user's token and the writer stamp go along.
export function createRestTransport({ baseUrl, headers, fetchImpl = (...a) => fetch(...a) }) {
  async function call(path, init) {
    const res = await fetchImpl(`${baseUrl()}/rest/v1/${path}`, { cache: "no-store", ...init, headers: { ...headers(), ...(init.headers || {}) } });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json())?.message || ""; } catch { /* no body */ }
      const err = new Error(`messaging: ${res.status}${detail ? ` ${detail}` : ""}`);
      err.status = res.status;
      throw err;
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  return {
    rpc: (name, args) => call(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) }),
    select: (table, query) => call(`${table}?${query}`, { method: "GET" }),
    insert: (table, rows) => call(table, { method: "POST", body: JSON.stringify(rows), headers: { prefer: "return=minimal" } }),
    update: (table, query, patch) => call(`${table}?${query}`, { method: "PATCH", body: JSON.stringify(patch), headers: { prefer: "return=minimal" } }),
    remove: (table, query) => call(`${table}?${query}`, { method: "DELETE", headers: { prefer: "return=minimal" } }),
  };
}
