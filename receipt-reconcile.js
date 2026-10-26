// receipt-reconcile.js — does a receipt's arithmetic add up? (RECEIPTS.md "Reading
// a receipt"). PURE: no DOM, no network; shared by the app and the scan functions.
//
// The AI only transcribes what is printed (items, coupons, fees, subtotal, tax,
// total). This module does the math. Stores print the same things in different
// places: Costco's coupons come BEFORE the subtotal, Target's RedCard 5% comes
// AFTER it, and a bag fee may sit inside the subtotal or below it. Rather than
// trusting one fixed formula (which flagged correct Costco and Target receipts on
// 2026-10-23), reconcileReceipt tries each placement of the receipt-level
// discounts and fees and keeps the one under which the printed numbers agree.
//
// Also here: per-store profiles (which placement a store uses, plus a reading hint
// for the prompt), and the on-device OCR helpers (iPhone text recognition): group
// recognized text into printed rows, pull the money amounts out, and cross-check
// the AI's prices against them.

const TOLERANCE = 0.02;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => {
  const n = Number(String(v ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n) => `$${Math.abs(round2(n)).toFixed(2)}`;

// ── Store profiles ───────────────────────────────────────────────────────────
// discounts / fees: where the store prints its receipt-level savings and fees
// relative to the SUBTOTAL ("before" = the subtotal already includes them).
// Only tie-breaks: the numbers always decide first. hint: one line for the prompt.
export const RECEIPT_STORE_PROFILES = [
  {
    id: "costco", match: /costco/i, discounts: "before",
    hint: "Costco: instant-savings coupons print as their own line right under the item, like \"/1234567 3.00-\"; the SUBTOTAL already has them taken off.",
  },
  {
    id: "target", match: /\btarget\b/i, discounts: "after", fees: "before",
    hint: "Target: Circle offers print as their own line under the item; \"RedCard Savings\" (5%) prints BELOW the subtotal; a bag fee is part of the subtotal.",
  },
  {
    id: "aldi", match: /\baldi\b/i, fees: "before",
    hint: "ALDI: shopping bags print as ordinary items; there are rarely any coupons.",
  },
  {
    id: "whole-foods", match: /whole\s*foods/i, discounts: "before",
    hint: "Whole Foods: Prime savings print as their own line under the item and are already taken off before the subtotal.",
  },
  {
    id: "trader-joes", match: /trader\s*joe/i,
    hint: "Trader Joe's: items only, no coupons; the total is items plus tax.",
  },
];

export function storeProfileFor(storeName) {
  const name = String(storeName || "");
  if (!name) return null;
  return RECEIPT_STORE_PROFILES.find((p) => p.match.test(name)) || null;
}

// One short paragraph for the read prompt (all profiles: the store isn't known yet).
export function storeHintsForPrompt() {
  return RECEIPT_STORE_PROFILES.map((p) => p.hint).join("\n");
}

// ── Reconciliation ───────────────────────────────────────────────────────────
// Placements tried for receipt-level discounts (D) and fees (F):
//   discounts: "lines"  — D only repeats coupon lines already in the items (ignore it)
//              "before" — D is taken off before the subtotal (lines − D = subtotal)
//              "after"  — D is taken off below the subtotal (subtotal − D + tax = total)
//   fees:      "before" — the subtotal includes F;  "after" — F is added below it
// Equations (L = sum of line prices, coupon lines negative; S subtotal; T tax):
//   lines → subtotal:  L − D[before] + F[before] = S
//   subtotal → total:  S − D[after]  + F[after] + T = total
// With no printed subtotal the two collapse into lines → total.
export function reconcileReceipt(receipt, { tolerance = TOLERANCE, profile } = {}) {
  const lines = Array.isArray(receipt?.lineItems) ? receipt.lineItems : [];
  const L = round2(lines.reduce((sum, line) => sum + num(line?.totalPrice), 0));
  const S = round2(num(receipt?.subtotal));
  const T = round2(num(receipt?.tax));
  const F = round2(num(receipt?.fees));
  const D = round2(Math.abs(num(receipt?.discounts)));
  const TOT = round2(num(receipt?.total));
  const storeProfile = profile === undefined ? storeProfileFor(receipt?.storeName) : profile;
  const couponLines = lines.filter((line) => num(line?.totalPrice) < 0);
  const couponSum = round2(-couponLines.reduce((sum, line) => sum + num(line?.totalPrice), 0));

  const discountOptions = D > 0 ? ["after", "before", "lines"] : ["none"];
  const feeOptions = F > 0 ? ["after", "before"] : ["none"];
  const candidates = [];
  for (const discounts of discountOptions) {
    for (const fees of feeOptions) {
      const dBefore = discounts === "before" ? D : 0;
      const dAfter = discounts === "after" ? D : 0;
      const fBefore = fees === "before" ? F : 0;
      const fAfter = fees === "after" ? F : 0;
      // What the lines should add up to, from the printed subtotal.
      const linesTarget = S > 0 ? round2(S + dBefore - fBefore) : null;
      const lineGap = linesTarget === null ? null : round2(linesTarget - L);
      const base = S > 0 ? S : round2(L - dBefore + fBefore);
      const computedTotal = round2(base - dAfter + fAfter + T);
      const totalGap = TOT > 0 ? round2(TOT - computedTotal) : null;
      const subtotalOk = lineGap === null ? null : Math.abs(lineGap) <= tolerance;
      const totalOk = totalGap === null ? null : Math.abs(totalGap) <= tolerance;
      candidates.push({ discounts, fees, linesTarget, lineGap, computedTotal, totalGap, subtotalOk, totalOk });
    }
  }

  const rank = (c) => {
    const totalBad = c.totalOk === false ? 1 : 0;
    const subBad = c.subtotalOk === false ? 1 : 0;
    // Prefer what the store is known to do, then what the reader said (D and F
    // were asked for as "below the subtotal"), then coupons-already-on-lines only
    // when there really are coupon lines that D repeats.
    let pref = 0;
    if (storeProfile?.discounts && c.discounts !== "none" && c.discounts !== storeProfile.discounts) pref += 2;
    if (storeProfile?.fees && c.fees !== "none" && c.fees !== storeProfile.fees) pref += 2;
    if (c.discounts === "before") pref += 1;
    if (c.fees === "before") pref += 1;
    if (c.discounts === "lines") pref += Math.abs(couponSum - D) <= tolerance ? 1 : 4;
    const gap = Math.abs(c.totalGap || 0) + Math.abs(c.lineGap || 0);
    return [totalBad + subBad, totalBad, gap, pref];
  };
  const best = candidates
    .map((c) => ({ c, r: rank(c) }))
    .sort((a, b) => {
      for (let i = 0; i < a.r.length; i++) if (a.r[i] !== b.r[i]) return a.r[i] - b.r[i];
      return 0;
    })[0].c;

  const ok = best.totalOk !== false && best.subtotalOk !== false;
  return {
    ok,
    // Nothing to check against (no subtotal and no total printed).
    checked: best.totalOk !== null || best.subtotalOk !== null,
    layout: { discounts: best.discounts, fees: best.fees },
    lineSum: L,
    linesTarget: best.linesTarget,
    lineGap: best.lineGap,
    computedTotal: best.computedTotal,
    totalGap: best.totalGap,
    subtotalOk: best.subtotalOk,
    totalOk: best.totalOk,
    profile: storeProfile?.id || "",
    message: reconcileMessage(best, { L, S, TOT }),
  };
}

function reconcileMessage(best, { L, S, TOT }) {
  if (best.totalOk === false) {
    return `The subtotal, savings, fees and tax don't come to the ${money(TOT)} total (off by ${money(best.totalGap)}). Check those numbers against the receipt.`;
  }
  if (best.subtotalOk === false) {
    const target = best.linesTarget;
    const short = best.lineGap > 0;
    return `The items come to ${money(L)}, ${money(best.lineGap)} ${short ? "less" : "more"} than the ${money(target)} they should${target !== S ? "" : " (the subtotal)"}. ${short ? "A line may be missing or misread." : "A line may be read twice or a coupon missed."}`;
  }
  return "";
}

// "Ready" or "check": what a scanned receipt needs from the user.
export function receiptScanStatus(receipt) {
  const verdict = reconcileReceipt(receipt);
  return verdict.ok && verdict.checked ? "ok" : "check";
}

// ── On-device text recognition (iPhone Vision) ──────────────────────────────
// Observations: [{ text, x, y, w, h }] in 0–1 page coordinates, top-left origin.
// Vision returns the item name and its price as separate observations, so rows are
// rebuilt by vertical overlap, then read left to right.
export function ocrRowsFromObservations(observations) {
  const obs = (Array.isArray(observations) ? observations : [])
    .map((o) => ({ text: String(o?.text || "").trim(), x: num(o?.x), y: num(o?.y), w: num(o?.w), h: Math.max(0.001, num(o?.h)) }))
    .filter((o) => o.text)
    .sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2));
  const rows = [];
  for (const o of obs) {
    const cy = o.y + o.h / 2;
    const row = rows[rows.length - 1];
    if (row && Math.abs(cy - row.cy) <= Math.min(o.h, row.h) * 0.6) {
      row.items.push(o);
      row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length;
      row.h = Math.max(row.h, o.h);
    } else {
      rows.push({ cy, h: o.h, items: [o] });
    }
  }
  return rows.map((row) => row.items.sort((a, b) => a.x - b.x).map((o) => o.text).join("  "));
}

