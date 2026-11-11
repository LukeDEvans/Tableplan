// Inserting a chart or table from a spreadsheet (SLIDES_DESIGN.md §6): pick one of your
// spreadsheets, then one of its charts, or a range of cells for a table.

import { openDialog } from "../editor/panels.js";
import { renderChart } from "../sheet/chart-svg.js";
import { openSheetReader, computeLink, cleanChartCache } from "./linked.js";
import { esc } from "./chrome.js";

export async function insertLinkedDialog({ root, kind, model, sid, sheets, toast = () => {} }) {
  let files = [];
  try { files = (await sheets.list()) || []; } catch { files = []; }
  if (!files.length) { toast("You don't have any spreadsheets here yet. Make one in Document first."); return null; }
  let reader = null, fileId = null, picked = null;
  const title = kind === "chart" ? "Insert chart from a spreadsheet" : "Insert table from a spreadsheet";
  const { value, form: done } = await openDialog(root, {
    title,
    body: `<label>Spreadsheet<select name="file"><option value="">Choose…</option>${files.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select></label>
      <div data-pick class="sl-link-pick"><p class="msg-muted">Choose a spreadsheet to see its ${kind === "chart" ? "charts" : "tabs"}.</p></div>
      <p class="msg-muted" style="font-size:.8rem">Linked: it updates from the spreadsheet each time this presentation opens. You can unlink it later.</p>`,
    actions: [{ label: "Cancel", value: null }, { label: "Insert", value: "ok", primary: true }],
    init: (form) => {
      form.closest(".wp-dialog-box")?.classList.add("sl-link-dialog");
      const pick = form.querySelector("[data-pick]");
      form.file.addEventListener("change", async () => {
        reader?.close(); reader = null; picked = null;
        fileId = form.file.value;
        if (!fileId) return;
        pick.innerHTML = `<p class="msg-muted">Opening…</p>`;
        try { reader = await openSheetReader(await sheets.open(fileId)); } catch (e) { pick.innerHTML = `<p class="msg-muted">${esc(e?.message || "That spreadsheet couldn't be opened.")}</p>`; return; }
        const tabs = reader.tabs();
        if (kind === "chart") {
          const all = tabs.flatMap((t) => reader.charts(t.id).map((c) => ({ ...c, tab: t.id, tabName: t.name })));
          if (!all.length) { pick.innerHTML = `<p class="msg-muted">That spreadsheet has no charts yet. Make one there (Insert › Chart), or insert a table instead.</p>`; return; }
          pick.innerHTML = `<div class="sl-link-charts">${all.map((c, i) => {
            const res = computeLink(reader, { tab: c.tab, chart: c.id });
            const svg = res.cache ? renderChart(res.cache.data, res.cache.spec, { w: 220, h: 140 }) : "";
            return `<button type="button" class="sl-link-chart" data-i="${i}"><span class="sl-link-svg">${svg}</span><span>${esc(c.title || "Untitled chart")}</span><small>${esc(c.tabName)}</small></button>`;
          }).join("")}</div>`;
          pick.querySelectorAll("[data-i]").forEach((b) => b.addEventListener("click", () => {
            pick.querySelectorAll("[data-i]").forEach((x) => x.classList.toggle("is-on", x === b));
            const c = all[Number(b.dataset.i)];
            picked = { tab: c.tab, chart: c.id };
          }));
        } else {
          pick.innerHTML = `<div class="wp-row"><label>Tab<select name="tab">${tabs.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></label>
            <label>Cells<input type="text" name="a1" placeholder="A1:D10" value="A1:D6" autocomplete="off"></label></div><p class="msg-muted" style="font-size:.8rem">Up to 30 rows and 12 columns.</p>`;
        }
      });
    },
  });
  try {
    if (value !== "ok" || !reader) return null;
    let src;
    if (kind === "chart") {
      if (!picked) { toast("Pick a chart first."); return null; }
      src = { file: fileId, name: files.find((f) => f.id === fileId)?.name || "", ...picked };
    } else {
      const tab = done?.tab?.value, a1 = done?.a1?.value || "";
      const range = reader.rangeFromA1(tab, a1);
      if (!range) { toast(`"${a1}" isn't a range of cells on that tab.`); return null; }
      src = { file: fileId, name: files.find((f) => f.id === fileId)?.name || "", tab, range, a1: reader.rangeToA1(tab, range) };
    }
    const res = computeLink(reader, src);
    if (res.error) { toast(res.error); return null; }
    const [W, H] = model.size();
    if (kind === "chart") {
      const w = Math.round(W * 0.6), h = Math.round(H * 0.6);
      return model.addItem(sid, { t: "chart", src, cache: cleanChartCache(res.cache), x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h });
    }
    const rows = res.rows.length, cols = Math.max(1, ...res.rows.map((r) => r.length));
    const w = Math.min(Math.round(W * 0.85), cols * 220), h = Math.min(Math.round(H * 0.75), rows * 64);
    const id = model.addItem(sid, { t: "table", rows, cols, src, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, font: "@body", size: 14, color: "@dk1", stroke: "@dk2" });
    model.setTableText(sid, id, res.rows);
    return id;
  } finally { reader?.close(); }
}
