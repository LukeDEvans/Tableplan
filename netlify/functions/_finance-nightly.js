// The nightly finance job: one bank pull per household, then the bank cache, the
// durable transaction store, the daily balance history and the finance backup.
//
// Runtime-neutral on purpose (fetch, btoa, no Node-only APIs): it runs in the
// Supabase Edge Function `finance-nightly` (scheduled by pg_cron; FINANCE_AUDIT.md
// A1) and can still be called from a Netlify function. It moved out of
// daily-briefing.js on 2026-11-12, when that scheduled function was being cut off
// before it got past the bank call: history and the backup had not been written
// since 2026-10-07.
//
// Every step is failure-isolated and reported: snapshotFinanceBalances returns one
// summary per household (no ids, names or amounts) so a run can be checked.

import financeIngest from "./_finance-ingest.js";
import financeSplit from "./_finance-split.js";
const { ingestFeed, storeNeedsBackfill, trimAccountsToDays, bridgeErrorsForDisplay, SIMPLEFIN_PULL_DAYS } = financeIngest;
const { personalScopeId, loadAccountViews, splitAccounts } = financeSplit;

const SUPABASE_URL = "https://noyocjcltrenwdovqrql.supabase.co";
function dateKey(d) { return d.toISOString().slice(0, 10); }

// ── Daily finance balance snapshot ───────────────────────────────────────────
// For each household with a SimpleFIN link: record every tracked account's
// balance (live for linked accounts, manual otherwise) plus the net-worth sum
// into the service-only row finhist_<groupId>. Clients read it through the
// simplefin function's "history" action; they can never write or clobber it.
function sbHeaders(serviceKey) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, accept: "application/json", "content-type": "application/json", "x-live-writer": "2" };
}