// Money amounts printed on a row: "3.49", "$12.00", "3.00-", "-1.56". Cents as
// integers so matching is exact. Prices only (two decimals) — never quantities.
const MONEY_RE = /(-)?\$?\s?(\d{1,4}(?:,\d{3})*)\.(\d{2})(?!\d)\s?(-)?/g;
export function moneyOnRow(row) {
  const out = [];
  for (const m of String(row || "").matchAll(MONEY_RE)) {
    const cents = Number(m[2].replace(/,/g, "")) * 100 + Number(m[3]);
    out.push((m[1] || m[4]) ? -cents : cents);
  }
  return out;
}

// SUBTOTAL / TAX / TOTAL as printed, read from OCR rows. 0 when not found.
export function ocrHeaderValues(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const last = (row) => { const m = moneyOnRow(row); return m.length ? Math.abs(m[m.length - 1]) / 100 : 0; };
  let subtotal = 0;
  let total = 0;
  let tax = 0;
  for (const row of list) {
    const upper = String(row).toUpperCase();
    if (/SUB\s*-?\s*TOTAL/.test(upper)) {
      if (!subtotal) subtotal = last(row);
      continue;
    }
    if (/\bTAX\b/.test(upper) && !/TAXABLE|TOTAL TAX|NON[- ]?TAX/.test(upper)) {
      tax = round2(tax + last(row));
      continue;
    }
    if (/^\W*(\*+\s*)?(BALANCE\s+DUE|TOTAL)\b/.test(upper.trim()) && !/SAVING|ITEMS|DISCOUNT|TAX|NUMBER/.test(upper)) {
      if (!total) total = last(row);
    }
  }
  return { subtotal: round2(subtotal), tax: round2(tax), total: round2(total) };
}

