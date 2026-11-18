// Settings › Beta › Connected assistants (DUET_CONNECTOR_DESIGN.md §5).
//
// Outside assistants such as Claude Duet reach Liv through a connector key that
// acts as the person who made it. This panel lists those keys, makes a new one
// (the secret is made here and shown once; only its SHA-256 leaves the device),
// revokes one, and shows what assistants changed, with undo.
//
// Data: assistant_connector_keys (read / revoke own, by row security),
// rpc/assistant_connector_mint_mine (migrations/2026-11-17e-assistant-mint-mine.sql),
// assistant_changes (read own), and liv-mcp's signed-in path for undo_change.

const CONNECTOR_URL_PATH = "/functions/v1/liv-mcp";

function newSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function timeAgo(iso, now = Date.now()) {
  if (!iso) return "never";
  const mins = Math.round((now - Date.parse(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// deps: { baseUrl(), headers() (REST headers with the person's token), accessToken(),
//         escapeHtml, stillShowing() — false once the panel has been left }
export function createAssistantConnectorsPanel(deps) {
  const esc = deps.escapeHtml;
  let keys = [];
  let changes = [];
  let fresh = null; // { name, key } just made — shown once
  let message = "";
  let busy = false;
  let container = null;

  const rest = (path, init = {}) => fetch(`${deps.baseUrl()}/rest/v1/${path}`, { ...init, headers: { ...deps.headers(), ...(init.headers || {}) } });

  async function load() {
    const [k, c] = await Promise.all([
      rest("assistant_connector_keys?select=id,name,scopes,created_at,last_used_at&revoked_at=is.null&order=created_at.desc"),
      rest("assistant_changes?select=id,summary,created_at,undone_at,tool,undo&order=created_at.desc&limit=30"),
    ]);
    if (!k.ok || !c.ok) throw new Error("load");
    keys = await k.json();
    changes = await c.json();
  }

  function template() {
    const keyRows = keys.length ? keys.map((k) => `
      <div class="ai-settings-row assistant-key-row">
        <div>
          <strong>${esc(k.name || "Assistant")}</strong>
          <p class="assistant-small">${(k.scopes || []).includes("write") ? "Can change Liv" : "Read only"} · used ${esc(timeAgo(k.last_used_at))}</p>
        </div>
        <button type="button" class="secondary-btn" data-assistant-revoke="${esc(k.id)}">Revoke</button>
      </div>`).join("") : `<p class="muted-label">No keys yet.</p>`;
    const changeRows = changes.length ? changes.map((c) => `
      <div class="ai-settings-row assistant-change-row">
        <div>
          <span>${esc(c.summary || c.tool)}</span>
          <p class="assistant-small">${esc(timeAgo(c.created_at))}${c.undone_at ? " · undone" : ""}</p>
        </div>
        ${c.undo && !c.undone_at && c.tool !== "undo_change" ? `<button type="button" class="secondary-btn" data-assistant-undo="${esc(c.id)}">Undo</button>` : ""}
      </div>`).join("") : `<p class="muted-label">Nothing yet.</p>`;
    const freshBox = fresh ? `
      <div class="assistant-fresh-key">
        <strong>${esc(fresh.name)}: copy this now. It won't be shown again.</strong>
        <p class="assistant-small">In claude.ai › Connectors, add a custom connector with this URL and an <code>authorization</code> header set to the line below.</p>
        <code class="assistant-key-text">${esc(deps.baseUrl() + CONNECTOR_URL_PATH)}</code>
        <code class="assistant-key-text">Bearer ${esc(fresh.key)}</code>
        <button type="button" class="secondary-btn" data-assistant-copy>Copy header</button>
      </div>` : "";
    return `
      <p class="settings-panel-note">Assistants such as Claude Duet reach Liv through a key. A key acts as you; one that can change Liv adds, edits and deletes in Calendar, Tasks, Shop, Meal Plan, Watch and Explore. Finance and Mail stay read-only.</p>
      ${message ? `<p class="settings-panel-note assistant-message">${esc(message)}</p>` : ""}
      <div class="ai-settings-section">
        <span class="theme-setting-title">Keys</span>
        ${keyRows}
      </div>
      <div class="ai-settings-section">
        <span class="theme-setting-title">New key</span>
        <div class="assistant-new-key">
          <input type="text" id="assistantKeyName" maxlength="60" placeholder="Name, e.g. Claude Duet" aria-label="Key name" />
          <label class="assistant-write-toggle"><input type="checkbox" class="live-toggle" id="assistantKeyWrite" checked /> <span>Can change Liv</span></label>
          <button type="button" class="primary-btn" data-assistant-mint ${busy ? "disabled" : ""}>Make key</button>
        </div>
        ${freshBox}
      </div>
      <div class="ai-settings-section">
        <span class="theme-setting-title">Recent changes by assistants</span>
        ${changeRows}
      </div>`;
  }

  function draw() {
    if (!container || !deps.stillShowing()) return;
    const name = container.querySelector("#assistantKeyName")?.value || "";
    container.innerHTML = template();
    const input = container.querySelector("#assistantKeyName");
    if (input) input.value = name;
  }

  async function act(fn) {
    if (busy) return;
    busy = true;
    message = "";
    try { await fn(); } catch (e) { message = e?.message && !/^(load|fetch)/i.test(e.message) ? e.message : "That didn't work. Try again in a minute."; }
    busy = false;
    try { await load(); } catch { /* keep what's shown */ }
    draw();
  }

  async function mint() {
    const name = (container.querySelector("#assistantKeyName")?.value || "").trim() || "Assistant";
    const write = container.querySelector("#assistantKeyWrite")?.checked !== false;
    const secret = newSecret();
    const res = await rest("rpc/assistant_connector_mint_mine", { method: "POST", body: JSON.stringify({ p_name: name, p_secret_hash: await sha256Hex(secret), p_write: write }) });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(/5 keys/.test(body?.message || "") ? "You have 5 keys already. Revoke one first." : "Couldn't make the key.");
    }
    const id = await res.json();
    fresh = { name, key: `${id}.${secret}` };
  }

  async function revoke(id) {
    const res = await rest(`assistant_connector_keys?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) });
    if (!res.ok) throw new Error("Couldn't revoke the key.");
    if (fresh && fresh.key.startsWith(`${id}.`)) fresh = null;
    message = "Key revoked. Anything using it stops working now.";
  }

  async function undo(id) {
    const res = await fetch(`${deps.baseUrl()}${CONNECTOR_URL_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${deps.accessToken()}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "undo_change", arguments: { change_id: id } } }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.result?.isError) throw new Error(body?.error || body?.result?.content?.[0]?.text || "Couldn't undo that.");
    message = `${body?.result?.content?.[0]?.text || "Undone."} Liv picks it up on its next refresh.`;
  }

  function onClick(event) {
    const t = event.target;
    if (t.closest("[data-assistant-mint]")) act(mint);
    else if (t.closest("[data-assistant-revoke]")) {
      const id = t.closest("[data-assistant-revoke]").dataset.assistantRevoke;
      const k = keys.find((x) => x.id === id);
      if (globalThis.confirm?.(`Revoke "${k?.name || "this key"}"? Whatever uses it stops working.`) === false) return;
      act(() => revoke(id));
    } else if (t.closest("[data-assistant-undo]")) act(() => undo(t.closest("[data-assistant-undo]").dataset.assistantUndo));
    else if (t.closest("[data-assistant-copy]") && fresh) {
      navigator.clipboard?.writeText(`Bearer ${fresh.key}`).then(() => { message = "Copied."; draw(); }, () => { message = "Couldn't copy; select the text instead."; draw(); });
    }
  }

  return {
    async render(el) {
      if (container !== el) {
        container?.removeEventListener("click", onClick);
        container = el;
        el.addEventListener("click", onClick);
      }
      fresh = null;
      message = "";
      el.innerHTML = `<p class="settings-panel-note">Loading…</p>`;
      try { await load(); } catch { message = "Couldn't load your keys."; }
      draw();
    },
  };
}
