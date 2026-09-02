// diagnostics.js — a read-only developer diagnostics snapshot. Pure and testable:
// the shell passes in the live runtime values via `sources` (getters/values) and
// this module normalizes them into a structured snapshot + printable lines. No
// globals, no persistence, no side effects. The snapshot is a debugging/reliability
// tool for developers and a legibility surface for future AI-assisted maintenance
// (ARCHITECTURE.md §17). It is NOT shown to normal users (see app.js window.__liveDiag).
//
// Account-safety: this module holds nothing across reloads and owns no cache; the
// in-memory error ring buffer below resets on reload, so it introduces no
// account-boundary surface.

const asArray = (v) => (Array.isArray(v) ? v : []);
const asBool = (v) => !!v;
const val = (s, k, d = null) => {
  const x = s ? s[k] : undefined;
  if (x === undefined || x === null) return d;
  return typeof x === "function" ? safe(x, d) : x;
};
const safe = (fn, d) => { try { return fn(); } catch { return d; } };

// Normalize injected runtime values into a stable diagnostics snapshot. Every field
// is defensively read so a broken getter never throws the panel.
export function collectDiagnostics(sources = {}, now = new Date()) {
  const account = sources.account || {};
  const sync = sources.sync || {};
  const persistence = sources.persistence || {};
  return {
    at: now.toISOString(),
    account: {
      id: val(account, "id"),
      hydrated: asBool(val(account, "hydrated", false)),
      financeHydrated: asBool(val(account, "financeHydrated", false)),
      localDev: asBool(val(account, "localDev", false)),
    },
    sync: {
      ready: asBool(val(sync, "ready", false)),
      provider: val(sync, "provider"),
      online: asBool(val(sync, "online", true)),
      pendingWrite: asBool(val(sync, "pendingWrite", false)),
      dirtySections: asArray(val(sync, "dirtySections", [])),
      stateUpdatedAt: val(sync, "stateUpdatedAt"),
      schemaVersion: val(sync, "schemaVersion"),
    },
    persistence: {
      mirrorPresent: asBool(val(persistence, "mirrorPresent", false)),
      localKeys: asArray(val(persistence, "localKeys", [])),
      idbStores: asArray(val(persistence, "idbStores", [])),
    },
    providers: asArray(sources.providers).map((p) => ({
      id: p?.id ?? null, available: asBool(p?.available), label: p?.label ?? p?.id ?? null,
    })),
    capabilities: asArray(sources.capabilities).map((c) => ({
      id: c?.id ?? null, status: c?.status ?? null, available: asBool(c?.available),
    })),
    errors: asArray(sources.errors).slice(-20),
  };
}

// Flatten a snapshot into printable "group · label: value" lines (for console or a
// simple DOM panel).
export function formatDiagnostics(snap) {
  if (!snap) return [];
  const lines = [];
  const push = (group, label, value) => lines.push({ group, label, value: String(value) });
  push("account", "id", snap.account.id ?? "(signed out)");
  push("account", "hydrated", snap.account.hydrated);
  push("account", "finance hydrated", snap.account.financeHydrated);
  push("sync", "ready", snap.sync.ready);
  push("sync", "online", snap.sync.online);
  push("sync", "provider", snap.sync.provider ?? "(none)");
  push("sync", "pending write", snap.sync.pendingWrite);
  push("sync", "dirty sections", snap.sync.dirtySections.join(", ") || "(clean)");
  push("sync", "stateUpdatedAt", snap.sync.stateUpdatedAt ?? "-");
  push("persistence", "mirror present", snap.persistence.mirrorPresent);
  push("persistence", "local keys", snap.persistence.localKeys.length);
  push("persistence", "idb stores", snap.persistence.idbStores.join(", ") || "-");
  push("providers", "available", snap.providers.filter((p) => p.available).map((p) => p.id).join(", ") || "-");
  push("capabilities", "live", snap.capabilities.filter((c) => c.available).map((c) => c.id).join(", ") || "-");
  push("errors", "recent", snap.errors.length);
  return lines;
}

// A capped in-memory error ring buffer. Pure factory; the shell feeds it from
// window 'error'/'unhandledrejection'. Reset on reload — never persisted.
export function createErrorLog(cap = 50) {
  const items = [];
  return {
    record(err, at = new Date()) {
      const message = (err && (err.message || err.reason?.message || err.reason)) || String(err);
      items.push({ at: at.toISOString(), message: String(message).slice(0, 300) });
      if (items.length > cap) items.splice(0, items.length - cap);
      return items.length;
    },
    list() { return items.slice(); },
    clear() { items.length = 0; },
  };
}
