// Settings › Beta › Connected Assistants (assistant-connectors-ui.js).
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createAssistantConnectorsPanel, timeAgo } from "../assistant-connectors-ui.js";

const BASE = "https://x.supabase.co";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let calls, keys, changes, realFetch, el;

function fakeEl() {
  let html = "";
  const listeners = [];
  const inputs = { assistantKeyName: { value: "" }, assistantKeyWrite: { checked: true } };
  return {
    get innerHTML() { return html; },
    set innerHTML(v) { html = v; },
    addEventListener: (_t, fn) => listeners.push(fn),
    removeEventListener: () => {},
    querySelector: (sel) => inputs[sel.replace("#", "")] || null,
    inputs,
    click(attr, value) {
      const target = { closest: (s) => (s === `[${attr}]` || (value && s === `[${attr}]`) ? { dataset: { assistantRevoke: value, assistantUndo: value } } : null) };
      listeners.forEach((fn) => fn({ target }));
    },
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = [];
  keys = [{ id: "k1", name: "Claude Duet", scopes: ["read", "write"], last_used_at: null }];
  changes = [{ id: "c1", summary: "Added to the shopping list: Mangos.", created_at: new Date().toISOString(), undone_at: null, tool: "add_shopping_items", undo: { kind: "shopping" } }];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.includes("assistant_connector_keys") && (init.method || "GET") === "GET") return json(keys);
    if (u.includes("assistant_connector_keys") && init.method === "PATCH") { keys = []; return new Response(null, { status: 204 }); }
    if (u.includes("assistant_changes")) return json(changes);
    if (u.endsWith("rpc/assistant_connector_mint_mine")) return json("11111111-1111-4111-8111-111111111111");
    if (u.endsWith("/functions/v1/liv-mcp")) return json({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Removed from the shopping list: Mangos." }], isError: false } });
    return json({}, 500);
  };
  el = fakeEl();
});
afterEach(() => { globalThis.fetch = realFetch; });

const panel = () => createAssistantConnectorsPanel({ baseUrl: () => BASE, headers: () => ({ apikey: "a", Authorization: "Bearer user-token" }), accessToken: () => "user-token", escapeHtml: esc, stillShowing: () => true });

describe("Connected Assistants panel", () => {
  it("lists keys and changes", async () => {
    await panel().render(el);
    expect(el.innerHTML).toContain("Claude Duet");
    expect(el.innerHTML).toContain("Can change Liv");
    expect(el.innerHTML).toContain("Mangos");
    expect(el.innerHTML).toContain("data-assistant-undo=\"c1\"");
  });

  it("makes a key: only the secret's hash leaves the device, and the key shows once", async () => {
    await panel().render(el);
    el.inputs.assistantKeyName.value = "Duet";
    el.click("data-assistant-mint");
    await settle(); await settle(); await settle();
    const mint = calls.find((c) => c.url.endsWith("rpc/assistant_connector_mint_mine"));
    const body = JSON.parse(mint.init.body);
    expect(body).toMatchObject({ p_name: "Duet", p_write: true });
    expect(body.p_secret_hash).toMatch(/^[0-9a-f]{64}$/);
    const shown = el.innerHTML.match(/Bearer 11111111-1111-4111-8111-111111111111\.([A-Za-z0-9_-]{43})/);
    expect(shown).toBeTruthy();
    expect(createHash("sha256").update(shown[1]).digest("hex")).toBe(body.p_secret_hash);
    expect(mint.init.body).not.toContain(shown[1]);
  });

  it("undoes through liv-mcp with the person's own sign-in", async () => {
    await panel().render(el);
    el.click("data-assistant-undo", "c1");
    await settle(); await settle(); await settle();
    const call = calls.find((c) => c.url.endsWith("/functions/v1/liv-mcp"));
    expect(call.init.headers.authorization).toBe("Bearer user-token");
    expect(JSON.parse(call.init.body).params).toEqual({ name: "undo_change", arguments: { change_id: "c1" } });
    expect(el.innerHTML).toContain("Removed from the shopping list");
  });

  it("revokes after asking", async () => {
    globalThis.confirm = () => true;
    await panel().render(el);
    el.click("data-assistant-revoke", "k1");
    await settle(); await settle(); await settle();
    expect(calls.some((c) => c.init.method === "PATCH" && c.url.includes("id=eq.k1"))).toBe(true);
    expect(el.innerHTML).toContain("Key revoked");
    delete globalThis.confirm;
  });

  it("escapes what it shows", async () => {
    keys = [{ id: "k1", name: "<img src=x>", scopes: ["read"] }];
    await panel().render(el);
    expect(el.innerHTML).not.toContain("<img");
  });

  it("timeAgo", () => {
    const now = Date.parse("2026-11-17T12:00:00Z");
    expect(timeAgo(null)).toBe("never");
    expect(timeAgo("2026-11-17T11:30:00Z", now)).toBe("30 min ago");
    expect(timeAgo("2026-11-15T12:00:00Z", now)).toBe("2 days ago");
  });
});
