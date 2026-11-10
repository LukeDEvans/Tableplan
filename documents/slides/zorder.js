// Stacking order keys (SLIDES_DESIGN.md §2): each item on a slide carries a string key;
// items are drawn in key order. A new key can always be made between two others, so
// two people bringing different things forward never rewrite each other's keys and the
// merge is clean. Base-62 fractional keys (the well-known "fractional indexing" scheme,
// written here from its description).
//
// keyBetween(a, b) → a key strictly between a and b (either may be null = open end).
// keysBetween(a, b, n) → n increasing keys between a and b.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = DIGITS[0];
const SMALLEST_INT = "A00000000000000000000000000";

const intLength = (head) => {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 97 + 2;
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2;
  throw new Error(`bad order key head: ${head}`);
};

function intPart(key) {
  const n = intLength(key[0]);
  if (n > key.length) throw new Error(`bad order key: ${key}`);
  return key.slice(0, n);
}

export function isKey(key) {
  if (typeof key !== "string" || !key || key.length > 200 || key === SMALLEST_INT) return false;
  try {
    const i = intPart(key);
    const f = key.slice(i.length);
    if (f.endsWith(ZERO)) return false;
    return [...key.slice(1)].every((c) => DIGITS.includes(c));
  } catch { return false; }
}

function midpoint(a, b) {
  // a < b as fractions (b may be null = 1); neither ends with ZERO
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (b) {
    let n = 0;
    while ((a[n] || ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const da = a ? DIGITS.indexOf(a[0]) : 0;
  const db = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (db - da > 1) return DIGITS[Math.round(0.5 * (da + db))];
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[da] + midpoint(a.slice(1), null);
}

function incrementInt(x) {
  const [head, ...digs] = x.split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) + 1;
    if (d === DIGITS.length) digs[i] = ZERO;
    else { digs[i] = DIGITS[d]; carry = false; }
  }
  if (carry) {
    if (head === "Z") return "a" + ZERO;
    if (head === "z") return null;
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > "a") digs.push(ZERO); else digs.pop();
    return h + digs.join("");
  }
  return head + digs.join("");
}

function decrementInt(x) {
  const [head, ...digs] = x.split("");
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digs[i]) - 1;
    if (d === -1) digs[i] = DIGITS[DIGITS.length - 1];
    else { digs[i] = DIGITS[d]; borrow = false; }
  }
  if (borrow) {
    if (head === "a") return "Z" + DIGITS[DIGITS.length - 1];
    if (head === "A") return null;
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < "Z") digs.push(DIGITS[DIGITS.length - 1]); else digs.pop();
    return h + digs.join("");
  }
  return head + digs.join("");
}

export function keyBetween(a = null, b = null) {
  if (a !== null && !isKey(a)) throw new Error(`bad order key: ${a}`);
  if (b !== null && !isKey(b)) throw new Error(`bad order key: ${b}`);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a === null) {
    if (b === null) return "a" + ZERO;
    const ib = intPart(b);
    const fb = b.slice(ib.length);
    if (ib === SMALLEST_INT) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const r = decrementInt(ib);
    if (r === null) throw new Error("cannot go lower");
    return r;
  }
  if (b === null) {
    const ia = intPart(a);
    const fa = a.slice(ia.length);
    const i = incrementInt(ia);
    return i === null ? ia + midpoint(fa, null) : i;
  }
  const ia = intPart(a);
  const fa = a.slice(ia.length);
  const ib = intPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const i = incrementInt(ia);
  if (i === null) throw new Error("cannot go higher");
  if (i < b) return i;
  return ia + midpoint(fa, null);
}

export function keysBetween(a, b, n) {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(a, b)];
  if (b === null) {
    let c = keyBetween(a, b);
    const out = [c];
    for (let i = 1; i < n; i++) { c = keyBetween(c, b); out.push(c); }
    return out;
  }
  if (a === null) {
    let c = keyBetween(a, b);
    const out = [c];
    for (let i = 1; i < n; i++) { c = keyBetween(a, c); out.push(c); }
    return out.reverse();
  }
  const mid = Math.floor(n / 2);
  const c = keyBetween(a, b);
  return [...keysBetween(a, c, mid), c, ...keysBetween(c, b, n - mid - 1)];
}

// Sorts [{ id, z }] by key, ties (two people picked the same key) by id so every device
// draws the same order.
export const byZ = (a, b) => (a.z < b.z ? -1 : a.z > b.z ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
