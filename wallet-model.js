// wallet-model.js — Wallet's cards (UTILITIES_MENU_DESIGN.md §8). Pure.
//
// Membership/loyalty cards and tickets are everyday records kept in synced state:
//   Household wallet → state.walletCards          (config section, the household row)
//   Personal wallet  → state.walletCardsPersonal  (recreate section, the person's row)
// IDs are not kept here: they live in the Documents Safe (Face ID). Payment cards
// stay in Apple / Google Wallet, which Wallet links out to.

export const CARD_FORMATS = Object.freeze(["code128", "qr", "none"]);
export const CARD_KINDS = Object.freeze(["card", "ticket"]);
export const CARD_COLORS = Object.freeze(["#1f4e79", "#2e7d32", "#c62828", "#6a1b9a", "#ef6c00", "#37474f", "#00838f", "#ad1457"]);

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// The format a number reads best as: long text or a URL → QR, anything Code 128
// can hold → Code 128, else no barcode (the number is shown big instead).
export function suggestFormat(number) {
  const n = String(number ?? "").trim();
  if (!n) return "none";
  if (/^https?:\/\//i.test(n) || n.length > 40) return "qr";
  return /^[\x20-\x7e]+$/.test(n) ? "code128" : "qr";
}

export function normalizeCard(raw, { now = () => new Date().toISOString(), newId = () => `wallet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` } = {}) {
  const c = raw && typeof raw === "object" ? raw : {};
  const number = clean(c.number, 300);
  const format = CARD_FORMATS.includes(c.format) ? c.format : suggestFormat(number);
  return {
    id: c.id ? String(c.id) : newId(),
    kind: CARD_KINDS.includes(c.kind) ? c.kind : "card",
    name: clean(c.name, 80) || "Card",
    number,
    format: format === "code128" && !/^[\x20-\x7e]+$/.test(number) ? "qr" : format,
    color: CARD_COLORS.includes(c.color) ? c.color : CARD_COLORS[0],
    note: clean(c.note, 300),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || "")) ? c.date : "",
    createdAt: c.createdAt || now(),
    updatedAt: c.updatedAt || now(),
  };
}

export function normalizeCards(list) {
  return (Array.isArray(list) ? list : []).filter((c) => c && typeof c === "object" && c.id).map((c) => normalizeCard(c));
}

// Cards first by name; tickets by date (soonest first), past tickets last.
export function sortCards(list, today = new Date().toISOString().slice(0, 10)) {
  return [...(list || [])].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "card" ? -1 : 1;
    if (a.kind === "ticket") {
      const ap = a.date && a.date < today, bp = b.date && b.date < today;
      if (ap !== bp) return ap ? 1 : -1;
      return String(a.date || "9999").localeCompare(String(b.date || "9999"));
    }
    return a.name.localeCompare(b.name);
  });
}

// The wallet apps Wallet links out to, by platform. `scheme` is opened through
// link-out.js; `web` is the fallback when the app can't be opened.
export function walletApps(platform) {
  if (platform === "ios") return [{ id: "apple", label: "Open Apple Wallet", scheme: "shoebox://", web: "https://www.apple.com/wallet/" }];
  if (platform === "android") return [{ id: "google", label: "Open Google Wallet", scheme: "https://wallet.google.com/", web: "https://wallet.google.com/" }];
  return [{ id: "google", label: "Open Google Wallet", scheme: "https://wallet.google.com/", web: "https://wallet.google.com/" }];
}
