// OpenSheetMusicDisplay adapter — implements the ScoreRenderer contract. OSMD is
// vendored (npm) and dynamically imported so Vite code-splits it into the app's
// own bundle: it works offline after first load, with no CDN and no boot cost.
//
// The adapter's one Cadence-specific job is getLayoutIndex(): walk OSMD's
// GraphicSheet and emit each rendered note as { measureIndex, offset, midis,
// rect } in scroll-content pixels. All pixel↔position logic then lives in the
// library-agnostic, unit-tested music/score-renderer.js.
//
// Spike status: OSMD's internal graphics API (relInMeasureTimestamp,
// getSVGGElement) is read defensively; getLayoutIndex() reports how many notes
// it resolved so the lab can flag any extraction gaps to fix in-browser.

import { rat } from "../rational.js";
import { positionToRect } from "../score-renderer.js";

export async function createOsmdRenderer(container, context, measureIds = []) {
  const mod = await import("opensheetmusicdisplay");
  const OSMD = mod.OpenSheetMusicDisplay || mod.default?.OpenSheetMusicDisplay || mod.default;

  const osmd = new OSMD(container, {
    autoResize: true, backend: "svg", drawTitle: true, drawingParameters: "default",
  });
  let mode = "continuous";
  let lastLayout = null;
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return;
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    overlay = document.createElement("div");
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText =
      "position:absolute;pointer-events:none;background:rgba(40,64,122,.16);" +
      "border:2px solid #28407a;border-radius:4px;display:none;z-index:5;transition:all .12s ease";
    container.appendChild(overlay);
  }

  function applyMode() {
    try { osmd.setPageFormat?.(mode === "paged" ? "A4_P" : "Endless"); } catch { /* older builds */ }
  }

  function midiOf(gnote) {
    try {
      const p = gnote?.sourceNote?.Pitch;
      if (!p) return null;
      // OSMD half-tone (C4 = 48 in its scheme) → MIDI (C4 = 60).
      const ht = typeof p.getHalfTone === "function" ? p.getHalfTone() : p.halfTone;
      return Number.isFinite(ht) ? ht + 12 : null;
    } catch { return null; }
  }

  function getLayoutIndex() {
    const notes = [];
    const cRect = container.getBoundingClientRect();
    const measureList = osmd.GraphicSheet?.MeasureList || [];
    let resolved = 0, skipped = 0;
    for (let m = 0; m < measureList.length; m++) {
      for (const gm of (measureList[m] || [])) {
        if (!gm) continue;
        for (const se of (gm.staffEntries || [])) {
          const rel = se.relInMeasureTimestamp; // Fraction in whole notes
          const offset = rel ? rat((rel.Numerator || 0) * 4, rel.Denominator || 1) : rat(0, 1);
          for (const gve of (se.graphicalVoiceEntries || [])) {
            for (const gn of (gve.notes || [])) {
              const el = typeof gn.getSVGGElement === "function" ? gn.getSVGGElement() : null;
              const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
              if (!r || (r.width === 0 && r.height === 0)) { skipped++; continue; }
              notes.push({
                measureIndex: m, offset, eventId: null, midis: midiOf(gn) != null ? [midiOf(gn)] : [],
                page: 0,
                rect: {
                  x: r.left - cRect.left + container.scrollLeft,
                  y: r.top - cRect.top + container.scrollTop,
                  w: r.width, h: r.height,
                },
              });
              resolved++;
            }
          }
        }
      }
    }
    lastLayout = { context, measureIds, notes, stats: { resolved, skipped } };
    return lastLayout;
  }

  return {
    id: "osmd",
    async load(xml, opts = {}) { mode = opts.mode || mode; applyMode(); await osmd.load(xml); },
    render() { osmd.render(); ensureOverlay(); return getLayoutIndex(); },
    getLayoutIndex,
    highlight(pos) {
      ensureOverlay();
      const layout = lastLayout || getLayoutIndex();
      const rect = positionToRect(layout, pos);
      if (!rect) { overlay.style.display = "none"; return false; }
      Object.assign(overlay.style, { display: "block", left: `${rect.x - 3}px`, top: `${rect.y - 3}px`, width: `${rect.w + 6}px`, height: `${rect.h + 6}px` });
      return true;
    },
    setMode(m) { mode = m; applyMode(); osmd.render(); getLayoutIndex(); },
    setZoom(z) { osmd.zoom = z; osmd.render(); getLayoutIndex(); },
    destroy() { try { osmd.clear(); } catch { /* noop */ } if (overlay) overlay.remove(); overlay = null; },
  };
}
