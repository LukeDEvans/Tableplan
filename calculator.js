// calculator.js — the utilities menu's calculator (UTILITIES_MENU_DESIGN.md §6).
// Pure: an expression evaluator (no eval) and a key-press state machine.
//
// Keys: "0"-"9", ".", "+", "-", "*", "/", "%", "(", ")", "=", "±", "C" (clear
// entry / all), "⌫", and the scientific keys "x²", "x³", "√", "1/x", "π", "e"
// (applied to the number being typed, like the iPhone's). The expression is kept
// as text; "=" evaluates it with normal precedence and adds a line to the history.
//
// Display (iPhone style, Luke 2026-11-20): the big line shows the whole expression
// as it's typed ("12+3×2"); after "=" the expression moves to the small line above
// (`shown`) and the big line shows the result.

const OPS = { "+": 1, "-": 1, "*": 2, "/": 2 };

export function tokenize(expr) {
  const out = [];
  const s = String(expr || "").replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/\s+/g, "");
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const num = s.slice(i, j);
      if ((num.match(/\./g) || []).length > 1) throw new Error("Bad number");
      out.push({ t: "n", v: Number(num === "." ? "0" : num) });
      i = j;
      if (s[i] === "%") { out[out.length - 1].pct = true; i++; }
      continue;
    }
    if (c in OPS) {
      const prev = out[out.length - 1];
      // Unary minus: at the start, after an operator or "(".
      if (c === "-" && (!prev || prev.t === "op" || prev.t === "(")) { out.push({ t: "neg" }); i++; continue; }
      out.push({ t: "op", v: c }); i++; continue;
    }
    if (c === "(" || c === ")") { out.push({ t: c }); i++; continue; }
    throw new Error("Bad character");
  }
  return out;
}

// Percent: "50%" alone is 0.5; "200+10%" is 200 + 20 (percent of the left side),
// the way phone calculators do it.
export function evaluate(expr) {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  function primary() {
    const tk = tokens[pos++];
    if (!tk) throw new Error("Incomplete");
    if (tk.t === "neg") { const p = primary(); return -(typeof p === "number" ? p : pctOf(p)); }
    if (tk.t === "n") return tk;
    if (tk.t === "(") {
      const v = expression();
      if (peek()?.t === ")") pos++;
      return v;
    }
    throw new Error("Unexpected");
  }
  const val = (x) => (typeof x === "number" ? x : x.v);
  function term() {
    let left = val(pctOf(primary(), null));
    while (peek()?.t === "op" && OPS[peek().v] === 2) {
      const op = tokens[pos++].v;
      const right = val(pctOf(primary(), null));
      left = op === "*" ? left * right : left / right;
    }
    return left;
  }
  function expression() {
    let left = term();
    while (peek()?.t === "op" && OPS[peek().v] === 1) {
      const op = tokens[pos++].v;
      const start = pos;
      let right = term();
      // "a + b%" → b percent of a (only when the right side is a bare percentage)
      if (pos === start + 1 && tokens[start].t === "n" && tokens[start].pct) right = left * (tokens[start].v / 100);
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function pctOf(x) { return typeof x === "number" ? x : (x.pct ? x.v / 100 : x.v); }
  const result = expression();
  if (pos < tokens.length) throw new Error("Unexpected");
  if (!Number.isFinite(result)) throw new Error("Can't divide by zero");
  return result;
}

// Up to 10 significant digits, no float noise ("0.1+0.2" → "0.3").
export function formatNumber(n) {
  if (!Number.isFinite(n)) return "Error";
  if (Object.is(n, -0)) n = 0;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-9)) return n.toExponential(6).replace(/\.?0+e/, "e");
  const s = String(Number(n.toPrecision(10)));
  if (s.includes("e")) return s;
  const [int, dec] = s.split(".");
  const neg = int.startsWith("-");
  const grouped = Number(int.replace("-", "")).toLocaleString("en-US");
  return `${neg ? "-" : ""}${grouped}${dec ? `.${dec}` : ""}`;
}

export function createCalculator() {
  return { expr: "", display: "0", history: [], justEvaluated: false, shown: "" };
}

// Scientific keys that act on the number being typed (or the result after "=").
const UNARY = {
  "x²": (x) => x * x,
  "x³": (x) => x * x * x,
  "√": (x) => { if (x < 0) throw new Error("Error"); return Math.sqrt(x); },
  "1/x": (x) => { if (x === 0) throw new Error("Can't divide by zero"); return 1 / x; },
};
const CONSTANTS = { "π": Math.PI, e: Math.E };
const plainNumber = (n) => String(Number(n.toPrecision(12)));

const isOpChar = (c) => ["+", "-", "*", "/"].includes(c);

