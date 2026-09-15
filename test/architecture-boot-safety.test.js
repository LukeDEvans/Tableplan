import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ARCHITECTURE FITNESS — BOOT SAFETY (module-load ordering).
//
// app.js is a single ~42k-line shell whose domains have been extracted into
// `createXModule(deps)` factory modules. The factories are instantiated near the top of
// app.js and their interfaces destructured into `const {...} = _factory;` bindings. Neither
// the build (esbuild treats undeclared names as runtime globals) nor the rest of the suite
// (nothing imports/executes app.js's module body — it needs a DOM) exercises module-load
// order, so two whole classes of load-time crash have shipped silently and only surfaced in
// the browser:
//
//   • recomputeMealPlanLayout / the 9 meal-plan config fns — extracted as top-level EXPORTS
//     but they read/mutate arrays (`meals`, `prepDays`, …) that stayed injected into the
//     factory; a top-level export can't see injected deps → `meals is not defined` while
//     normalizeState() ran during `const state = loadState()` → app hung on "Checking sign-in".
//   • migrateLegacyRecipeOrganization() / migrateGroceryDescriptorNames() — bare top-level
//     statements that called a factory-provided const declared ~200 lines later →
//     "Cannot access 'X' before initialization" (TDZ) at boot.
//
// These two guards fail loudly (with the exact line) if either pattern is reintroduced.
// DO NOT weaken or delete them without understanding that history — they are the only thing
// that catches these before a browser does.

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");

// The extracted domain factory modules (each exposes `createXModule(deps)`).
const FACTORY_MODULES = [
  "contacts.js", "weather-ui.js", "inventory-ui.js", "finance-ui.js",
  "groceries-ui.js", "recipes-ui.js", "mealplan-ui.js",
];

const JS_KEYWORDS = new Set([
  "if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await",
  "async", "do", "else", "try", "finally", "throw", "delete", "void", "instanceof", "in",
  "of", "yield", "super", "this", "case", "break", "continue", "const", "let", "var",
]);

// ── (a) Export-scope guard ──────────────────────────────────────────────────────────────
// A top-level `export function` runs OUTSIDE the factory closure, so it can only see
// module-scope names (imports + top-level declarations) — never anything destructured from
// `deps`. Flag any export whose body references an injected-only name via ANY access form:
// call `x(`, property `x.y`, or mutation `x.length =` / `x.push` — the identifier itself is
// what's missing, so we scan identifier references, not just call sites (the gap that let
// `recomputeMealPlanLayout`'s `meals.length = 0` through the old call-only checker).
function scanExportScope(src) {
  const depsMatch = src.match(/const\s*\{\s*([\s\S]*?)\s*\}\s*=\s*deps;/);
  const injected = new Set();
  if (depsMatch) {
    for (let name of depsMatch[1].split(",")) {
      name = name.trim().split(":")[0].trim(); // `getX: () => ...` → getX
      if (/^\w+$/.test(name)) injected.add(name);
    }
  }
  const modscope = new Set();
  for (const m of src.matchAll(/^import\s+\*\s+as\s+(\w+)/gm)) modscope.add(m[1]);
  for (const m of src.matchAll(/^import\s+\{([^}]*)\}/gm)) {
    for (const y of m[1].split(",")) {
      const n = y.trim().split(/\s+as\s+/).pop().trim();
      if (n) modscope.add(n);
    }
  }
  for (const m of src.matchAll(/^(?:export )?function (\w+)/gm)) modscope.add(m[1]);
  for (const m of src.matchAll(/^(?:let|const|var)\s+(\w+)/gm)) modscope.add(m[1]);
  const injectedOnly = new Set([...injected].filter((n) => !modscope.has(n)));

  const findings = [];
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^export function (\w+)\(([^)]*)\)\s*\{/.exec(lines[i]);
    if (!m) continue;
    const name = m[1];
    if (/create\w+Module/.test(name)) continue; // the factory itself legitimately sees deps
    // capture the body by brace depth from this line
    let depth = 0, started = false, j = i, body = "";
    for (; j < lines.length; j++) {
      body += lines[j] + "\n";
      for (const ch of lines[j]) { if (ch === "{") { depth++; started = true; } else if (ch === "}") depth--; }
      if (started && depth <= 0) break;
    }
    const params = new Set(m[2].split(",").map((p) => p.trim().replace(/[=.].*$/, "").replace(/[{}[\]]/g, "").trim()).filter(Boolean));
    const locals = new Set(params);
    for (const lm of body.matchAll(/\b(?:let|const|var)\s+(\w+)/g)) locals.add(lm[1]);
    const refs = new Set([...body.matchAll(/\b([A-Za-z_]\w*)\b/g)].map((r) => r[1]));
    const bad = [...refs].filter((r) => injectedOnly.has(r) && !locals.has(r)).sort();
    if (bad.length) findings.push({ line: i + 1, name, refs: bad });
  }
  return findings;
}

