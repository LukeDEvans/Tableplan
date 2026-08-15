// Cadence Lab — the vertical slice in the browser. Wires the (tested) domain +
// storage + parser modules to the OSMD adapter and exercises the whole thread:
//   import MusicXML → IndexedDB → parse → render → click→ScorePosition→highlight
//   → reload entirely from storage (offline).
// Standalone (served by Vite dev at /music-lab.html); touches nothing in the app.

import sampleXml from "./test/fixtures/simple-4-4.musicxml?raw";
import { createIdbStorage } from "./music/storage.js";
import { importMusicXmlFile, loadWork } from "./music/import.js";
import { hitTestPosition } from "./music/score-renderer.js";
import { offsetToDisplayBeat } from "./music/score-model.js";
import { createOsmdRenderer } from "./music/renderers/osmd-adapter.js";

const $ = (id) => document.getElementById(id);
const scoreEl = $("score");
const logEl = $("log");
const log = (msg, cls = "") => { logEl.textContent += `${msg}\n`; logEl.scrollTop = logEl.scrollHeight; if (cls === "err") console.error(msg); };
const set = (id, v, cls) => { const el = $(id); el.textContent = v; if (cls != null) el.className = "pill " + cls; };

const storage = createIdbStorage("cadence-lab");
let renderer = null;
let layout = null;
let currentWorkId = null;

window.addEventListener("error", (e) => log("‼ " + (e.error?.stack || e.message), "err"));

async function renderModel(work, model, xml, mode) {
  scoreEl.innerHTML = "";
  renderer?.destroy?.();
  const ctx = { workId: work.id, movementId: work.movements[0].id, editionId: work.editions[0].id };
  const measureIds = work.editions[0].representations[0].measureIdentity.ids;
  renderer = await createOsmdRenderer(scoreEl, ctx, measureIds);
  await renderer.load(xml, { mode });
  layout = renderer.render();
  set("rTpq", model.ticksPerQuarter);
  set("rMeasures", model.measures.length);
  set("rNotes", `${layout.stats.resolved} (${layout.stats.skipped} skipped)`, layout.stats.resolved ? "ok" : "err");
  set("rWarn", model.warnings.length || "none", model.warnings.length ? "warn" : "ok");
  model.warnings.forEach((w) => log("⚠ " + w));
  log(`rendered "${work.title}" — ${model.measures.length} measures, ${layout.notes.length} notes mapped`);
}

async function doImport(name, bytes) {
  try {
    set("rState", "importing…");
    const res = await importMusicXmlFile({ name, bytes }, storage, {});
    currentWorkId = res.work.id;
    localStorage.setItem("cadence-lab-last", currentWorkId);
    await renderModel(res.work, res.model, new TextDecoder().decode(bytes), $("mode").value);
    set("rState", "imported + stored", "ok");
    $("reload").disabled = false;
    log(`stored: work=${res.work.id} blob=${res.blobId}`);
  } catch (e) { set("rState", "import failed", "err"); log("‼ import: " + (e.stack || e.message), "err"); }
}

async function doReload() {
  try {
    const id = currentWorkId || localStorage.getItem("cadence-lab-last");
    if (!id) return log("nothing stored to reload");
    set("rState", "reloading from IndexedDB…");
    const w = await loadWork(storage, id);
    if (!w) return log("work not found in storage");
    const blob = await storage.get("bytes", w.representation.blobId);
    if (!blob) return log("bytes missing (evicted)");
    const xml = new TextDecoder().decode(blob.bytes.bytes || blob.bytes); // handle wrapper
    currentWorkId = id;
    await renderModel(w.work, w.model, xml, $("mode").value);
    set("rState", "reloaded from storage (no network needed)", "ok");
    log("✓ reloaded entirely from IndexedDB — data survived without re-import");
  } catch (e) { set("rState", "reload failed", "err"); log("‼ reload: " + (e.stack || e.message), "err"); }
}

// Click a note → canonical ScorePosition → highlight.
scoreEl.addEventListener("click", (e) => {
  if (!layout || !renderer) return;
  const r = scoreEl.getBoundingClientRect();
  const x = e.clientX - r.left + scoreEl.scrollLeft;
  const y = e.clientY - r.top + scoreEl.scrollTop;
  const pos = hitTestPosition(layout, x, y);
  if (!pos) { set("rPos", "no note near click"); return; }
  const measure = renderer && layout.notes.find((n) => n.measureIndex === pos.measureIndex);
  const beat = offsetToDisplayBeat(pos.offset, [4, 4]); // display beat (assumes 4/4 for the readout)
  set("rPos", `m${pos.measureIndex} · offset ${pos.offset.num}/${pos.offset.den}q · ~beat ${beat.toFixed(2)} · measureId ${pos.measureId || "—"}`);
  renderer.highlight(pos);
  log(`click (${Math.round(x)},${Math.round(y)}) → ${JSON.stringify(pos)}`);
});

$("file").addEventListener("change", (e) => {
  const f = e.target.files[0]; if (!f) return;
  f.arrayBuffer().then((buf) => doImport(f.name, new Uint8Array(buf)));
});
$("sample").addEventListener("click", () => doImport("Sample in C.musicxml", new TextEncoder().encode(sampleXml)));
$("reload").addEventListener("click", doReload);
$("mode").addEventListener("change", () => { if (renderer) { renderer.setMode($("mode").value); layout = renderer.getLayoutIndex(); } });
$("clear").addEventListener("click", async () => {
  for (const s of ["bytes", "blobAssets", "works", "representations", "scoreModels"]) {
    const all = await storage.getAll(s); // best-effort wipe
    if (s === "works") for (const w of all) await storage.delete(s, w.id);
  }
  indexedDB.deleteDatabase("cadence-lab");
  localStorage.removeItem("cadence-lab-last");
  log("storage cleared — reload the page");
});

// Offer to restore the last import on load.
const last = localStorage.getItem("cadence-lab-last");
if (last) { currentWorkId = last; $("reload").disabled = false; log(`found a stored work (${last}). Click “Reload from storage” to render it offline.`); }
