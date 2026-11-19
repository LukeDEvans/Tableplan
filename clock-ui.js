// clock-ui.js — the Clock sheet: Alarms, Timers, Stopwatch (UTILITIES_MENU_DESIGN.md §6).
//
// On the iPhone alarms and timers ring through AlarmKit (deps.clock = the LiveClock
// plugin): full screen, through Focus and silent mode, on this phone only. The
// laptop has no alarms (decision 11); its timers ring in the page. Timers and the
// stopwatch are kept on this device (localStorage).

import { openUtilitySheet } from "./utilities-ui.js";
import {
  WEEKDAYS, formatDuration, formatAlarmTime, repeatLabel, timerSeconds, TIMER_PRESETS,
  createStopwatch, stopwatchElapsed, stopwatchStart, stopwatchStop, stopwatchReset, stopwatchLap,
  startTimer, timerRemaining, pauseTimer, resumeTimer, timerDone,
} from "./clock-model.js";

const SW_KEY = "live-clock-stopwatch-v1";
const TIMERS_KEY = "live-clock-timers-v1";
const DAY_LETTERS = { sunday: "S", monday: "M", tuesday: "T", wednesday: "W", thursday: "T", friday: "F", saturday: "S" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const load = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.35, 0.7, 1.05].forEach((delay) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.3);
    });
  } catch { /* no audio */ }
}

