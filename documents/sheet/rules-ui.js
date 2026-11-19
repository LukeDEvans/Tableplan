// Rules on cells on screen (SPREADSHEET_DESIGN.md §5): the Conditional formatting and
// Data validation panels, ticking checkboxes, picking from dropdowns, the help hint on
// the active cell, and refusing a value a "reject" rule doesn't allow. Logic is in
// rules.js; storage model.js ("rules:<tab>"); custom formulas run in the worker.
//
//   const rx = createRulesUI({ root, model, engine, st, schedule, toast, isPhone, colors, cellRect, scroller, openMenu });
//   rx.compiled()            this draw's rules for the grid (rebuilt when anything changes)
//   rx.pointer(h, e)         a click on a checkbox or a dropdown arrow → true if handled
//   rx.key(e)                space ticks a checkbox → true if handled
//   rx.refuse(tab, r, c, text)  the message if a "reject" rule refuses this input, else null
//   rx.hint()                show / hide the help text under the active cell
//   rx.openFormatting()  rx.openValidation()  rx.close()  rx.destroy()

import { compileRules, rangeFromA1, rangeToA1, rangeBounds, describeRule, checkboxValues, isValid, NUMBER_OPS, TEXT_OPS, DATE_OPS } from "./rules.js";
import { CONDITIONS, conditionOf } from "./filters.js";
import { displayOf } from "./grid.js";
import { storedFromText, formulaText } from "./engine/binding.js";
import { parseTyped } from "./engine/values.js";

// Colours come from the shared document: only #rrggbb ever reaches HTML.
const safeColor = (c) => (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : null);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const DEFAULT_STYLE = { fill: "#b7e1cd" }; // Sheets' default: light green
const SCALE_DEFAULT = { min: { type: "min", color: "#ffffff" }, mid: { type: "none", color: "#ffd666" }, max: { type: "max", color: "#57bb8a" } };
const VALID_TYPES = [["list", "Dropdown"], ["range", "Dropdown (from a range)"], ["checkbox", "Checkbox"], ["number", "Number"], ["text", "Text"], ["date", "Date"], ["formula", "Custom formula is"]];

