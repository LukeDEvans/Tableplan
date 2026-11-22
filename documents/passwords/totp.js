// 2FA codes (RFC 6238 TOTP over RFC 4226 HOTP), with WebCrypto's HMAC.
//
// A login's `totp` field holds either an otpauth:// address (what the QR code and the
// iCloud export carry) or a bare base32 secret. parseTotp reads both; only TOTP is
// supported (HOTP counters would need writing back on every use).

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const ALGS = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error("2FA: the secret isn't base32");
  const out = [];
  let bits = 0, value = 0;
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  if (out.length < 10) throw new Error("2FA: the secret is too short");
  return Uint8Array.from(out);
}

// → { secret: Uint8Array, digits, period, algorithm, issuer, account }
export function parseTotp(v) {
  const s = String(v || "").trim();
  if (!s) throw new Error("2FA: empty");
  if (/^otpauth:/i.test(s)) {
    let u;
    try { u = new URL(s); } catch { throw new Error("2FA: bad otpauth address"); }
    if (u.host.toLowerCase() !== "totp") throw new Error("2FA: only time-based codes are supported");
    const p = u.searchParams;
    const label = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const [labelIssuer, account] = label.includes(":") ? label.split(/:(.*)/s) : ["", label];
    const digits = Number(p.get("digits") || 6);
    const period = Number(p.get("period") || 30);
    const algorithm = (p.get("algorithm") || "SHA1").toUpperCase();
    if (![6, 7, 8].includes(digits)) throw new Error("2FA: unsupported digits");
    if (!Number.isInteger(period) || period < 10 || period > 300) throw new Error("2FA: unsupported period");
    if (!ALGS[algorithm]) throw new Error("2FA: unsupported algorithm");
    return { secret: base32Decode(p.get("secret") || ""), digits, period, algorithm, issuer: p.get("issuer") || labelIssuer || "", account: account || "" };
  }
  return { secret: base32Decode(s), digits: 6, period: 30, algorithm: "SHA1", issuer: "", account: "" };
}

export function isValidTotp(v) {
  try { parseTotp(v); return true; } catch { return false; }
}

export async function hotp(secret, counter, { digits = 6, algorithm = "SHA1" } = {}) {
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: ALGS[algorithm] }, false, ["sign"]);
  const msg = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) { msg[i] = Number(c & 0xffn); c >>= 8n; }
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const off = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

// → { code, remaining } for the time `nowMs`.
export async function totpNow(v, nowMs = Date.now()) {
  const t = typeof v === "string" ? parseTotp(v) : v;
  const step = Math.floor(nowMs / 1000 / t.period);
  const code = await hotp(t.secret, step, t);
  return { code, remaining: t.period - (Math.floor(nowMs / 1000) % t.period), period: t.period };
}
