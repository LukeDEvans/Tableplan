// shazam-ui.js — the Shazam sheet (UTILITIES_MENU_DESIGN.md §7). Loaded when first
// opened from the utilities menu (iPhone only, decision 11).
//
// Listen → the song, with Save to Listen and Play; below it the person's list of
// songs found before (decision 16), each of which can still be saved.

import { openUtilitySheet } from "./utilities-ui.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// deps: { recognizer, history() → [song], addToHistory(song), markSaved(id),
//         saveToListen(song) → Promise<bool>, play(song), showToast(msg) }
export function openShazam(deps) {
  const { recognizer, showToast = () => {} } = deps;
  let listening = false;
  const sheet = openUtilitySheet({ title: "Shazam", className: "shazam-sheet", onClose: () => { if (listening) recognizer.cancel(); } });

  const songRow = (s, { big = false } = {}) => `
    <div class="${big ? "shazam-result" : "utility-row"}" data-song="${esc(s.id)}">
      <div class="shazam-song">${s.artworkUrl ? `<img src="${esc(s.artworkUrl)}" alt="">` : ""}<div class="shazam-song-text"><strong>${esc(s.title || "Unknown song")}</strong><span>${esc([s.artist, big ? s.album : ""].filter(Boolean).join(" · "))}</span></div></div>
      <div class="shazam-actions">
        ${s.savedToListen ? `<span class="clock-note">Saved</span>` : `<button type="button" class="secondary-btn compact-btn" data-save="${esc(s.id)}">Save to Listen</button>`}
        ${s.appleMusicId || s.appleMusicUrl ? `<button type="button" class="secondary-btn compact-btn" data-play="${esc(s.id)}">Play</button>` : ""}
      </div>
    </div>`;

  function render(status = "", result = null) {
    const history = deps.history() || [];
    sheet.body.innerHTML = `
      <div class="shazam-listen">
        <button type="button" class="shazam-btn${listening ? " is-listening" : ""}" data-act="listen">${listening ? "Listening…" : "Tap to listen"}</button>
        <p class="shazam-status" aria-live="polite">${esc(status)}</p>
      </div>
      ${result ? songRow(result, { big: true }) : ""}
      ${history.length ? `<p class="liv-result-head">Found before</p>${history.filter((s) => !result || s.id !== result.id).slice(0, 50).map((s) => songRow(s)).join("")}` : ""}`;
  }

  async function listen() {
    if (listening) { recognizer.cancel(); return; }
    listening = true;
    render("Hold the phone near the music.");
    const r = await recognizer.recognize({ timeoutSeconds: 15 });
    listening = false;
    if (r.status === "match") {
      deps.addToHistory(r.song);
      const kept = (deps.history() || []).find((s) => s.title === r.song.title && s.artist === r.song.artist) || r.song;
      render("", kept);
    } else if (r.status === "nomatch") render("No match. Try again closer to the music.");
    else if (r.status === "cancelled") render("");
    else render(r.error || "Couldn't listen just now.");
  }

  sheet.body.addEventListener("click", async (e) => {
    if (e.target.closest('[data-act="listen"]')) { listen(); return; }
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
    const shown = sheet.body.querySelector(".shazam-result")?.dataset.song;
    render("", shown ? (deps.history() || []).find((s) => s.id === shown) : null);
  });
  render();
  return sheet;
}
