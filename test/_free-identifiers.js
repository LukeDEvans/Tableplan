// Scope-aware free-identifier finder for the architecture guard in
// architecture-injected-names.test.js. Given a module's source, returns every
// identifier a function body *references* that no enclosing scope (the
// function's own locals/params, any enclosing function, or module top level)
// declares. It is deliberately simple: declarations are hoisted to their whole
// function (a let in one block counts for the whole function), which can only
// hide a finding, never invent one.
import { parseAst } from "rollup/parseAst";

function patternNames(p, out) {
  if (!p) return out;
  switch (p.type) {
    case "Identifier": out.push(p.name); break;
    case "ObjectPattern": for (const prop of p.properties) patternNames(prop.type === "RestElement" ? prop.argument : prop.value, out); break;
    case "ArrayPattern": for (const el of p.elements) patternNames(el, out); break;
    case "RestElement": patternNames(p.argument, out); break;
    case "AssignmentPattern": patternNames(p.left, out); break;
  }
  return out;
}

const FN = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

// Names declared inside `body` without crossing into nested functions
// (a nested function's own name still counts: it's declared in this scope).
function declaredIn(body, names = new Set()) {
  const stack = [body];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (n.type === "VariableDeclaration") for (const d of n.declarations) patternNames(d.id, []).forEach((x) => names.add(x));
    if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) names.add(n.id.name);
    if (n.type === "CatchClause" && n.param) patternNames(n.param, []).forEach((x) => names.add(x));
    if (n.type === "ImportDeclaration") for (const s of n.specifiers) names.add(s.local.name);
    if (n !== body && FN.has(n.type)) continue;
    if (n.type === "ClassExpression" && n.id) names.add(n.id.name);
    for (const k of Object.keys(n)) {
      if (k === "parent") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && stack.push(c));
      else if (v && typeof v.type === "string") stack.push(v);
    }
  }
  return names;
}

function fnScope(fn) {
  const names = new Set();
  for (const p of fn.params) patternNames(p, []).forEach((x) => names.add(x));
  if (fn.type === "FunctionExpression" && fn.id) names.add(fn.id.name);
  declaredIn(fn.body, names);
  return names;
}

// Walk `root`, reporting Identifier references not bound in `scopes` (+ nested
// function scopes pushed on the way down). Returns [{ name, start }].
function freeRefs(root, scopes) {
  const found = [];
  const bound = (name, st) => st.some((s) => s.has(name));
  function visit(n, st) {
    if (!n || typeof n.type !== "string") return;
    if (FN.has(n.type)) {
      const s = [...st, fnScope(n)];
      for (const p of n.params) visitPattern(p, s);
      visit(n.body, s);
      return;
    }
    if (n.type === "CatchClause") {
      const s = n.param ? [...st, new Set(patternNames(n.param, []))] : st;
      visit(n.body, s);
      return;
    }
    switch (n.type) {
      case "Identifier": if (!bound(n.name, st)) found.push({ name: n.name, start: n.start }); return;
      case "MemberExpression": visit(n.object, st); if (n.computed) visit(n.property, st); return;
      case "Property": if (n.computed) visit(n.key, st); visit(n.value, st); return;
      case "MethodDefinition": case "PropertyDefinition": if (n.computed) visit(n.key, st); visit(n.value, st); return;
      case "LabeledStatement": visit(n.body, st); return;
      case "BreakStatement": case "ContinueStatement": return;
      case "VariableDeclarator": visitPattern(n.id, st); visit(n.init, st); return;
      case "FunctionDeclaration": return; // handled via FN above
      case "ClassDeclaration": case "ClassExpression": visit(n.superClass, st); visit(n.body, st); return;
      case "MetaProperty": return;
      case "ImportDeclaration": case "ExportAllDeclaration": return;
      case "ExportNamedDeclaration": visit(n.declaration, st); return;
      case "ExportSpecifier": return;
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach((c) => visit(c, st));
      else if (v && typeof v.type === "string") visit(v, st);
    }
  }
  // Binding positions aren't references, but default values and computed keys are.
  function visitPattern(p, st) {
    if (!p) return;
    switch (p.type) {
      case "Identifier": return;
      case "ObjectPattern": for (const prop of p.properties) { if (prop.type === "RestElement") visitPattern(prop.argument, st); else { if (prop.computed) visit(prop.key, st); visitPattern(prop.value, st); } } return;
      case "ArrayPattern": p.elements.forEach((e) => visitPattern(e, st)); return;
      case "RestElement": visitPattern(p.argument, st); return;
      case "AssignmentPattern": visitPattern(p.left, st); visit(p.right, st); return;
      default: visit(p, st); // e.g. a MemberExpression target in a for-in
    }
  }
  visit(root, scopes);
  return found;
}

// Free identifiers inside each `export function create*Module(deps)` body:
// names the factory uses that are neither its own locals, destructured deps,
// nor module top-level declarations/imports.
export function factoryFreeIdentifiers(source) {
  const ast = parseAst(source);
  const moduleScope = declaredIn(ast);
  const results = [];
  for (const node of ast.body) {
    const fn = node.type === "ExportNamedDeclaration" ? node.declaration : node;
    if (fn?.type !== "FunctionDeclaration" || !/^create\w*Module$/.test(fn.id?.name || "")) continue;
    const refs = freeRefs(fn, [moduleScope]);
    results.push({ factory: fn.id.name, refs });
  }
  return results;
}

export function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i++) if (source.charCodeAt(i) === 10) line++;
  return line;
}