// Returns the next state (never mutates).
export function press(state, key) {
  const s = { ...state, history: state.history };
  const last = s.expr.slice(-1);
  const show = (expr) => ({ ...s, expr, display: displayFor(expr), justEvaluated: false, shown: "" });
  if (key === "C") {
    if (s.expr && !s.justEvaluated) return { ...createCalculator(), history: s.history };
    return { ...createCalculator(), history: s.history };
  }
  if (key === "⌫") return show(s.justEvaluated ? "" : s.expr.slice(0, -1));
  if (key === "=") {
    if (!s.expr) return s;
    try {
      const r = evaluate(s.expr);
      const shown = formatNumber(r);
      const line = { expr: compactExpr(s.expr), result: shown };
      return { expr: plainNumber(r), display: shown, history: [line, ...s.history].slice(0, 50), justEvaluated: true, shown: compactExpr(s.expr) };
    } catch (e) {
      return { ...s, display: e?.message === "Can't divide by zero" ? "Can't divide by 0" : "Error", justEvaluated: false, shown: compactExpr(s.expr) };
    }
  }
  if (key in UNARY || key in CONSTANTS) {
    const base = s.expr;
    const m = base.match(/(^|[+\-*/(])(-?[0-9.]+%?)$/);
    const keep = m ? base.slice(0, base.length - m[2].length) : base;
    if (key in CONSTANTS) {
      // A constant replaces the number being typed; after an operator it's added.
      if (s.justEvaluated) return show(plainNumber(CONSTANTS[key]));
      return show((m ? keep : base) + plainNumber(CONSTANTS[key]));
    }
    if (!m) return s;
    try {
      const v = UNARY[key](evaluate(m[2]));
      if (!Number.isFinite(v)) throw new Error("Error");
      const next = show(keep + plainNumber(v));
      return s.justEvaluated ? { ...next, justEvaluated: false } : next;
    } catch (e) {
      return { ...s, display: e?.message === "Can't divide by zero" ? "Can't divide by 0" : "Error" };
    }
  }
  if (/^[0-9]$/.test(key) || key === ".") {
    const base = s.justEvaluated ? "" : s.expr;
    const lastNum = (base.match(/[0-9.]*$/) || [""])[0];
    if (key === "." && lastNum.includes(".")) return s;
    if (key !== "." && lastNum === "0") return show(base.slice(0, -1) + key);
    return show(base + (key === "." && !lastNum ? "0." : key));
  }
  if (isOpChar(key)) {
    if (!s.expr) return key === "-" ? show("-") : s;
    if (isOpChar(last)) return show(s.expr.slice(0, -1) + key);
    return show(s.expr + key);
  }
  if (key === "%") {
    if (!s.expr || isOpChar(last) || last === "%" || last === "(") return s;
    return show(s.expr + "%");
  }
  if (key === "(") return show((s.justEvaluated ? "" : s.expr) + "(");
  if (key === ")") {
    const open = (s.expr.match(/\(/g) || []).length - (s.expr.match(/\)/g) || []).length;
    if (open <= 0 || isOpChar(last) || last === "(") return s;
    return show(s.expr + ")");
  }
  if (key === "±") {
    const m = s.expr.match(/(^|[+\-*/(])(-?)([0-9.]+%?)$/);
    if (!m) return s;
    const start = s.expr.length - m[2].length - m[3].length;
    const flipped = m[2] ? m[3] : `-${m[3]}`;
    // "-" right after an operator reads as a negative number ("5*-3").
    return show(s.expr.slice(0, start) + flipped);
  }
  return s;
}

export function prettyExpr(expr) {
  return String(expr || "").replace(/\*/g, " × ").replace(/\//g, " ÷ ").replace(/(\d|\)|%)\+/g, "$1 + ").replace(/(\d|\)|%)-/g, "$1 − ").replace(/\s+/g, " ").trim();
}

// One number as typed, with thousands grouped and a trailing "." or "%" kept.
function groupTyped(num) {
  const [i, d] = num.replace("%", "").split(".");
  const head = i === "" ? "0" : Number(i).toLocaleString("en-US", { maximumFractionDigits: 0 });
  return `${head}${num.includes(".") ? `.${d || ""}` : ""}${num.endsWith("%") ? "%" : ""}`;
}

// The expression the way the iPhone shows it: "12,000+3×2", "−5", no spaces.
export function compactExpr(expr) {
  return String(expr || "")
    .replace(/[0-9.]+%?/g, (n) => groupTyped(n))
    .replace(/\*/g, "×").replace(/\//g, "÷").replace(/-/g, "−");
}

// What the big display shows while typing: the whole expression.
export function displayFor(expr) {
  if (!expr) return "0";
  return compactExpr(expr).replace(/^−/, "-");
}
