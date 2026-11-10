// Editing a table on a slide (SLIDES_DESIGN.md §6, plain tables): a grid you type into,
// with rows and columns added or removed, and per-cell fill, text colour, bold and
// alignment. Each change is saved as it's made, so co-editing merges cell by cell.

import { openDialog } from "../editor/panels.js";
import { resolveColor } from "./themes.js";
import { colorPicker, esc } from "./chrome.js";

export function editTableDialog({ root, model, sid, iid, onDone }) {
  let focus = { r: 0, c: 0 };
  const draw = (form) => {
    const it = model.item(sid, iid);
    if (!it) return;
    const th = model.theme();
    const grid = form.querySelector("[data-grid]");
    const cells = it.cells || {};
    grid.style.gridTemplateColumns = `repeat(${it.cols}, minmax(90px, 1fr))`;
    grid.innerHTML = Array.from({ length: it.rows }, (_, r) => Array.from({ length: it.cols }, (_, c) => {
      const cell = cells[`${r}.${c}`] || {};
      const bg = resolveColor(cell.fill || (r === 0 && it.fill ? it.fill : null), th);
      return `<textarea data-r="${r}" data-c="${c}" rows="2" aria-label="Row ${r + 1}, column ${c + 1}" style="${bg ? `background:${bg};` : ""}${cell.color ? `color:${resolveColor(cell.color, th)};` : ""}${cell.bold ? "font-weight:700;" : ""}${cell.align ? `text-align:${cell.align};` : ""}"${r === focus.r && c === focus.c ? " data-focus" : ""}>${esc(cell.text || "")}</textarea>`;
    }).join("")).join("");
    form.querySelector("[data-focus]")?.focus();
  };
  return openDialog(root, {
    title: "Edit table",
    body: `<div class="sl-table-tools">
        <button type="button" class="secondary-btn" data-t="row-above">Row above</button><button type="button" class="secondary-btn" data-t="row-below">Row below</button><button type="button" class="secondary-btn" data-t="row-del">Delete row</button>
        <button type="button" class="secondary-btn" data-t="col-left">Column left</button><button type="button" class="secondary-btn" data-t="col-right">Column right</button><button type="button" class="secondary-btn" data-t="col-del">Delete column</button>
        <button type="button" class="secondary-btn" data-t="bold"><b>B</b></button><button type="button" class="secondary-btn" data-t="fill">Cell fill</button><button type="button" class="secondary-btn" data-t="color">Text colour</button>
        <button type="button" class="secondary-btn" data-t="align" data-a="left">Left</button><button type="button" class="secondary-btn" data-t="align" data-a="center">Centre</button><button type="button" class="secondary-btn" data-t="align" data-a="right">Right</button>
      </div><div class="sl-table-grid" data-grid></div>`,
    actions: [{ label: "Done", value: "ok", primary: true }],
    init: (form) => {
      form.closest(".wp-dialog-box").classList.add("sl-table-dialog");
      draw(form);
      form.addEventListener("focusin", (e) => { const t = e.target.closest("[data-r]"); if (t) focus = { r: Number(t.dataset.r), c: Number(t.dataset.c) }; });
      form.addEventListener("input", (e) => {
        const t = e.target.closest("[data-r]");
        if (t) model.tableCell(sid, iid, Number(t.dataset.r), Number(t.dataset.c), { text: t.value });
      });
      form.addEventListener("click", (e) => {
        const b = e.target.closest("[data-t]");
        if (!b) return;
        const { r, c } = focus;
        const it = model.item(sid, iid);
        const cell = it?.cells?.[`${r}.${c}`] || {};
        switch (b.dataset.t) {
          case "row-above": model.tableInsert(sid, iid, "row", r); break;
          case "row-below": model.tableInsert(sid, iid, "row", r + 1); focus.r++; break;
          case "row-del": model.tableDelete(sid, iid, "row", r); focus.r = Math.max(0, r - 1); break;
          case "col-left": model.tableInsert(sid, iid, "col", c); break;
          case "col-right": model.tableInsert(sid, iid, "col", c + 1); focus.c++; break;
          case "col-del": model.tableDelete(sid, iid, "col", c); focus.c = Math.max(0, c - 1); break;
          case "bold": model.tableCell(sid, iid, r, c, { bold: cell.bold ? null : true }); break;
          case "align": model.tableCell(sid, iid, r, c, { align: b.dataset.a }); break;
          case "fill": case "color":
            colorPicker(form.closest(".wp-dialog"), b, { theme: model.theme(), current: cell[b.dataset.t], onPick: (v) => { model.tableCell(sid, iid, r, c, { [b.dataset.t]: v }); draw(form); onDone?.(); } });
            return;
          default: return;
        }
        draw(form);
        onDone?.();
      });
    },
  }).then(() => onDone?.());
}