// Base64 of a UTF-8 string without Buffer (Deno has none by default).
function base64Utf8(text) {
  let bin = "";
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function splitAccessUrl(accessUrl) {
  try {
    const u = new URL(accessUrl);
    const auth = (u.username || u.password)
      ? base64Utf8(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`)
      : null;
    u.username = ""; u.password = "";
    return { url: u.toString().replace(/\/+$/, ""), auth };
  } catch { return { url: accessUrl, auth: null }; }
}

const numOrNull = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };

// → one summary per household: { ok, stoppedAt, bridgeMs, bridgeStatus, accounts,
// bridgeErrors, cache, ingest, snapshot }. `bridgeTimeoutMs` bounds the bank call
// (the bridge has taken long enough to get the old scheduled function cut off).
export async function snapshotFinanceBalances(serviceKey, { bridgeTimeoutMs = 100000 } = {}) {
  const headers = sbHeaders(serviceKey);
  const runs = [];
  const linkRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=like.simplefin*&select=id,state`, { headers });
  if (!linkRes.ok) throw new Error(`simplefin rows ${linkRes.status}`);
  for (const linkRow of await linkRes.json()) {
    const groupId = linkRow.id.replace(/^simplefin_/, "");
    const accessUrl = linkRow.state?.accessUrl;
    if (!accessUrl || groupId === linkRow.id) continue;
    const run = { ok: false, stoppedAt: "bridge", bridgeMs: null, bridgeStatus: null, accounts: 0, bridgeErrors: 0, cache: false, ingest: null, snapshot: false };
    runs.push(run);
    try {
      const { url, auth } = splitAccessUrl(accessUrl);
      // 45-day window: same as the interactive endpoint, so this one daily
      // bridge call can pre-warm that endpoint's finaccts_ cache (below) and
      // interactive phone loads never need their own bridge hit — which is
      // what was generating a "new IP" email on nearly every phone visit
      // (each Netlify egress IP differs). Bank data only changes once a day,
      // so a single daily pull loses nothing.
      //
      // Durable transaction store (FINANCE_TRANSACTIONS_DESIGN.md §3): until the
      // store holds real history, the pull asks for SimpleFIN's full 90 days, so
      // the store starts with as much as the bank will give. null = table not
      // reachable (migration not applied) → skip ingest, keep the 45-day pull.
      const needsBackfill = await storeNeedsBackfill({ serviceKey, groupId });
      const pullDays = needsBackfill === true ? 90 : SIMPLEFIN_PULL_DAYS;
      const start = Math.floor(Date.now() / 1000) - pullDays * 86400;
      const bridgeStarted = Date.now();
      const bridge = await fetch(`${url}/accounts?start-date=${start}`, {
        headers: { accept: "application/json", ...(auth ? { authorization: `Basic ${auth}` } : {}) },
        ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(bridgeTimeoutMs) } : {})
      });
      run.bridgeStatus = bridge.status;
      if (!bridge.ok) { run.bridgeMs = Date.now() - bridgeStarted; console.error(`[fin-snapshot] bridge ${bridge.status} for group`); continue; }
      const data = await bridge.json().catch(() => null);
      run.bridgeMs = Date.now() - bridgeStarted;
      run.accounts = Array.isArray(data?.accounts) ? data.accounts.length : 0;
      console.log(`[fin-snapshot] bridge answered in ${run.bridgeMs}ms with ${run.accounts} accounts`);
      const liveById = new Map((data?.accounts || []).map((a) => [String(a.id || ""), a]));

      // Personal accounts (FINANCE_SPLIT_DESIGN.md §2.1): household accounts go to
      // the household's cache / store / history, each personal account only to its
      // owner's. Fail closed: if the assignments can't be read, write nothing for
      // this group today (tomorrow's run catches up).
      const views = await loadAccountViews({ serviceKey, groupId });
      if (!views.ok) { run.stoppedAt = "views"; console.error("[fin-snapshot] account views unreadable — skipped group"); continue; }
      run.stoppedAt = "cache";

      // Pre-warm the interactive accounts cache with the same normalized shape
      // simplefin.js writes, so a phone load served from here is identical to a
      // live fetch. Best-effort — a snapshot failure must not block the cache
      // write, and vice versa.
      if (Array.isArray(data?.accounts)) {
        const normalized = data.accounts.map((a) => ({
          id: String(a.id || ""),
          org: a.org?.name || a.org?.domain || "",
          name: a.name || "",
          currency: a.currency || "USD",
          balance: numOrNull(a.balance),
          available: numOrNull(a["available-balance"]),
          balanceDate: a["balance-date"] ? new Date(a["balance-date"] * 1000).toISOString() : null,
          transactions: (a.transactions || []).map((t) => ({
            id: String(t.id || ""),
            posted: t.posted ? new Date(t.posted * 1000).toISOString() : null,
            amount: numOrNull(t.amount),
            description: String(t.description || "").slice(0, 200),
            pending: Boolean(t.pending)
          }))
        }));
        const errors = bridgeErrorsForDisplay(data.errors);
        const { household, byOwner } = splitAccounts(normalized, views.map);
        // Cache keeps the 45-day shape even on the 90-day backfill pull, so the
        // client's feed (and its month-actuals coverage) is unchanged.
        const warm = (id, accts) => fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
          method: "POST",
          headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id, state: { accounts: trimAccountsToDays(accts, 45), errors, fetchedAt: new Date().toISOString() }, updated_at: new Date().toISOString() })
        }).then((r) => { if (!r.ok) console.error(`[fin-snapshot] cache warm ${r.status}`); return r.ok; }).catch((e) => { console.error("[fin-snapshot] cache warm threw", e.name || "error"); return false; });
        run.bridgeErrors = errors.length;
        run.cache = await warm(`finaccts_${groupId}`, household);
        for (const [owner, own] of Object.entries(byOwner)) await warm(`finaccts_${personalScopeId(owner)}`, own);
        // Durable store ingest — additive, failure-isolated (never blocks the
        // cache warm above or the balance snapshot below).
        if (needsBackfill !== null) {
          run.stoppedAt = "ingest";
          try { run.ingest = await ingestFeed({ serviceKey, groupId, accounts: household }) || null; }
          catch (e) { run.ingest = "failed"; console.error("[fin-ingest] failed", e.message || "error"); }
          for (const [owner, own] of Object.entries(byOwner)) {
            try { await ingestFeed({ serviceKey, groupId: personalScopeId(owner), accounts: own }); }
            catch (e) { console.error("[fin-ingest] personal failed", e.message || "error"); }
          }
        }
      }

      // Household: backup + balance history from the household finance section,
      // never counting an account assigned to someone personally. A bridge answer
      // with no account list still gets the backup, but no history point: one
      // built from manual balances alone would be a false drop in net worth.
      const history = Array.isArray(data?.accounts);
      run.stoppedAt = "snapshot";
      await snapshotScope(headers, groupId, liveById, (linkedId) => !views.map.has(linkedId), { history });
      // Each owner's personal finance section and history.
      for (const owner of new Set(views.map.values())) {
        await snapshotScope(headers, personalScopeId(owner), liveById, (linkedId) => views.map.get(linkedId) === owner, { history });
      }
      run.snapshot = true;
      run.stoppedAt = "";
      run.ok = history && run.cache;
    } catch (e) {
      run.error = e?.name || "error";
      console.error("[fin-snapshot] group failed:", e.name || "error"); // names only — no URLs in logs
    }
  }
  return runs;
}