export function createRulesUI({ root, model, engine, st, schedule, toast = () => {}, isPhone = () => false, colors = [], cellRect, scroller, openMenu }) {
  // ---- redraw when rules change -------------------------------------------------------------
  const ruleTypes = new WeakMap();
  const isRuleType = (type) => {
    if (ruleTypes.has(type)) return ruleTypes.get(type);
    let yes = false;
    for (const [n, t] of model.ydoc.share) if (t === type) { yes = n.startsWith("rules:"); break; }
    ruleTypes.set(type, yes);
    return yes;
  };
  const onTx = (tr) => { for (const type of tr.changed.keys()) if (isRuleType(type)) { schedule(); if (panel) renderPanel(); return; } };
  model.ydoc.on("afterTransaction", onTx);

  // ---- the compiled rules for drawing ---------------------------------------------------------
  const plain = (tab, r, c) => { const d = displayOf(model, engine, tab, r, c); return { text: d.text, value: d.value }; };
  function optionsOf(rule) {
    const src = rule.source;
    if (!src || !model.tabIds().includes(src.tab)) return [];
    const b = rangeBounds(model, src.tab, src);
    if (!b) return [];
    const out = new Set();
    for (let r = b.r1; r <= b.r2 && out.size < 500; r++) for (let c = b.c1; c <= b.c2; c++) { const t = plain(src.tab, r, c).text; if (t !== "") out.add(t); }
    return [...out];
  }
  let current = null;
  function compiled() {
    current = compileRules(model, st.tab, { cellInfo: (r, c) => plain(st.tab, r, c), hits: (id) => engine.ruleHits?.(id) || null, optionsOf });
    return current;
  }
  const checkAt = (r, c) => current?.check(r, c, plain(st.tab, r, c));

  // ---- checkboxes and dropdowns ---------------------------------------------------------------
  function toggleBox(r, c, rule) {
    const { on, off } = checkboxValues(rule);
    const v = engine.valueAt(st.tab, r, c);
    const isOn = typeof on === "string" && typeof v === "string" ? on.toLowerCase() === v.toLowerCase() : v === on;
    const next = isOn ? off : on;
    model.setInput(st.tab, r, c, typeof next === "boolean" ? (next ? "TRUE" : "FALSE") : String(next));
    schedule();
  }
  function openDropdown(r, c, chk) {
    const R = cellRect(r, c), sb = scroller.getBoundingClientRect();
    const cur = plain(st.tab, r, c).text;
    const items = (chk.options || []).map((o) => ({ label: `${o === cur ? "✓ " : ""}${o}`, run: () => { model.setInput(st.tab, r, c, o); schedule(); } }));
    if (!items.length) items.push({ label: "No options", disabled: true });
    if (cur) items.push({ sep: true }, { label: "Clear", run: () => { model.clearRange(st.tab, r, c, r, c); schedule(); } });
    openMenu(items, { x: sb.left + R.x, y: sb.top + R.y + R.h + 2 });
  }
  // pointer(h): act on a click on a checkbox or dropdown arrow; wants(h): would it?
  function pointer(h, dry = false) {
    if (h.inRowHead || h.inColHead || !current || current.empty) return false;
    const chk = checkAt(h.r, h.c);
    if (!chk?.rule) return false;
    const R = cellRect(h.r, h.c);
    if (chk.rule.type === "checkbox" && chk.valid) {
      const b = 12 * (st.zoom || 1) + 8, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
      if (Math.abs(h.x - cx) <= b / 2 + 2 && Math.abs(h.y - cy) <= b / 2 + 2) { if (!dry) toggleBox(h.r, h.c, chk.rule); return true; }
      return false;
    }
    if ((chk.rule.type === "list" || chk.rule.type === "range") && chk.rule.display !== "plain" && h.x >= R.x + R.w - 18 * (st.zoom || 1)) {
      if (!dry) openDropdown(h.r, h.c, chk);
      return true;
    }
    return false;
  }
  function key(e) {
    if (e.key !== " " || !current || current.empty) return false;
    const chk = checkAt(st.sel.r, st.sel.c);
    if (chk?.rule?.type !== "checkbox") return false;
    e.preventDefault();
    const s = st.sel;
    for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) { const k = checkAt(r, c); if (k?.rule?.type === "checkbox") toggleBox(r, c, k.rule); }
    return true;
  }
  // A dropdown cell opens its list on Enter / double-tap instead of the text editor.
  function dropdownAt(r, c) {
    const chk = current && !current.empty ? checkAt(r, c) : null;
    return chk?.rule && (chk.rule.type === "list" || chk.rule.type === "range") && chk.rule.display !== "plain" ? chk : null;
  }
  function openDropdownAt(r, c) { const chk = dropdownAt(r, c); if (chk) openDropdown(r, c, chk); return Boolean(chk); }

  // ---- refusing input ------------------------------------------------------------------------
  function refuse(tab, r, c, text) {
    if (tab !== st.tab || !current || current.empty || String(text).startsWith("=")) return null; // a formula is checked once it has a value
    const v = current.validationAt(r, c);
    if (!v?.rule?.reject || v.rule.type === "formula") return null;
    const typed = parseTyped(String(text));
    const value = typed && typeof typed === "object" && "value" in typed ? typed.value : typed;
    const ok = isValid(v.rule, { value: value === "" ? null : value, text: String(text) }, { options: v.options });
    return ok ? null : (v.rule.help || describeRule(v.rule));
  }

  // ---- help text under the active cell ---------------------------------------------------------
  const hintEl = document.createElement("div");
  hintEl.className = "sh-hint";
  hintEl.hidden = true;
  root.querySelector(".sh-body").appendChild(hintEl);
  function hint() {
    const chk = current && !current.empty && !st.editing ? checkAt(st.sel.r, st.sel.c) : null;
    const text = chk?.rule ? (!chk.valid ? `Invalid: ${chk.rule.help || describeRule(chk.rule)}` : chk.rule.help || "") : "";
    hintEl.hidden = !text;
    if (!text) return;
    hintEl.textContent = text;
    hintEl.classList.toggle("is-bad", !chk.valid);
    const R = cellRect(st.sel.r, st.sel.c);
    hintEl.style.left = `${Math.max(4, R.x)}px`;
    hintEl.style.top = `${R.y + R.h + 4}px`;
  }

  // ---- the panels ------------------------------------------------------------------------------
  let panel = null, mode = null, editing = null; // editing: { id|null, rule }
  function close() {
    if (!panel) return;
    panel.remove(); panel = null; mode = null; editing = null;
    root.classList.remove("has-side-panel");
  }
  function open(m) {
    close();
    mode = m;
    panel = document.createElement("aside");
    panel.className = `sh-rules${isPhone() ? " is-sheet" : ""}`;
    panel.setAttribute("aria-label", m === "format" ? "Conditional formatting" : "Data validation");
    root.appendChild(panel);
    root.classList.add("has-side-panel");
    if (!isPhone()) { const body = root.querySelector(".sh-body"); panel.style.top = `${body.offsetTop}px`; panel.style.bottom = `${Math.max(0, root.clientHeight - body.offsetTop - body.offsetHeight)}px`; }
    panel.addEventListener("click", onClick);
    panel.addEventListener("change", onChange);
    // a rule covering the selection opens for editing; otherwise a new one for the selection
    const sel = st.sel;
    const mine = model.rulesOf(st.tab).filter((r) => r.kind === (m === "format" ? "format" : "valid"));
    const covering = mine.filter((r) => (r.ranges || []).some((rg) => { const b = rangeBounds(model, st.tab, rg); return b && sel.r >= b.r1 && sel.r <= b.r2 && sel.c >= b.c1 && sel.c <= b.c2; }));
    if (m === "valid" && covering.length) editing = { id: covering[covering.length - 1].id, rule: covering[covering.length - 1] };
    else if (!mine.length || m === "valid") startNew();
    renderPanel();
  }
  const selA1 = () => { const s = st.sel; const rows = model.rowIds(st.tab), cols = model.colIds(st.tab); return rangeToA1(model, st.tab, { top: rows[s.r1], bottom: rows[s.r2], left: cols[s.c1], right: cols[s.c2] }); };
  function startNew() {
    editing = mode === "format"
      ? { id: null, rule: { kind: "format", type: "single", ranges: null, cond: { op: "notEmpty" }, style: { ...DEFAULT_STYLE } }, a1: selA1() }
      : { id: null, rule: { kind: "valid", type: "list", ranges: null, items: [], display: "chip" }, a1: selA1() };
  }

  const swatches = (key, cur) => `<div class="sh-row sh-colors">${colors.map((c) => `<button type="button" class="sh-swatch${(cur || "").toLowerCase() === c.toLowerCase() ? " is-on" : ""}" style="background:${c}" data-rx-color="${key}" data-c="${c}" aria-label="${key} ${c}"></button>`).join("")}<button type="button" class="sh-link" data-rx-color="${key}" data-c="">None</button></div>`;
  const opts = (list, cur) => list.map(([k, l]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
  const ftext = (stored) => { try { return stored ? formulaText(stored, model.grid, st.tab) : ""; } catch { return ""; } };

  function ruleSummary(r) {
    const where = (r.ranges || []).map((rg) => rangeToA1(model, st.tab, rg)).join(", ");
    if (r.kind === "valid") return { what: `${VALID_TYPES.find(([k]) => k === r.type)?.[1] || r.type}${r.type === "list" ? `: ${(r.items || []).slice(0, 4).join(", ")}` : ""}`, where };
    if (r.type === "scale") return { what: "Colour scale", where };
    const c = r.cond || {};
    const what = c.op === "formula" ? `Custom formula: ${ftext(c.f)}` : `${conditionOf(c.op)?.label || c.op}${c.a ? ` ${c.a}` : ""}${c.b ? ` and ${c.b}` : ""}`;
    return { what, where };
  }
  function preview(r) {
    if (r.kind !== "format") return "";
    if (r.type === "scale") { const mid = r.mid && r.mid.type !== "none" && safeColor(r.mid.color); return `<span class="sh-rx-prev" style="background:linear-gradient(90deg,${safeColor(r.min?.color) || "#ffffff"},${mid ? `${mid},` : ""}${safeColor(r.max?.color) || "#ffffff"})"></span>`; }
    const s = r.style || {};
    return `<span class="sh-rx-prev" style="background:${safeColor(s.fill) || "transparent"};color:${safeColor(s.color) || "inherit"};font-weight:${s.bold ? 700 : 400};font-style:${s.italic ? "italic" : "normal"};text-decoration:${[s.underline && "underline", s.strike && "line-through"].filter(Boolean).join(" ") || "none"}">123</span>`;
  }

  function renderPanel() {
    if (!panel) return;
    const kind = mode === "format" ? "format" : "valid";
    const title = mode === "format" ? "Conditional format rules" : "Data validation rules";
    const head = `<div class="sh-rx-head"><strong>${title}</strong><button type="button" class="sh-icon" data-rx="close" aria-label="Close">✕</button></div>`;
    if (!editing) {
      const list = model.rulesOf(st.tab).filter((r) => r.kind === kind);
      panel.innerHTML = `${head}<div class="sh-rx-list">${list.map((r, i) => { const s = ruleSummary(r); return `<div class="sh-rx-item" data-rx-edit="${esc(r.id)}" role="button" tabindex="0">${preview(r)}<span class="sh-rx-text"><span>${esc(s.what)}</span><small>${esc(s.where)}</small></span>${kind === "format" ? `<button type="button" class="sh-icon" data-rx-up="${esc(r.id)}" aria-label="Move up" ${i === 0 ? "disabled" : ""}>↑</button><button type="button" class="sh-icon" data-rx-down="${esc(r.id)}" aria-label="Move down" ${i === list.length - 1 ? "disabled" : ""}>↓</button>` : ""}<button type="button" class="sh-icon" data-rx-del="${esc(r.id)}" aria-label="Delete rule">🗑</button></div>`; }).join("") || `<p class="sh-rx-empty">No rules on this tab yet.</p>`}</div>
        <button type="button" class="sh-btn" data-rx="add">+ Add ${list.length ? "another " : "a "}rule</button>`;
      return;
    }
    const r = editing.rule;
    const a1 = editing.a1 ?? (r.ranges || []).map((rg) => rangeToA1(model, st.tab, rg)).join(", ");
    let body = `<label class="sh-rx-field">Apply to range<input type="text" data-rx-range value="${esc(a1)}" spellcheck="false"></label>`;
    if (kind === "format") {
      body += `<div class="sh-sheet-tabs sh-rx-tabs"><button type="button" data-rx-type="single" class="${r.type !== "scale" ? "is-on" : ""}">Single colour</button><button type="button" data-rx-type="scale" class="${r.type === "scale" ? "is-on" : ""}">Colour scale</button></div>`;
      if (r.type !== "scale") {
        const c = r.cond || {};
        const n = c.op === "formula" ? 1 : conditionOf(c.op)?.n ?? 0;
        body += `<label class="sh-rx-field">Format cells if…<select data-rx-op>${CONDITIONS.map((x) => (x.sep ? `<option disabled>──────────</option>` : `<option value="${x.op}" ${x.op === c.op ? "selected" : ""}>${esc(x.label)}</option>`)).join("")}<option value="formula" ${c.op === "formula" ? "selected" : ""}>Custom formula is</option></select></label>
          ${n >= 1 ? `<input type="text" data-rx-a value="${esc(c.op === "formula" ? editing.ftext ?? ftext(c.f) : c.a ?? "")}" placeholder="${c.op === "formula" ? "=B2>100" : conditionOf(c.op)?.date ? "today, tomorrow or a date" : "Value"}" spellcheck="false">` : ""}
          ${n >= 2 ? `<input type="text" data-rx-b value="${esc(c.b ?? "")}" placeholder="and">` : ""}
          ${c.op === "formula" ? `<p class="sh-rx-note">Write it for the range's top-left cell; it moves along the range like a filled formula. Use $ to keep a reference still.</p>` : ""}
          <div class="sh-rx-field">Formatting style <span class="sh-rx-sample">${preview(r)}</span></div>
          <div class="sh-row">${["bold", "italic", "underline", "strike"].map((k) => `<button type="button" class="sh-chip${r.style?.[k] ? " is-on" : ""}" data-rx-style="${k}">${{ bold: "<b>B</b>", italic: "<i>I</i>", underline: "<u>U</u>", strike: "<s>S</s>" }[k]}</button>`).join("")}</div>
          <div class="sh-rx-sub">Text colour</div>${swatches("color", r.style?.color)}
          <div class="sh-rx-sub">Fill colour</div>${swatches("fill", r.style?.fill)}`;
      } else {
        const point = (k, label, types) => { const p = r[k] || {}; return `<div class="sh-rx-point"><span>${label}</span><select data-rx-pt="${k}">${opts(types, p.type)}</select>${p.type && !["min", "max", "none"].includes(p.type) ? `<input type="text" data-rx-ptv="${k}" value="${esc(p.v ?? "")}" inputmode="decimal">` : ""}<input type="color" data-rx-ptc="${k}" value="${safeColor(p.color) || "#ffffff"}" aria-label="${label} colour" ${p.type === "none" ? "disabled" : ""}></div>`; };
        body += point("min", "Minpoint", [["min", "Min value"], ["num", "Number"], ["pct", "Percent"], ["percentile", "Percentile"]])
          + point("mid", "Midpoint", [["none", "None"], ["num", "Number"], ["pct", "Percent"], ["percentile", "Percentile"]])
          + point("max", "Maxpoint", [["max", "Max value"], ["num", "Number"], ["pct", "Percent"], ["percentile", "Percentile"]])
          + `<div class="sh-rx-field">Preview <span class="sh-rx-sample">${preview(r)}</span></div>`;
      }
    } else {
      body += `<label class="sh-rx-field">Criteria<select data-rx-vtype>${opts(VALID_TYPES, r.type)}</select></label>`;
      if (r.type === "list") body += `<label class="sh-rx-field">Items (one per line)<textarea data-rx-items rows="4">${esc((r.items || []).join("\n"))}</textarea></label>`;
      if (r.type === "range") body += `<label class="sh-rx-field">Range with the items<input type="text" data-rx-source value="${esc(editing.srcText ?? sourceText(r.source))}" placeholder="Sheet1!A1:A10" spellcheck="false"></label>`;
      if (r.type === "list" || r.type === "range") body += `<label class="sh-rx-field">Show as<select data-rx-display>${opts([["chip", "Chip"], ["arrow", "Arrow"], ["plain", "Plain text"]], r.display || "chip")}</select></label>`;
      if (r.type === "checkbox") body += `<label class="sh-rx-field">Ticked value<input type="text" data-rx-checked value="${esc(r.checked ?? "")}" placeholder="TRUE"></label><label class="sh-rx-field">Unticked value<input type="text" data-rx-unchecked value="${esc(r.unchecked ?? "")}" placeholder="FALSE"></label>`;
      const two = (ops) => { const op = r.op || ops[0][0]; return `<select data-rx-vop>${opts(ops, op)}</select>${op !== "valid" && op !== "email" && op !== "url" ? `<input type="text" data-rx-va value="${esc(r.a ?? "")}" placeholder="Value">` : ""}${/between/i.test(op) ? `<input type="text" data-rx-vb value="${esc(r.b ?? "")}" placeholder="and">` : ""}`; };
      if (r.type === "number") body += two(NUMBER_OPS);
      if (r.type === "text") body += two(TEXT_OPS);
      if (r.type === "date") body += two(DATE_OPS);
      if (r.type === "formula") body += `<input type="text" data-rx-vf value="${esc(editing.ftext ?? ftext(r.f))}" placeholder="=ISEVEN(A1)" spellcheck="false"><p class="sh-rx-note">Write it for the range's top-left cell; TRUE means the value is fine.</p>`;
      body += `<label class="sh-rx-field">Help text (optional)<input type="text" data-rx-help value="${esc(r.help ?? "")}" maxlength="300"></label>
        <fieldset class="sh-rx-field"><legend>If the data is invalid</legend>
          <label><input type="radio" name="rx-reject" data-rx-reject="0" ${r.reject ? "" : "checked"}> Show a warning</label>
          <label><input type="radio" name="rx-reject" data-rx-reject="1" ${r.reject ? "checked" : ""}> Reject the input</label></fieldset>`;
    }
    panel.innerHTML = `${head}<div class="sh-rx-edit">${body}</div><div class="sh-rx-foot">${editing.id ? `<button type="button" class="sh-btn" data-rx="remove">Remove rule</button>` : `<button type="button" class="sh-btn" data-rx="back">Cancel</button>`}<button type="button" class="sh-btn is-primary" data-rx="done">Done</button></div>`;
  }
  const sourceText = (src) => (src && model.tabIds().includes(src.tab) ? `${quoteTab(model.tabInfo(src.tab).name)}!${rangeToA1(model, src.tab, src)}` : "");
  const quoteTab = (n) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(n) ? n : `'${n.replace(/'/g, "''")}'`);
  function sourceFrom(text) {
    const t = String(text || "").trim();
    const bang = t.lastIndexOf("!");
    let tab = st.tab, rest = t;
    if (bang > 0) {
      const name = t.slice(0, bang).replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
      tab = model.tabIds().find((id) => model.tabInfo(id).name.toLowerCase() === name.toLowerCase());
      if (!tab) return null;
      rest = t.slice(bang + 1);
    }
    const rg = rangeFromA1(model, tab, rest);
    return rg ? { tab, ...rg } : null;
  }

  // read the editor's inputs into editing.rule (without saving)
  function readInputs() {
    if (!editing || !panel) return;
    const q = (s) => panel.querySelector(s);
    const r = editing.rule;
    if (q("[data-rx-range]")) editing.a1 = q("[data-rx-range]").value;
    if (r.kind === "format" && r.type !== "scale") {
      if (q("[data-rx-a]")) { if (r.cond.op === "formula") editing.ftext = q("[data-rx-a]").value; else r.cond.a = q("[data-rx-a]").value; }
      if (q("[data-rx-b]")) r.cond.b = q("[data-rx-b]").value;
    }
    if (r.kind === "format" && r.type === "scale") for (const k of ["min", "mid", "max"]) { const v = q(`[data-rx-ptv=${k}]`); if (v) r[k] = { ...r[k], v: v.value }; }
    if (r.kind === "valid") {
      if (q("[data-rx-items]")) r.items = q("[data-rx-items]").value.split("\n").map((x) => x.trim()).filter(Boolean);
      if (q("[data-rx-source]")) editing.srcText = q("[data-rx-source]").value;
      if (q("[data-rx-checked]")) { r.checked = q("[data-rx-checked]").value.trim() || undefined; r.unchecked = q("[data-rx-unchecked]").value.trim() || undefined; }
      if (q("[data-rx-va]")) r.a = q("[data-rx-va]").value;
      if (q("[data-rx-vb]")) r.b = q("[data-rx-vb]").value;
      if (q("[data-rx-vf]")) editing.ftext = q("[data-rx-vf]").value;
      if (q("[data-rx-help]")) r.help = q("[data-rx-help]").value.trim() || undefined;
    }
  }

  function save() {
    readInputs();
    const r = { ...editing.rule };
    const ranges = String(editing.a1 ?? "").split(",").map((x) => rangeFromA1(model, st.tab, x)).filter(Boolean);
    if (!ranges.length) { toast("Enter a range like B2:B20."); return false; }
    r.ranges = ranges;
    const anchorTo = (text) => {
      const t = String(text || "").trim();
      if (!t) return null;
      try { return storedFromText(t.startsWith("=") ? t : `=${t}`, model.grid, st.tab); } catch { return undefined; }
    };
    if (r.kind === "format" && r.type !== "scale" && r.cond.op === "formula") {
      const f = anchorTo(editing.ftext ?? ftext(r.cond.f));
      if (!f) { toast("That formula can't be read."); return false; }
      r.cond = { op: "formula", f };
    }
    if (r.kind === "valid" && r.type === "formula") {
      const f = anchorTo(editing.ftext ?? ftext(r.f));
      if (!f) { toast("That formula can't be read."); return false; }
      r.f = f;
    }
    if (r.kind === "valid" && r.type === "range") {
      const src = sourceFrom(editing.srcText ?? sourceText(r.source));
      if (!src) { toast("Enter the range with the items, like Sheet1!A1:A10."); return false; }
      r.source = src;
    }
    if (r.kind === "valid" && r.type === "list" && !(r.items || []).length) { toast("Add at least one item."); return false; }
    model.setRule(st.tab, editing.id, r);
    return true;
  }

  function onClick(e) {
    const t = e.target.closest("[data-rx],[data-rx-edit],[data-rx-up],[data-rx-down],[data-rx-del],[data-rx-type],[data-rx-style],[data-rx-color]");
    if (!t) return;
    const d = t.dataset;
    if (d.rx === "close") { close(); return; }
    if (d.rx === "add") { startNew(); renderPanel(); return; }
    if (d.rx === "back") { editing = null; renderPanel(); return; }
    if (d.rx === "done") { if (save()) { editing = null; if (mode === "valid") close(); else renderPanel(); schedule(); } return; }
    if (d.rx === "remove") { model.removeRule(st.tab, editing.id); editing = null; renderPanel(); schedule(); return; }
    if (d.rxUp || d.rxDown) { e.stopPropagation(); model.moveRule(st.tab, d.rxUp || d.rxDown, d.rxUp ? -1 : 1); return; }
    if (d.rxDel) { e.stopPropagation(); model.removeRule(st.tab, d.rxDel); return; }
    if (d.rxEdit) { const r = model.rulesOf(st.tab).find((x) => x.id === d.rxEdit); if (r) { editing = { id: r.id, rule: JSON.parse(JSON.stringify(r)) }; renderPanel(); } return; }
    readInputs();
    const r = editing?.rule;
    if (!r) return;
    if (d.rxType) { if (d.rxType === "scale" && r.type !== "scale") Object.assign(r, { type: "scale", ...JSON.parse(JSON.stringify(SCALE_DEFAULT)) }); if (d.rxType === "single") { r.type = "single"; r.cond = r.cond || { op: "notEmpty" }; r.style = r.style || { ...DEFAULT_STYLE }; } renderPanel(); return; }
    if (d.rxStyle) { r.style = { ...r.style, [d.rxStyle]: r.style?.[d.rxStyle] ? undefined : true }; renderPanel(); return; }
    if (d.rxColor) { r.style = { ...r.style, [d.rxColor]: d.c || undefined }; renderPanel(); }
  }
  function onChange(e) {
    const t = e.target, r = editing?.rule;
    if (!r) return;
    readInputs();
    if (t.matches("[data-rx-op]")) { r.cond = { op: t.value }; editing.ftext = undefined; renderPanel(); panel.querySelector("[data-rx-a]")?.focus(); }
    else if (t.matches("[data-rx-pt]")) { r[t.dataset.rxPt] = { ...r[t.dataset.rxPt], type: t.value, v: ["num", "pct", "percentile"].includes(t.value) ? (r[t.dataset.rxPt]?.v ?? (t.dataset.rxPt === "mid" ? "50" : "")) : undefined }; renderPanel(); }
    else if (t.matches("[data-rx-ptc]")) { r[t.dataset.rxPtc] = { ...r[t.dataset.rxPtc], color: t.value }; renderPanel(); }
    else if (t.matches("[data-rx-vtype]")) { const keep = { kind: "valid", ranges: r.ranges, help: r.help, reject: r.reject }; editing.rule = { ...keep, type: t.value, ...(t.value === "list" || t.value === "range" ? { display: "chip", items: t.value === "list" ? [] : undefined } : {}) }; editing.ftext = undefined; renderPanel(); }
    else if (t.matches("[data-rx-vop]")) { r.op = t.value; renderPanel(); }
    else if (t.matches("[data-rx-display]")) r.display = t.value;
    else if (t.matches("[data-rx-reject]")) r.reject = t.dataset.rxReject === "1";
  }

  return {
    compiled, pointer, wants: (h) => pointer(h, true), key, refuse, hint, close, dropdownAt, openDropdownAt,
    openFormatting: () => open("format"),
    openValidation: () => open("valid"),
    destroy() { close(); model.ydoc.off("afterTransaction", onTx); hintEl.remove(); },
    get panel() { return panel; },
  };
}