export function openClock({ clock = null, showToast = () => {} } = {}) {
  const hasAlarms = Boolean(clock);
  let tab = hasAlarms ? "alarms" : "timers";
  let tick = null;
  const sheet = openUtilitySheet({ title: "Clock", className: "clock-sheet", onClose: () => clearInterval(tick) });
  const tabs = [...(hasAlarms ? [["alarms", "Alarms"]] : []), ["timers", "Timers"], ["stopwatch", "Stopwatch"]];
  sheet.body.innerHTML = `<div class="utility-tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" class="utility-tab" role="tab" data-tab="${id}">${label}</button>`).join("")}</div><div class="clock-pane"></div>`;
  const pane = sheet.body.querySelector(".clock-pane");
  sheet.body.querySelector(".utility-tabs").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]")?.dataset.tab;
    if (t && t !== tab) { tab = t; render(); }
  });

  // ── Alarms (AlarmKit) ───────────────────────────────────────────────────────
  async function renderAlarms() {
    pane.innerHTML = `<p class="clock-note">Loading alarms…</p>`;
    let alarms = [];
    try { alarms = (await clock.list())?.alarms || []; } catch (e) { pane.innerHTML = `<p class="clock-note">Couldn't read alarms: ${esc(e?.message || "error")}</p>`; return; }
    if (tab !== "alarms") return;
    const list = alarms.filter((a) => a.kind !== "timer").sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    pane.innerHTML = `
      <form class="clock-form" id="alarmForm">
        <label>Time<input type="time" id="alarmTime" value="07:00" required></label>
        <label>Label<input type="text" id="alarmLabel" maxlength="40" placeholder="Alarm"></label>
        <button type="submit" class="primary-btn">Add alarm</button>
      </form>
      <div class="clock-days" role="group" aria-label="Repeat">${WEEKDAYS.map((d) => `<button type="button" class="clock-day" data-day="${d}" aria-pressed="false" aria-label="${d}">${DAY_LETTERS[d]}</button>`).join("")}</div>
      <div class="clock-alarms">${list.length ? list.map((a) => `
        <div class="utility-row"><div class="utility-row-main"><strong>${esc(formatAlarmTime(a.hour, a.minute))}</strong><span>${esc([a.label, repeatLabel(a.weekdays)].filter(Boolean).join(" · "))}</span></div>
        <button type="button" class="secondary-btn compact-btn" data-cancel="${esc(a.id)}">Delete</button></div>`).join("") : `<p class="utility-empty">No alarms yet.</p>`}</div>
      <p class="clock-note">Alarms ring on this phone, even in silent mode or a Focus.</p>`;
    const days = new Set();
    pane.querySelector(".clock-days").addEventListener("click", (e) => {
      const b = e.target.closest("[data-day]");
      if (!b) return;
      const d = b.dataset.day;
      if (days.has(d)) days.delete(d); else days.add(d);
      b.setAttribute("aria-pressed", String(days.has(d)));
    });
    pane.querySelector("#alarmForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const [h, m] = String(pane.querySelector("#alarmTime").value || "07:00").split(":").map(Number);
      try {
        await ensureAuthorized();
        await clock.scheduleAlarm({ hour: h, minute: m, label: pane.querySelector("#alarmLabel").value.trim() || "Alarm", weekdays: [...days] });
        showToast(`Alarm set for ${formatAlarmTime(h, m)}`);
        renderAlarms();
      } catch (err) { showToast(`Couldn't set the alarm: ${err?.message || "error"}`); }
    });
    pane.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", async () => {
      try { await clock.cancel({ id: b.dataset.cancel }); } catch { /* already gone */ }
      renderAlarms();
    }));
  }

  async function ensureAuthorized() {
    const st = (await clock.authorization())?.state;
    if (st === "authorized") return;
    const r = (await clock.requestAuthorization())?.state;
    if (r !== "authorized") throw new Error("Allow alarms for Liv in Settings");
  }

  // ── Timers ──────────────────────────────────────────────────────────────────
  let timers = load(TIMERS_KEY, []).filter((t) => t && t.id);
  const saveTimers = () => save(TIMERS_KEY, timers);
  async function addTimer(seconds, label) {
    if (!seconds) return;
    let t = startTimer(seconds, { label });
    if (clock) {
      try {
        await ensureAuthorized();
        const r = await clock.scheduleTimer({ seconds, label: label || "Timer" });
        if (r?.id) t = { ...t, id: r.id, system: true };
      } catch (err) { showToast(`The timer will only ring with Liv open: ${err?.message || "error"}`); }
    }
    timers = [t, ...timers];
    saveTimers();
    render();
  }
  function renderTimers() {
    const now = Date.now();
    pane.innerHTML = `
      <form class="clock-form" id="timerForm">
        <label>Hours<input type="number" id="tH" min="0" max="23" value="0" inputmode="numeric"></label>
        <label>Minutes<input type="number" id="tM" min="0" max="59" value="5" inputmode="numeric"></label>
        <label>Seconds<input type="number" id="tS" min="0" max="59" value="0" inputmode="numeric"></label>
        <label>Label<input type="text" id="tL" maxlength="40" placeholder="Timer"></label>
        <button type="submit" class="primary-btn">Start</button>
      </form>
      <div class="clock-presets">${TIMER_PRESETS.map((s) => `<button type="button" class="secondary-btn compact-btn" data-preset="${s}">${s >= 60 ? `${s / 60} min` : `${s} s`}</button>`).join("")}</div>
      <div class="clock-timers">${timers.length ? timers.map((t) => `
        <div class="utility-row" data-timer="${esc(t.id)}"><div class="utility-row-main"><strong class="timer-left">${esc(timerDone(t, now) ? "Done" : formatDuration(timerRemaining(t, now)))}</strong><span>${esc(t.label || formatDuration(t.seconds * 1000))}</span></div>
        <div class="wallet-actions">${timerDone(t, now) ? "" : `<button type="button" class="secondary-btn compact-btn" data-toggle="${esc(t.id)}">${t.endsAt ? "Pause" : "Resume"}</button>`}<button type="button" class="secondary-btn compact-btn" data-remove="${esc(t.id)}">${timerDone(t, now) ? "Clear" : "Cancel"}</button></div></div>`).join("") : `<p class="utility-empty">No timers running.</p>`}</div>`;
    pane.querySelector("#timerForm").addEventListener("submit", (e) => {
      e.preventDefault();
      addTimer(timerSeconds({ hours: pane.querySelector("#tH").value, minutes: pane.querySelector("#tM").value, seconds: pane.querySelector("#tS").value }), pane.querySelector("#tL").value.trim());
    });
    pane.querySelector(".clock-presets").addEventListener("click", (e) => {
      const s = Number(e.target.closest("[data-preset]")?.dataset.preset);
      if (s) addTimer(s, "");
    });
    pane.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
      timers = timers.map((t) => {
        if (t.id !== b.dataset.toggle) return t;
        const next = t.endsAt ? pauseTimer(t) : resumeTimer(t);
        if (t.system && clock) clock[t.endsAt ? "pause" : "resume"]({ id: t.id }).catch(() => {});
        return next;
      });
      saveTimers(); render();
    }));
    pane.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      const t = timers.find((x) => x.id === b.dataset.remove);
      if (t?.system && clock && !timerDone(t)) clock.cancel({ id: t.id }).catch(() => {});
      timers = timers.filter((x) => x.id !== b.dataset.remove);
      saveTimers(); render();
    }));
  }
  function tickTimers() {
    const now = Date.now();
    let rerender = false;
    for (const t of timers) {
      const row = pane.querySelector(`[data-timer="${CSS.escape(t.id)}"] .timer-left`);
      if (timerDone(t, now) && !t.rang) {
        t.rang = true; rerender = true;
        if (!t.system) { beep(); showToast(`${t.label || "Timer"} is done`); }
      } else if (row) row.textContent = timerDone(t, now) ? "Done" : formatDuration(timerRemaining(t, now));
    }
    if (rerender) { saveTimers(); render(); }
  }

  // ── Stopwatch ───────────────────────────────────────────────────────────────
  let sw = { ...createStopwatch(), ...load(SW_KEY, {}) };
  const saveSw = () => save(SW_KEY, sw);
  function renderStopwatch() {
    pane.innerHTML = `
      <div class="clock-big" id="swTime">${esc(formatDuration(stopwatchElapsed(sw), { hundredths: true }))}</div>
      <div class="clock-controls">
        <button type="button" class="clock-round" id="swLeft">${sw.running ? "Lap" : "Reset"}</button>
        <button type="button" class="clock-round is-go" id="swRight">${sw.running ? "Stop" : "Start"}</button>
      </div>
      <div class="clock-laps">${sw.laps.map((l) => `<div class="utility-row"><span>Lap ${l.n}</span><strong>${esc(formatDuration(l.split, { hundredths: true }))}</strong></div>`).join("")}</div>`;
    pane.querySelector("#swRight").addEventListener("click", () => { sw = sw.running ? stopwatchStop(sw) : stopwatchStart(sw); saveSw(); render(); });
    pane.querySelector("#swLeft").addEventListener("click", () => { sw = sw.running ? stopwatchLap(sw) : stopwatchReset(); saveSw(); render(); });
  }

  function render() {
    sheet.body.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "alarms") renderAlarms();
    else if (tab === "timers") renderTimers();
    else renderStopwatch();
  }
  tick = setInterval(() => {
    if (tab === "stopwatch" && sw.running) {
      const el = pane.querySelector("#swTime");
      if (el) el.textContent = formatDuration(stopwatchElapsed(sw), { hundredths: true });
    }
    if (tab === "timers") tickTimers();
  }, 50);
  render();
  return sheet;
}