// One scope's finance backup + daily balance history: the household
// (`<groupId>:finance` → finhist_<groupId>) or a member's personal accounts
// (`u-<id>:finance` → finhist_u-<id>). `counts(linkedId)` says whether a linked
// account's live balance belongs in this scope (manual accounts always do).
async function snapshotScope(headers, scopeId, liveById, counts, { history = true } = {}) {
  const finRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(scopeId + ":finance")}&select=state`, { headers });
  const finRows = finRes.ok ? await finRes.json() : [];

  // Rolling daily backup of the finance section, so budget categories and
  // transaction annotations are always recoverable if any client ever wipes
  // them. A snapshot that is EMPTIER than the newest stored one is skipped, so a
  // wipe can never poison the backup — the last healthy copy survives. Kept per
  // date; window trimmed to ~21 days.
  try { await backupFinanceSection(headers, scopeId, finRows[0]?.state); }
  catch (e) { console.error("[fin-backup] failed:", e.name || "error"); }

  if (!history) return;
  const accounts = finRows[0]?.state?.financeAccounts || [];
  const balances = {};
  let netWorth = 0, any = false;
  for (const a of accounts) {
    if (a.linkedId && !counts(String(a.linkedId))) continue;
    const live = a.linkedId ? liveById.get(a.linkedId) : null;
    const bal = live && live.balance != null ? parseFloat(live.balance)
      : (a.manualBalance != null && a.manualBalance !== "" ? Number(a.manualBalance) : null);
    if (bal === null || !Number.isFinite(bal)) continue;
    balances[a.id] = Math.round(bal * 100) / 100;
    netWorth += bal; any = true;
  }
  if (!any) return;

  const histId = `finhist_${scopeId}`;
  const histRes = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(histId)}&select=state`, { headers });
  const histRows = histRes.ok ? await histRes.json() : [];
  const days = (histRows[0]?.state?.days && typeof histRows[0].state.days === "object") ? histRows[0].state.days : {};
  days[dateKey(new Date())] = { netWorth: Math.round(netWorth * 100) / 100, balances };
  const keys = Object.keys(days).sort();
  for (let i = 0; i < keys.length - 730; i++) delete days[keys[i]];

  const up = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id: histId, state: { days }, updated_at: new Date().toISOString() })
  });
  if (!up.ok) console.error(`[fin-snapshot] save ${up.status}`);
  else console.log(`[fin-snapshot] recorded ${Object.keys(balances).length} balances`);
}

// How "rich" a finance state is — used to refuse backing up a wipe over a
// healthy snapshot. Counts budget categories + every transaction-annotation
// entry + manual transactions.
function financeRichness(fin) {
  if (!fin || typeof fin !== "object") return 0;
  let n = 0;
  for (const g of (Array.isArray(fin.financeBudgetGroups) ? fin.financeBudgetGroups : [])) {
    n += Array.isArray(g?.categories) ? g.categories.length : 0;
  }
  for (const k of ["financeTxnLabels", "financeTxnRules", "financeTxnNoteOverrides",
    "financeTxnNoteCounts", "financeTxnLinks", "financeTxnSignFlips", "financeMerchantNames",
    "financeAccountSubLabels", "financeMonthActuals"]) {
    const v = fin[k];
    if (v && typeof v === "object") n += Object.keys(v).length;
  }
  for (const k of ["financeManualTxns", "financeAccountLabels"]) {
    if (Array.isArray(fin[k])) n += fin[k].length;
  }
  return n;
}

async function backupFinanceSection(headers, groupId, finState) {
  if (!finState || typeof finState !== "object") return;
  const id = `finbackup_${groupId}`;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?id=eq.${encodeURIComponent(id)}&select=state`, { headers, cache: "no-store" });
  const rows = res.ok ? await res.json() : [];
  const snaps = (rows[0]?.state?.snapshots && typeof rows[0].state.snapshots === "object") ? rows[0].state.snapshots : {};

  // Never let a wipe overwrite a healthier copy: skip if today's data is
  // emptier than the newest snapshot we already hold.
  const newestKey = Object.keys(snaps).sort().at(-1);
  const newestRichness = newestKey ? financeRichness(snaps[newestKey]) : -1;
  const todayRichness = financeRichness(finState);
  if (todayRichness < newestRichness) {
    console.log(`[fin-backup] skipped — today (${todayRichness}) poorer than newest (${newestRichness})`);
    return;
  }

  const today = dateKey(new Date());
  snaps[today] = finState;
  for (const k of Object.keys(snaps).sort().slice(0, -21)) delete snaps[k]; // keep newest ~21 days

  const up = await fetch(`${SUPABASE_URL}/rest/v1/tableplan_states?on_conflict=id`, {
    method: "POST",
    headers: { ...headers, prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ id, state: { snapshots: snaps }, updated_at: new Date().toISOString() })
  });
  if (!up.ok) console.error(`[fin-backup] save ${up.status}`);
  else console.log(`[fin-backup] stored ${today} (richness ${todayRichness}, ${Object.keys(snaps).length} days kept)`);
}