// Which line prices can't be found anywhere in the printed text. Each printed
// amount is used once, so two $3.49 lines need two $3.49s on the receipt. Lines
// whose price matches are fine; a miss is a hint, never proof (OCR can miss a row).
export function crossCheckWithOcr(receipt, rows) {
  const pool = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    for (const cents of moneyOnRow(row)) {
      const key = Math.abs(cents);
      pool.set(key, (pool.get(key) || 0) + 1);
    }
  }
  if (!pool.size) return { checked: false, unmatchedLineIds: [] };
  const unmatchedLineIds = [];
  for (const line of (receipt?.lineItems || [])) {
    const cents = Math.abs(Math.round(num(line?.totalPrice) * 100));
    if (!cents) continue;
    const left = pool.get(cents) || 0;
    if (left > 0) pool.set(cents, left - 1);
    else unmatchedLineIds.push(line.id);
  }
  return { checked: true, unmatchedLineIds };
}

// Turn per-page OCR rows into one compact transcript for the read prompt.
export function ocrTranscript(pages, maxChars = 6000) {
  const text = (Array.isArray(pages) ? pages : [])
    .map((rows, i) => [`— page ${i + 1} —`, ...(Array.isArray(rows) ? rows : [])].join("\n"))
    .join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

// Adopt the OCR's printed subtotal / tax / total where the AI's don't add up and
// the OCR's do. Digits from the phone's text recognition are exact; the AI can
// misread them. Returns the receipt unchanged when the OCR doesn't help.
export function applyOcrHeader(receipt, rows) {
  const header = ocrHeaderValues(rows);
  if (!header.total && !header.subtotal) return receipt;
  if (reconcileReceipt(receipt).ok) return receipt;
  const fields = ["subtotal", "tax", "total"].filter((k) => header[k] > 0 && round2(num(receipt?.[k])) !== header[k]);
  if (!fields.length) return receipt;
  const patched = { ...receipt };
  fields.forEach((k) => { patched[k] = header[k]; });
  return reconcileReceipt(patched).ok ? patched : receipt;
}
