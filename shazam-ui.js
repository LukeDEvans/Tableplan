// shazam-ui.js — the song recognizer sheet (UTILITIES_MENU_DESIGN.md §7). Loaded
// when first opened from the utilities menu (iPhone only, decision 11).
//
// Opening it starts listening straight away (Luke, 2026-11-20); tapping the big
// button stops, or listens again. The song found shows with Save to Listen and
// Play. "History" (top right) opens the person's list of songs found before
// (decision 16), each of which can still be saved or played.

import { openUtilitySheet } from "./utilities-ui.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ICON_CLOSE = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
const ICON_BACK = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>`;
// A plain sound-wave mark (Liv's own, not any service's logo).
const ICON_WAVE = `<svg viewBox="0 0 48 48" width="64" height="64" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" aria-hidden="true"><path d="M8 20v8M15 14v20M22 9v30M29 15v18M36 11v26M42 19v10"/></svg>`;

function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1 && new Date().toDateString() === d.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days < 7) return d.toLocaleDateString([], { weekday: "long" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

// deps: { recognizer, history() → [song], addToHistory(song), markSaved(id),
//         saveToListen(song) → Promise<bool>, play(song), showToast(msg) }
export function openShazam(deps) {
  const { recognizer, showToast = () => {} } = deps;
  let listening = false;
  let view = "listen"; // listen | history
  let status = "";
  let result = null;
  let run = 0;
  const sheet = openUtilitySheet({ title: "Shazam", className: "shazam-sheet", onClose: () => { run++; if (listening) recognizer.cancel(); } });

  const actions = (s) => `
    <div class="shazam-actions">
      ${s.savedToListen ? `<span class="shazam-saved">Saved to Listen</span>` : `<button type="button" class="shazam-pill" data-save="${esc(s.id)}">Save to Listen</button>`}
      ${s.appleMusicId || s.appleMusicUrl ? `<button type="button" class="shazam-pill is-ghost" data-play="${esc(s.id)}">Play</button>` : ""}
    </div>`;

  function render() {
    const history = deps.history() || [];
    if (view === "history") {
      sheet.body.innerHTML = `
        <div class="shazam-wrap is-history">
          <div class="shazam-nav"><button type="button" class="shazam-link" data-act="back">${ICON_BACK}Back</button><strong>History</strong><span></span></div>
          <div class="shazam-history">${history.length ? history.map((s) => `
            <div class="shazam-row" data-song="${esc(s.id)}">
              ${s.artworkUrl ? `<img src="${esc(s.artworkUrl)}" alt="">` : `<span class="shazam-art-blank" aria-hidden="true"></span>`}
              <div class="shazam-row-text"><strong>${esc(s.title || "Unknown song")}</strong><span>${esc(s.artist || "")}</span><small>${esc(when(s.at))}</small></div>
              ${actions(s)}
            </div>`).join("") : `<p class="shazam-empty">Songs you identify will appear here.</p>`}</div>
        </div>`;
      return;
    }
    sheet.body.innerHTML = `
      <div class="shazam-wrap">
        <div class="shazam-nav"><button type="button" class="shazam-close" data-act="close" aria-label="Close">${ICON_CLOSE}</button><span></span><button type="button" class="shazam-link is-bold" data-act="history">History</button></div>
        <div class="shazam-stage${listening ? " is-listening" : ""}${result ? " has-result" : ""}">
          <button type="button" class="shazam-btn" data-act="listen" aria-label="${listening ? "Stop listening" : "Listen"}">
            <span class="shazam-ring"></span><span class="shazam-ring is-2"></span><span class="shazam-ring is-3"></span>${ICON_WAVE}
          </button>
          <p class="shazam-status" aria-live="polite">${esc(listening ? "Listening for music" : status || (result ? "" : "Tap to identify a song"))}</p>
          ${listening ? `<p class="shazam-hint">Make sure your phone can hear the song clearly</p>` : ""}
        </div>
        ${result ? `
          <div class="shazam-result" data-song="${esc(result.id)}">
            ${result.artworkUrl ? `<img src="${esc(result.artworkUrl)}" alt="">` : ""}
            <strong>${esc(result.title || "Unknown song")}</strong>
            <span>${esc([result.artist, result.album].filter(Boolean).join(" · "))}</span>
            ${actions(result)}
          </div>` : ""}
      </div>`;
  }

  async function listen() {
    if (listening) { recognizer.cancel(); return; }
    const mine = ++run;
    listening = true;
    status = "";
    result = null;
    render();
    const r = await recognizer.recognize({ timeoutSeconds: 15 });
    if (mine !== run) return; // the sheet closed
    listening = false;
    if (r.status === "match") {
      deps.addToHistory(r.song);
      result = (deps.history() || []).find((s) => s.title === r.song.title && s.artist === r.song.artist) || r.song;
    } else if (r.status === "nomatch") status = "No result. Tap to try again.";
    else if (r.status === "cancelled") status = "";
    else status = r.error || "Couldn't listen just now.";
    if (view === "listen") render();
  }

  sheet.body.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") { sheet.close(); return; }
    if (act === "listen") { listen(); return; }
    if (act === "history") { view = "history"; render(); return; }
    if (act === "back") { view = "listen"; render(); return; }
    const save = e.target.closest("[data-save]");
    const play = e.target.closest("[data-play]");
    const id = save?.dataset.save || play?.dataset.play;
    if (!id) return;
    const song = (deps.history() || []).find((s) => s.id === id);
    if (!song) return;
    if (play) { deps.play(song); return; }
    save.disabled = true;
    const ok = await deps.saveToListen(song).catch(() => false);
    if (ok) { deps.markSaved(song.id); showToast(`Saved "${song.title}" to Listen`); }
    else { save.disabled = false; showToast("Couldn't save it to Listen"); }
    if (result?.id === song.id) result = (deps.history() || []).find((s) => s.id === song.id) || result;
    render();
  });
  render();
  listen();
  return sheet;
}
