// Exact rational musical time — the canonical, resolution-free timing primitive
// for Cadence. A position's musical offset is a reduced fraction {num, den} of a
// quarter note (den > 0). This is EXACT for arbitrary tuplets (a triplet eighth
// is {1,3}, a 7-tuplet sixteenth is {1,28}) and, being resolution-independent,
// survives any reparse unchanged — the same musical location is always the same
// fraction, whatever integer resolution a given ScoreModel happens to use.
//
// Comparison and arithmetic are done with integer cross-multiplication, so there
// is no floating-point drift anywhere in the timing path. Floats appear only in
// toNumber(), which exists solely for display/geometry, never for identity.

/** Build a reduced rational {num, den}. den must be a nonzero integer. */
export function rat(num, den = 1) {
  num = Math.trunc(num); den = Math.trunc(den);
  if (den === 0) throw new Error("rational denominator must be nonzero");
  if (den < 0) { num = -num; den = -den; } // keep sign on the numerator
  const g = gcd(Math.abs(num), den) || 1;
  return { num: num / g, den: den / g };
}

export const ZERO = Object.freeze({ num: 0, den: 1 });

export function isRational(r) {
  return !!r && Number.isInteger(r.num) && Number.isInteger(r.den) && r.den > 0;
}

/** a + b (exact). */
export function add(a, b) { return rat(a.num * b.den + b.num * a.den, a.den * b.den); }
/** a - b (exact). */
export function sub(a, b) { return rat(a.num * b.den - b.num * a.den, a.den * b.den); }
/** Multiply a rational by an integer (exact) — e.g. scaling beats. */
export function mulInt(a, k) { return rat(a.num * Math.trunc(k), a.den); }

/** -1 | 0 | 1 by exact cross-multiplication (both dens are > 0). */
export function compare(a, b) {
  const l = a.num * b.den, r = b.num * a.den;
  return l < r ? -1 : l > r ? 1 : 0;
}
export function equals(a, b) { return a.num === b.num && a.den === b.den; }

/** Float value in quarter notes — DISPLAY / geometry only, never identity. */
export function toNumber(r) { return r.num / r.den; }

/**
 * Convert to an exact integer tick count at a given per-model resolution
 * (ticks per quarter). Exact when `ticksPerQuarter` is a multiple of `den`,
 * which holds by construction because a ScoreModel derives its resolution as the
 * LCM of every denominator it contains. Falls back to rounding (with a caller-
 * visible `exact:false`) for an exotic externally-authored fraction.
 */
export function toTicks(r, ticksPerQuarter) {
  const exactTicks = (r.num * ticksPerQuarter) / r.den;
  if (Number.isInteger(exactTicks)) return { ticks: exactTicks, exact: true };
  return { ticks: Math.round(exactTicks), exact: false };
}

/** Inverse: integer ticks at a resolution → reduced rational quarters. */
export function fromTicks(ticks, ticksPerQuarter) { return rat(ticks, ticksPerQuarter); }

/** Parse from a MusicXML-style (divisionsValue, divisionsPerQuarter): value/divisions quarters. */
export function fromDivisions(value, divisionsPerQuarter) { return rat(value, divisionsPerQuarter); }

/** Least common multiple of a list of positive integers (for deriving a model's resolution). */
export function lcmAll(nums) {
  return nums.reduce((acc, n) => {
    n = Math.trunc(Math.abs(n)) || 1;
    return acc / gcd(acc, n) * n;
  }, 1);
}

export function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { [a, b] = [b, a % b]; } return a; }

/** Canonical string form for use as a stable map key: "num/den". */
export function key(r) { return `${r.num}/${r.den}`; }