// ── (b) Boot-reachability scan (app.js) ─────────────────────────────────────────────────
// Any code that EXECUTES during module evaluation before a factory has run must not touch
// that factory's destructured const (TDZ). "Executes at module-eval" = a top-level statement
// or a top-level `const X = <call>()` initializer (e.g. `const state = loadState()`), plus
// every top-level (hoisted) function transitively reachable from those via calls. For each
// such executing call at line L, flag any factory-destructured const it (transitively) calls
// that only becomes available at a line > L.
function scanBootReachability(src) {
  const lines = src.split("\n");

  // top-level function spans (one-liner-aware: closes on its own line if brace-balanced)
  const spans = new Map();
  const fnLines = new Set();
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:async )?function (\w+)/.exec(lines[i]);
    if (!m) continue;
    const opens = (lines[i].match(/\{/g) || []).length, closes = (lines[i].match(/\}/g) || []).length;
    let end = i;
    if (opens > 0 && opens === closes) end = i;
    else { for (let j = i + 1; j < lines.length; j++) if (lines[j] === "}") { end = j; break; } }
    if (!spans.has(m[1])) spans.set(m[1], [i, end]);
  }
  for (const [, [a, b]] of spans) for (let k = a; k <= b; k++) fnLines.add(k);
  const bodyOf = (n) => { const [a, b] = spans.get(n); return lines.slice(a, b + 1).join("\n"); };
  const calleesOf = (n) => spans.has(n)
    ? new Set([...bodyOf(n).matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)].map((r) => r[1]))
    : new Set();

  // factory-instantiation + destructure block lines (exclude: their deferred-arrow thunks
  // are not executed at instantiation), and the "available at" line for each destructured const
  const blockLines = new Set();
  const destrAt = new Map();
  for (let i = 0; i < lines.length;) {
    if (/^const _\w+ = create\w+Module\(\{/.test(lines[i])) {
      let j = i; while (j < lines.length && !/^\}\);/.test(lines[j])) j++;
      for (let k = i; k <= j; k++) blockLines.add(k);
      i = j + 1; continue;
    }
    if (/^const \{/.test(lines[i]) && !/= create/.test(lines[i])) {
      let j = i; while (j < lines.length && !/\} = _\w+;/.test(lines[j])) j++;
      if (j < lines.length && /\} = _\w+;/.test(lines[j])) {
        for (const nm of new Set([...lines.slice(i, j + 1).join("\n").matchAll(/\b([A-Za-z_]\w*)\b/g)].map((r) => r[1]))) {
          if (nm !== "const" && !destrAt.has(nm)) destrAt.set(nm, j);
        }
        for (let k = i; k <= j; k++) blockLines.add(k);
      }
      i = j + 1; continue;
    }
    i++;
  }

  // top-level executed calls: (line, funcname)
  const topcalls = [];
  for (let i = 0; i < lines.length; i++) {
    if (fnLines.has(i) || blockLines.has(i)) continue;
    const s = lines[i].trim();
    if (!s || s.startsWith("//") || s.startsWith("/*") || s.startsWith("*")) continue;
    if (/^(function|async function|const|let|var|import|export|})/.test(lines[i])) {
      // still capture the RHS of a top-level `const X = <call>()` initializer (it executes)
      const init = /^(?:const|let|var)\s+\w+\s*=\s*(.+)$/.exec(lines[i]);
      if (init) for (const c of init[1].matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)) topcalls.push([i, c[1]]);
      continue;
    }
    for (const c of lines[i].matchAll(/(?<![\w.])([A-Za-z_]\w*)\s*\(/g)) topcalls.push([i, c[1]]);
  }

  const closure = (start) => {
    const seen = new Set(), fr = [start];
    while (fr.length) {
      const n = fr.pop();
      for (const c of calleesOf(n)) if (spans.has(c) && !seen.has(c)) { seen.add(c); fr.push(c); }
    }
    return seen;
  };

  const violations = [], dedupe = new Set();
  const flag = (L, site, cnst, dl, how) => {
    const key = L + "|" + cnst;
    if (dedupe.has(key)) return;
    dedupe.add(key);
    violations.push({ line: L + 1, site, const: cnst, available: dl + 1, how });
  };
  for (const [L, c] of topcalls) {
    if (destrAt.has(c) && destrAt.get(c) > L) flag(L, "<top-level>", c, destrAt.get(c), "direct");
    if (spans.has(c)) {
      const reach = closure(c); reach.add(c);
      for (const f of reach) for (const cc of calleesOf(f))
        if (destrAt.has(cc) && destrAt.get(cc) > L) flag(L, c, cc, destrAt.get(cc), "via " + f);
    }
  }
  return violations.sort((a, b) => a.line - b.line);
}

describe("fitness: no module export references an injected-only dep (export-scope guard)", () => {
  for (const mod of FACTORY_MODULES) {
    it(`${mod} — every top-level export is closable over module scope`, () => {
      const findings = scanExportScope(read("/" + mod));
      const report = findings.map((f) => `  ${mod}:${f.line} export ${f.name}() references injected-only [${f.refs.join(", ")}]`).join("\n");
      expect(findings.length, `\nBROKEN exports (an export runs outside the factory and cannot see injected deps —\nmove it back into app.js or the factory, or stop it referencing the injected name):\n${report}\n`).toBe(0);
    });
  }
});

describe("fitness: no boot-time code touches a factory const before its factory runs", () => {
  it("app.js — module-eval + loadState/normalizeState reach no later-destructured const", () => {
    const findings = scanBootReachability(read("/app.js"));
    const report = findings.map((f) => `  app.js:${f.line} [${f.site}] -> ${f.const}() available at line ${f.available} [${f.how}]`).join("\n");
    expect(findings.length, `\nBOOT-TIME TDZ violations (executed at module-load before the factory that provides the\nconst — move the call after the factory instantiations, or move the function into app.js):\n${report}\n`).toBe(0);
  });
});
