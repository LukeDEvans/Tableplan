// The password generator and the strength check (PASSWORDS_DESIGN.md §3, §5).
//
// generatePassword draws from crypto.getRandomValues with rejection sampling, so every
// character is equally likely, and makes sure each chosen kind of character appears.
// Characters that are easy to misread (0 O o, 1 l I) can be left out.
//
// estimateBits is a deliberately simple strength estimate (no 800 KB dictionary):
// the length times the size of the character pool it draws from, with penalties for
// repeats, runs and very common passwords. "Weak" is under 50 bits or under 10
// characters — Needs attention flags those.

const SETS = {
  lower: "abcdefghijkmnpqrstuvwxyz",
  upper: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  digits: "23456789",
  symbols: "!#$%&*+-=?@^_~",
};
const AMBIGUOUS = { lower: "lo", upper: "IO", digits: "01" };

function randomIndex(n) {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

export const GENERATOR_DEFAULTS = Object.freeze({ length: 20, lower: true, upper: true, digits: true, symbols: true, ambiguous: false });

export function generatePassword(opts = {}) {
  const o = { ...GENERATOR_DEFAULTS, ...opts };
  const length = Math.min(128, Math.max(8, Math.floor(Number(o.length) || 20)));
  const kinds = ["lower", "upper", "digits", "symbols"].filter((k) => o[k]);
  if (!kinds.length) kinds.push("lower");
  const pools = kinds.map((k) => SETS[k] + (o.ambiguous ? AMBIGUOUS[k] || "" : ""));
  const all = pools.join("");
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += all[randomIndex(all.length)];
    if (pools.every((p) => [...out].some((c) => p.includes(c)))) return out;
  }
}

const COMMON = new Set([
  "password", "123456", "12345678", "123456789", "qwerty", "abc123", "111111", "letmein", "iloveyou",
  "admin", "welcome", "monkey", "dragon", "football", "baseball", "sunshine", "princess", "trustno1",
  "passw0rd", "password1", "qwerty123", "1q2w3e4r", "000000", "654321", "superman", "master",
]);

export function estimateBits(pw) {
  const s = String(pw || "");
  if (!s) return 0;
  if (COMMON.has(s.toLowerCase())) return 4;
  let pool = 0;
  if (/[a-z]/.test(s)) pool += 26;
  if (/[A-Z]/.test(s)) pool += 26;
  if (/[0-9]/.test(s)) pool += 10;
  if (/[^A-Za-z0-9]/.test(s)) pool += 33;
  // Count characters that add little: repeats of the previous one and steps of a run
  // (abc, 321).
  let weak = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d === 0 || d === 1 || d === -1) weak++;
  }
  const effective = s.length - weak * 0.75;
  const bits = Math.round(effective * Math.log2(Math.max(pool, 2)));
  // A word with a number (and maybe a symbol) on the end — "Summer2024!" — is the
  // most guessed shape there is; treat short ones as weak whatever the pool says.
  if (s.length < 14 && /^[A-Za-z][a-z]+\d{1,4}[^A-Za-z0-9]?$/.test(s)) return Math.min(bits, 40);
  return bits;
}

export function isWeak(pw) {
  const s = String(pw || "");
  return s.length < 10 || estimateBits(s) < 50;
}

export function strengthLabel(pw) {
  const b = estimateBits(pw);
  if (!pw) return "";
  if (isWeak(pw)) return "Weak";
  if (b < 80) return "Good";
  return "Strong";
}
