// Keeps the iPhone Share Extension's receipt share token in step with sign-in
// (RECEIPTS.md → "Share sheet"). The token itself lives in the keychain group the
// app shares with the extension (ShareToken plugin); this only decides when to
// mint, store or clear it.
//
// • signed in  → mint once, then again every REMINT_MS (tokens last a year), so
//                an active phone never holds an expiring token.
// • signed out → clear it, so a signed-out phone can't keep sending receipts.
//
// Runs once per app start / sign-in; never loops. A re-entrant call while one
// is in flight gets the same promise.

export const SHARE_TOKEN_STAMP_KEY = "live_receipt_share_token_at";
export const REMINT_MS = 30 * 24 * 3600 * 1000;

let inFlight = null;

export function syncReceiptShareToken(opts) {
  if (inFlight) return inFlight;
  inFlight = run(opts).finally(() => { inFlight = null; });
  return inFlight;
}

async function run({ plugin, mint, storage, signedIn, now = Date.now() }) {
  if (!plugin) return "unavailable";
  if (!signedIn) {
    try { await plugin.clear(); } catch { /* nothing stored */ }
    try { storage?.removeItem(SHARE_TOKEN_STAMP_KEY); } catch { /* storage blocked */ }
    return "cleared";
  }
  let last = 0;
  try { last = Number(storage?.getItem(SHARE_TOKEN_STAMP_KEY)) || 0; } catch { /* storage blocked */ }
  let present = false;
  try { present = (await plugin.status())?.present === true; } catch { /* treat as absent */ }
  if (present && last && now - last >= 0 && now - last < REMINT_MS) return "fresh";

  let data = null;
  try { data = await mint(); } catch { return "failed"; }
  if (!data?.token) return "failed";
  try { await plugin.set({ token: data.token }); } catch { return "failed"; }
  try { storage?.setItem(SHARE_TOKEN_STAMP_KEY, String(now)); } catch { /* re-mints next start */ }
  return "stored";
}
