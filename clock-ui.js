// clock-ui.js — the Clock sheet (UTILITIES_MENU_DESIGN.md §6).
//
// Looks and works like the iPhone's Clock (Luke, 2026-11-20): black screen, a tab
// bar along the bottom (World Clock · Alarms · Stopwatch · Timers), large titles,
// Edit on the left and + on the right, orange accents.
//
// • World Clock: cities you add, each with its time and its offset from here.
// • Alarms: rows with a switch; tap a row (or +) for the editor with a wheel time
//   picker, Repeat and Label. They ring through AlarmKit (deps.clock = the LiveClock
//   plugin): full screen, through Focus and silent mode, on this phone only. The
//   switch cancels the AlarmKit alarm and keeps the row, so it can be switched back.
// • Stopwatch: big digits, Lap/Reset and Start/Stop, fastest lap green, slowest red.
// • Timers: a wheel picker and Start, the running timers with pause/resume, and
//   Recents to start a past duration again.
// The laptop has no alarms (decision 11); its timers ring in the page. Everything
// here is kept on this device (localStorage).

import { openUtilitySheet } from "./utilities-ui.js";
import {
  WEEKDAYS, formatDuration, timerSeconds,
  createStopwatch, stopwatchElapsed, stopwatchStart, stopwatchStop, stopwatchReset, stopwatchLap,
  startTimer, timerRemaining, pauseTimer, resumeTimer, timerDone,
  cityFromZone, zoneTimeParts, worldClockSubtitle, lapExtremes, reconcileAlarms, alarmRepeatText,
  addRecentTimer, durationWords,
} from "./clock-model.js";

const SW_KEY = "live-clock-stopwatch-v1";
const TIMERS_KEY = "live-clock-timers-v1";
const ALARMS_KEY = "live-clock-alarms-v1";
const ZONES_KEY = "live-clock-zones-v1";
const RECENTS_KEY = "live-clock-recent-timers-v1";
const TAB_KEY = "live-clock-tab-v1";
const ROW = 34; // wheel row height (px)
const DAY_NAMES = { sunday: "Sunday", monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday", friday: "Friday", saturday: "Saturday" };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const load = (k, fallback) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return v ?? fallback; } catch { return fallback; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const homeZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } };

const svg = (body, size = 26) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TAB_ICONS = {
  world: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.8 3.9 5.8 3.9 9s-1.3 6.2-3.9 9c-2.6-2.8-3.9-5.8-3.9-9S9.4 5.8 12 3z"/>'),
  alarms: svg('<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4.2l2.6 1.6M4.5 4.5 7 2.5M19.5 4.5 17 2.5M7 19.8 5.6 21.5M17 19.8l1.4 1.7"/>'),
  stopwatch: svg('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5M10 2.5h4M12 2.5V6M18.2 7.2l1.4-1.4"/>'),
  timers: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/><path d="M12 3v1.5" />'),
};
const ICON_PLUS = svg('<path d="M12 5v14M5 12h14"/>', 26);
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6 6 18"/>', 16);
const ICON_CHEV = svg('<path d="m9 6 6 6-6 6"/>', 16);
const ICON_BACK = svg('<path d="m15 6-6 6 6 6"/>', 22);
const ICON_CHECK = svg('<path d="m5 12.5 4.5 4.5L19 7"/>', 20);
const ICON_PLAY = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>`;
const ICON_PAUSE = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>`;
const MINUS = `<span class="ios-minus" aria-hidden="true"></span>`;

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

// ── Wheel picker ─────────────────────────────────────────────────────────────
// columns: [{ values: [..labels], index, loop?, suffix? }] → { el, values() }
function wheelPicker(columns, { className = "" } = {}) {
  const el = document.createElement("div");
  el.className = `ios-wheels ${className}`.trim();
  const COPIES = 7;
  const cols = columns.map((c) => {
    const col = document.createElement("div");
    col.className = "ios-wheel-col";
    const list = document.createElement("div");
    list.className = "ios-wheel";
    list.tabIndex = 0;
    list.setAttribute("role", "listbox");
    const copies = c.loop ? COPIES : 1;
    const n = c.values.length;
    list.innerHTML = `<div class="ios-wheel-pad"></div>${Array.from({ length: copies }, () => c.values.map((v) => `<div class="ios-wheel-item">${esc(v)}</div>`).join("")).join("")}<div class="ios-wheel-pad"></div>`;
    col.appendChild(list);
    if (c.suffix) col.insertAdjacentHTML("beforeend", `<span class="ios-wheel-suffix">${esc(c.suffix)}</span>`);
    el.appendChild(col);
    const base = c.loop ? Math.floor(COPIES / 2) * n : 0;
    let idx = c.index || 0;
    const scrollTo = (i, smooth = false) => list.scrollTo({ top: (base + i) * ROW, behavior: smooth ? "smooth" : "auto" });
    let t = null;
    const items = () => list.querySelectorAll(".ios-wheel-item");
    const paint = () => {
      const at = Math.round(list.scrollTop / ROW);
      items().forEach((it, i) => it.classList.toggle("is-on", i === at));
    };
    list.addEventListener("scroll", () => {
      paint();
      clearTimeout(t);
      t = setTimeout(() => {
        const raw = Math.round(list.scrollTop / ROW);
        idx = ((raw % n) + n) % n;
        if (c.loop && Math.abs(raw - (base + idx)) >= n) scrollTo(idx);
      }, 120);
    }, { passive: true });
    list.addEventListener("click", (e) => {
      const it = e.target.closest(".ios-wheel-item");
      if (!it) return;
      const i = [...items()].indexOf(it);
      list.scrollTo({ top: i * ROW, behavior: "smooth" });
    });
    list.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      e.preventDefault();
      list.scrollBy({ top: e.key === "ArrowUp" ? -ROW : ROW, behavior: "smooth" });
    });
    requestAnimationFrame(() => { scrollTo(idx); paint(); });
    return { get: () => { const raw = Math.round(list.scrollTop / ROW); return ((raw % n) + n) % n; } };
  });
  return { el, values: () => cols.map((c) => c.get()) };
}

export function openClock({ clock = null, showToast = () => {} } = {}) {
  const hasAlarms = Boolean(clock);
  const tabs = [["world", "World Clock"], ...(hasAlarms ? [["alarms", "Alarms"]] : []), ["stopwatch", "Stopwatch"], ["timers", "Timers"]];
  let tab = load(TAB_KEY, hasAlarms ? "alarms" : "timers");
  if (!tabs.some(([id]) => id === tab)) tab = tabs[1]?.[0] || "world";
  let editing = false;
  let tick = null;
  const sheet = openUtilitySheet({ title: "Clock", className: "clock-sheet", onClose: () => clearInterval(tick) });
  sheet.body.innerHTML = `
    <div class="ios-clock">
      <div class="ios-clock-main"></div>
      <nav class="ios-tabbar" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" data-tab="${id}">${TAB_ICONS[id]}<span>${label}</span></button>`).join("")}</nav>
      <div class="ios-modal" hidden></div>
    </div>`;
  const root = sheet.body.querySelector(".ios-clock");
  const main = root.querySelector(".ios-clock-main");
  const modal = root.querySelector(".ios-modal");
  root.querySelector(".ios-tabbar").addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab]")?.dataset.tab;
    if (t && t !== tab) { tab = t; editing = false; save(TAB_KEY, tab); render(); }
  });

  // The bar at the top: close, Edit (where there's a list to edit), + .
  function navBar({ edit = false, plus = false } = {}) {
    return `<div class="ios-nav">
      <div class="ios-nav-left"><button type="button" class="ios-close" data-act="close" aria-label="Close">${ICON_CLOSE}</button>${edit ? `<button type="button" class="ios-link" data-act="edit">${editing ? "Done" : "Edit"}</button>` : ""}</div>
      <div class="ios-nav-right">${plus ? `<button type="button" class="ios-link ios-plus" data-act="add" aria-label="Add">${ICON_PLUS}</button>` : ""}</div>
    </div>`;
  }
  main.addEventListener("click", (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "close") sheet.close();
    else if (act === "edit") { editing = !editing; render(); }
  });

  function closeModal() { modal.hidden = true; modal.innerHTML = ""; }
  function openModal(html) { modal.innerHTML = `<div class="ios-modal-card">${html}</div>`; modal.hidden = false; return modal.querySelector(".ios-modal-card"); }

  // ── World Clock ─────────────────────────────────────────────────────────────
  let zones = load(ZONES_KEY, null);
  if (!Array.isArray(zones)) zones = [homeZone()];
  function renderWorld() {
    const now = new Date();
    const here = homeZone();
    main.innerHTML = `${navBar({ edit: zones.length > 0, plus: true })}
      <h1 class="ios-title">World Clock</h1>
      <div class="ios-list ios-world">${zones.length ? zones.map((z) => {
        const t = zoneTimeParts(z, now);
        return `<div class="ios-row ios-world-row${editing ? " is-editing" : ""}">
          ${editing ? `<button type="button" class="ios-del" data-del-zone="${esc(z)}" aria-label="Remove ${esc(cityFromZone(z))}">${MINUS}</button>` : ""}
          <div class="ios-world-text"><span>${esc(worldClockSubtitle(z, here, now))}</span><strong>${esc(cityFromZone(z))}</strong></div>
          ${editing ? "" : `<div class="ios-world-time" data-zone="${esc(z)}">${esc(t.time)}<small>${esc(t.ampm)}</small></div>`}
        </div>`;
      }).join("") : `<p class="ios-empty">No World Clocks</p>`}</div>`;
    main.querySelectorAll("[data-del-zone]").forEach((b) => b.addEventListener("click", () => {
      zones = zones.filter((z) => z !== b.dataset.delZone);
      save(ZONES_KEY, zones);
      if (!zones.length) editing = false;
      render();
    }));
    main.querySelector('[data-act="add"]').addEventListener("click", openCityPicker);
  }
  function openCityPicker() {
    let all = [];
    try { all = Intl.supportedValuesOf("timeZone"); } catch { all = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Amsterdam", "Europe/Paris", "Asia/Tokyo", "Australia/Sydney"]; }
    const cities = all.filter((z) => z.includes("/") && !z.startsWith("Etc/")).map((z) => ({ z, name: cityFromZone(z), region: z.split("/")[0].replace(/_/g, " ") })).sort((a, b) => a.name.localeCompare(b.name));
    const card = openModal(`
      <div class="ios-modal-head"><span></span><strong>Choose a City</strong><button type="button" class="ios-link" data-m="cancel">Cancel</button></div>
      <div class="ios-search"><input type="search" placeholder="Search" aria-label="Search cities" autocomplete="off"></div>
      <div class="ios-city-list"></div>`);
    const list = card.querySelector(".ios-city-list");
    const input = card.querySelector("input");
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      const hits = cities.filter((c) => !q || c.name.toLowerCase().includes(q) || c.region.toLowerCase().includes(q)).slice(0, 200);
      list.innerHTML = hits.map((c) => `<button type="button" class="ios-city" data-zone="${esc(c.z)}">${esc(c.name)}, ${esc(c.region)}</button>`).join("") || `<p class="ios-empty">No Results</p>`;
    };
    input.addEventListener("input", draw);
    list.addEventListener("click", (e) => {
      const z = e.target.closest("[data-zone]")?.dataset.zone;
      if (!z) return;
      if (!zones.includes(z)) zones = [...zones, z];
      save(ZONES_KEY, zones);
      closeModal(); render();
    });
    card.querySelector('[data-m="cancel"]').addEventListener("click", closeModal);
    draw();
    setTimeout(() => input.focus(), 50);
  }

  // ── Alarms (AlarmKit) ───────────────────────────────────────────────────────
  let alarms = load(ALARMS_KEY, []).filter((a) => a && a.id);
  const saveAlarms = () => save(ALARMS_KEY, alarms);
  async function ensureAuthorized() {
    const st = (await clock.authorization())?.state;
    if (st === "authorized") return;
    const r = (await clock.requestAuthorization())?.state;
    if (r !== "authorized") throw new Error("Allow alarms for Liv in Settings");
  }
  async function scheduleNative(a) {
    await ensureAuthorized();
    const r = await clock.scheduleAlarm({ hour: a.hour, minute: a.minute, label: a.label || "Alarm", weekdays: a.weekdays || [] });
    return r?.id || null;
  }
  async function syncAlarms() {
    try {
      const native = (await clock.list())?.alarms || [];
      alarms = reconcileAlarms(alarms, native);
      saveAlarms();
    } catch { /* keep what we have */ }
  }
  function alarmTime(a) {
    const h = a.hour % 12 || 12;
    return { time: `${h}:${String(a.minute).padStart(2, "0")}`, ampm: a.hour < 12 ? "AM" : "PM" };
  }
  function renderAlarms() {
    main.innerHTML = `${navBar({ edit: alarms.length > 0, plus: true })}
      <h1 class="ios-title">Alarms</h1>
      ${alarms.length ? `<p class="ios-section">Other</p>` : ""}
      <div class="ios-list ios-alarms">${alarms.length ? alarms.map((a) => {
        const t = alarmTime(a);
        const sub = [a.label || "Alarm", alarmRepeatText(a.weekdays)].filter(Boolean).join(", ");
        return `<div class="ios-row ios-alarm-row${a.enabled ? "" : " is-off"}${editing ? " is-editing" : ""}" data-alarm="${esc(a.id)}">
          ${editing ? `<button type="button" class="ios-del" data-del-alarm="${esc(a.id)}" aria-label="Delete alarm">${MINUS}</button>` : ""}
          <button type="button" class="ios-alarm-main" data-open-alarm="${esc(a.id)}"><span class="ios-alarm-time">${esc(t.time)}<small>${t.ampm}</small></span><span class="ios-alarm-sub">${esc(sub)}</span></button>
          ${editing ? `<span class="ios-chev">${ICON_CHEV}</span>` : `<label class="ios-switch"><input type="checkbox" data-toggle-alarm="${esc(a.id)}" ${a.enabled ? "checked" : ""} aria-label="Alarm ${esc(t.time)} ${t.ampm}"><span></span></label>`}
        </div>`;
      }).join("") : `<p class="ios-empty ios-empty-big">No Alarms</p>`}</div>`;
    main.querySelector('[data-act="add"]').addEventListener("click", () => openAlarmEditor(null));
    main.querySelectorAll("[data-open-alarm]").forEach((b) => b.addEventListener("click", () => openAlarmEditor(alarms.find((a) => a.id === b.dataset.openAlarm))));
    main.querySelectorAll("[data-toggle-alarm]").forEach((input) => input.addEventListener("change", async () => {
      const a = alarms.find((x) => x.id === input.dataset.toggleAlarm);
      if (!a) return;
      try {
        if (input.checked) {
          const nativeId = await scheduleNative(a);
          alarms = alarms.map((x) => (x.id === a.id ? { ...x, enabled: true, nativeId } : x));
        } else {
          if (a.nativeId) await clock.cancel({ id: a.nativeId }).catch(() => {});
          alarms = alarms.map((x) => (x.id === a.id ? { ...x, enabled: false, nativeId: null } : x));
        }
        saveAlarms();
      } catch (err) {
        input.checked = !input.checked;
        showToast(`Couldn't set the alarm: ${err?.message || "error"}`);
      }
      render();
    }));
    main.querySelectorAll("[data-del-alarm]").forEach((b) => b.addEventListener("click", () => deleteAlarm(b.dataset.delAlarm)));
  }
  async function deleteAlarm(id) {
    const a = alarms.find((x) => x.id === id);
    if (a?.nativeId) await clock.cancel({ id: a.nativeId }).catch(() => {});
    alarms = alarms.filter((x) => x.id !== id);
    saveAlarms();
    if (!alarms.length) editing = false;
    render();
  }
  function openAlarmEditor(existing) {
    const draft = existing ? { ...existing, weekdays: [...(existing.weekdays || [])] } : { id: `alarm-${Date.now().toString(36)}`, hour: 7, minute: 0, label: "Alarm", weekdays: [], enabled: true, nativeId: null };
    const card = openModal(`
      <div class="ios-modal-head"><button type="button" class="ios-link" data-m="cancel">Cancel</button><strong>${existing ? "Edit Alarm" : "Add Alarm"}</strong><button type="button" class="ios-link is-bold" data-m="save">Save</button></div>
      <div class="ios-modal-body">
        <div class="ios-wheel-host"></div>
        <div class="ios-group">
          <button type="button" class="ios-cell" data-m="repeat"><span>Repeat</span><span class="ios-cell-value"><em>${esc(alarmRepeatText(draft.weekdays) || "Never")}</em>${ICON_CHEV}</span></button>
          <label class="ios-cell"><span>Label</span><input type="text" class="ios-cell-input" maxlength="40" value="${esc(draft.label || "")}" placeholder="Alarm"></label>
        </div>
        ${existing ? `<div class="ios-group"><button type="button" class="ios-cell is-danger" data-m="delete">Delete Alarm</button></div>` : ""}
      </div>
      <div class="ios-subpage" hidden></div>`);
    const wheel = wheelPicker([
      { values: Array.from({ length: 12 }, (_, i) => String(i + 1)), index: ((draft.hour % 12) || 12) - 1, loop: true },
      { values: Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0")), index: draft.minute, loop: true },
      { values: ["AM", "PM"], index: draft.hour < 12 ? 0 : 1 },
    ], { className: "is-alarm" });
    card.querySelector(".ios-wheel-host").appendChild(wheel.el);
    const sub = card.querySelector(".ios-subpage");
    card.querySelector('[data-m="repeat"]').addEventListener("click", () => {
      const drawRepeat = () => {
        sub.innerHTML = `<div class="ios-modal-head"><button type="button" class="ios-link ios-back" data-m="back">${ICON_BACK}Back</button><strong>Repeat</strong><span></span></div>
          <div class="ios-modal-body"><div class="ios-group">${WEEKDAYS.map((d) => `<button type="button" class="ios-cell" data-day="${d}"><span>Every ${DAY_NAMES[d]}</span><span class="ios-check">${draft.weekdays.includes(d) ? ICON_CHECK : ""}</span></button>`).join("")}</div></div>`;
      };
      drawRepeat();
      sub.hidden = false;
      sub.onclick = (e) => {
        if (e.target.closest('[data-m="back"]')) {
          sub.hidden = true;
          card.querySelector('[data-m="repeat"] em').textContent = alarmRepeatText(draft.weekdays) || "Never";
          return;
        }
        const d = e.target.closest("[data-day]")?.dataset.day;
        if (!d) return;
        draft.weekdays = draft.weekdays.includes(d) ? draft.weekdays.filter((x) => x !== d) : WEEKDAYS.filter((x) => x === d || draft.weekdays.includes(x));
        drawRepeat();
      };
    });
    card.querySelector('[data-m="cancel"]').addEventListener("click", closeModal);
    card.querySelector('[data-m="delete"]')?.addEventListener("click", async () => { closeModal(); await deleteAlarm(existing.id); });
    card.querySelector('[data-m="save"]').addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      const [hi, mi, ap] = wheel.values();
      const hour12 = hi + 1;
      draft.hour = (hour12 % 12) + (ap === 1 ? 12 : 0);
      draft.minute = mi;
      draft.label = card.querySelector(".ios-cell-input").value.trim() || "Alarm";
      try {
        if (existing?.nativeId) await clock.cancel({ id: existing.nativeId }).catch(() => {});
        const nativeId = await scheduleNative(draft);
        const saved = { ...draft, enabled: true, nativeId };
        alarms = [...alarms.filter((a) => a.id !== draft.id), saved].sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
        saveAlarms();
        closeModal();
        render();
      } catch (err) {
        btn.disabled = false;
        showToast(`Couldn't set the alarm: ${err?.message || "error"}`);
      }
    });
  }

  // ── Stopwatch ───────────────────────────────────────────────────────────────
  let sw = { ...createStopwatch(), ...load(SW_KEY, {}) };
  const saveSw = () => save(SW_KEY, sw);
  function renderStopwatch() {
    const elapsed = stopwatchElapsed(sw);
    const started = sw.running || elapsed > 0;
    const { best, worst } = lapExtremes(sw.laps);
    const current = started ? elapsed - (sw.laps[0]?.total || 0) : 0;
    main.innerHTML = `${navBar()}
      <div class="ios-sw-face"><div class="ios-sw-time" id="swTime">${esc(formatDuration(elapsed, { hundredths: true }))}</div></div>
      <div class="ios-round-row">
        <button type="button" class="ios-round is-grey" id="swLeft" ${!sw.running && !started ? "disabled" : ""}>${sw.running || !started ? "Lap" : "Reset"}</button>
        <button type="button" class="ios-round ${sw.running ? "is-red" : "is-green"}" id="swRight">${sw.running ? "Stop" : "Start"}</button>
      </div>
      <div class="ios-laps">
        ${started ? `<div class="ios-lap"><span>Lap ${sw.laps.length + 1}</span><span id="swLap">${esc(formatDuration(current, { hundredths: true }))}</span></div>` : ""}
        ${sw.laps.map((l) => `<div class="ios-lap${l.n === best ? " is-best" : l.n === worst ? " is-worst" : ""}"><span>Lap ${l.n}</span><span>${esc(formatDuration(l.split, { hundredths: true }))}</span></div>`).join("")}
      </div>`;
    main.querySelector("#swRight").addEventListener("click", () => { sw = sw.running ? stopwatchStop(sw) : stopwatchStart(sw); saveSw(); render(); });
    main.querySelector("#swLeft").addEventListener("click", () => { sw = sw.running ? stopwatchLap(sw) : stopwatchReset(); saveSw(); render(); });
  }

  // ── Timers ──────────────────────────────────────────────────────────────────
  let timers = load(TIMERS_KEY, []).filter((t) => t && t.id);
  let recents = load(RECENTS_KEY, []);
  let pickerValues = load("live-clock-timer-pick-v1", [0, 15, 0]);
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
    recents = addRecentTimer(recents, { seconds, label });
    save(RECENTS_KEY, recents);
    saveTimers();
    render();
  }
  function timerPickerHtml() {
    return `<div class="ios-wheel-host"></div>`;
  }
  function mountTimerPicker(host) {
    const wheel = wheelPicker([
      { values: Array.from({ length: 24 }, (_, i) => String(i)), index: pickerValues[0], suffix: "hours" },
      { values: Array.from({ length: 60 }, (_, i) => String(i)), index: pickerValues[1], suffix: "min" },
      { values: Array.from({ length: 60 }, (_, i) => String(i)), index: pickerValues[2], suffix: "sec" },
    ], { className: "is-timer" });
    host.appendChild(wheel.el);
    return () => {
      pickerValues = wheel.values();
      save("live-clock-timer-pick-v1", pickerValues);
      const [h, m, s] = pickerValues;
      return timerSeconds({ hours: h, minutes: m, seconds: s });
    };
  }
  function ringSvg(t, now) {
    const total = t.seconds * 1000;
    const left = timerRemaining(t, now);
    const frac = total ? Math.max(0, Math.min(1, left / total)) : 0;
    const C = 2 * Math.PI * 21;
    return `<svg class="ios-timer-ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21" class="ios-ring-bg"/><circle cx="24" cy="24" r="21" class="ios-ring-fg" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/></svg>`;
  }
  function renderTimers() {
    const now = Date.now();
    const running = timers.filter((t) => !timerDone(t, now));
    const recentHtml = recents.length ? `<p class="ios-section">Recents</p><div class="ios-list">${recents.map((r, i) => `
      <div class="ios-row ios-recent${editing ? " is-editing" : ""}">
        ${editing ? `<button type="button" class="ios-del" data-del-recent="${i}" aria-label="Remove">${MINUS}</button>` : ""}
        <div class="ios-recent-text"><strong>${esc(formatDuration(r.seconds * 1000))}</strong><span>${esc(r.label || durationWords(r.seconds))}</span></div>
        ${editing ? "" : `<button type="button" class="ios-play-btn is-green" data-recent="${i}" aria-label="Start ${esc(durationWords(r.seconds))}">${ICON_PLAY}</button>`}
      </div>`).join("")}</div>` : "";
    if (!running.length) {
      main.innerHTML = `${navBar({ edit: recents.length > 0 })}
        <h1 class="ios-title">Timers</h1>
        ${timerPickerHtml()}
        <div class="ios-round-row">
          <button type="button" class="ios-round is-grey" disabled>Cancel</button>
          <button type="button" class="ios-round is-green" id="timerStart">Start</button>
        </div>
        <div class="ios-group"><label class="ios-cell"><span>Label</span><input type="text" class="ios-cell-input" id="timerLabel" maxlength="40" placeholder="Timer"></label></div>
        ${recentHtml}`;
      const read = mountTimerPicker(main.querySelector(".ios-wheel-host"));
      main.querySelector("#timerStart").addEventListener("click", () => addTimer(read(), main.querySelector("#timerLabel").value.trim()));
    } else {
      main.innerHTML = `${navBar({ edit: true, plus: true })}
        <h1 class="ios-title">Timers</h1>
        <div class="ios-list ios-timers">${running.map((t) => `
          <div class="ios-row ios-timer-row${editing ? " is-editing" : ""}" data-timer="${esc(t.id)}">
            ${editing ? `<button type="button" class="ios-del" data-remove="${esc(t.id)}" aria-label="Cancel timer">${MINUS}</button>` : ""}
            <div class="ios-timer-text"><strong class="timer-left">${esc(formatDuration(timerRemaining(t, now)))}</strong><span>${esc(t.label || durationWords(t.seconds))}</span></div>
            ${editing ? "" : `<button type="button" class="ios-play-btn ${t.endsAt ? "is-orange" : "is-green"}" data-toggle="${esc(t.id)}" aria-label="${t.endsAt ? "Pause" : "Resume"}">${ringSvg(t, now)}${t.endsAt ? ICON_PAUSE : ICON_PLAY}</button>`}
          </div>`).join("")}</div>
        ${recentHtml}`;
      main.querySelector('[data-act="add"]').addEventListener("click", () => {
        const card = openModal(`
          <div class="ios-modal-head"><button type="button" class="ios-link" data-m="cancel">Cancel</button><strong>Timer</strong><button type="button" class="ios-link is-bold" data-m="start">Start</button></div>
          <div class="ios-modal-body">${timerPickerHtml()}
            <div class="ios-group"><label class="ios-cell"><span>Label</span><input type="text" class="ios-cell-input" maxlength="40" placeholder="Timer"></label></div>
          </div>`);
        const read = mountTimerPicker(card.querySelector(".ios-wheel-host"));
        card.querySelector('[data-m="cancel"]').addEventListener("click", closeModal);
        card.querySelector('[data-m="start"]').addEventListener("click", () => { const secs = read(); const label = card.querySelector(".ios-cell-input").value.trim(); closeModal(); addTimer(secs, label); });
      });
    }
    main.querySelectorAll("[data-recent]").forEach((b) => b.addEventListener("click", () => {
      const r = recents[Number(b.dataset.recent)];
      if (r) addTimer(r.seconds, r.label || "");
    }));
    main.querySelectorAll("[data-del-recent]").forEach((b) => b.addEventListener("click", () => {
      recents = recents.filter((_, i) => i !== Number(b.dataset.delRecent));
      save(RECENTS_KEY, recents);
      if (!recents.length && !timers.length) editing = false;
      render();
    }));
    main.querySelectorAll("[data-toggle]").forEach((b) => b.addEventListener("click", () => {
      timers = timers.map((t) => {
        if (t.id !== b.dataset.toggle) return t;
        const next = t.endsAt ? pauseTimer(t) : resumeTimer(t);
        if (t.system && clock) clock[t.endsAt ? "pause" : "resume"]({ id: t.id }).catch(() => {});
        return next;
      });
      saveTimers(); render();
    }));
    main.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
      const t = timers.find((x) => x.id === b.dataset.remove);
      if (t?.system && clock && !timerDone(t)) clock.cancel({ id: t.id }).catch(() => {});
      timers = timers.filter((x) => x.id !== b.dataset.remove);
      if (!timers.length) editing = false;
      saveTimers(); render();
    }));
  }
  function tickTimers() {
    const now = Date.now();
    let changed = false;
    for (const t of timers) {
      if (timerDone(t, now)) {
        changed = true;
        // AlarmKit rings a system timer itself; an in-page one beeps here.
        if (!t.system && !t.rang) { beep(); showToast(`${t.label || "Timer"} is done`); }
        continue;
      }
      const row = main.querySelector(`[data-timer="${CSS.escape(t.id)}"]`);
      if (!row) continue;
      const left = row.querySelector(".timer-left");
      if (left) left.textContent = formatDuration(timerRemaining(t, now));
      const ring = row.querySelector(".ios-timer-ring");
      if (ring) ring.outerHTML = ringSvg(t, now);
    }
    if (changed) {
      timers = timers.filter((t) => !timerDone(t, now));
      saveTimers();
      if (modal.hidden && tab === "timers") render();
    }
  }

  function render() {
    root.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    main.dataset.tab = tab;
    if (tab === "world") renderWorld();
    else if (tab === "alarms") renderAlarms();
    else if (tab === "timers") renderTimers();
    else renderStopwatch();
  }
  let lastMinute = -1;
  let lastQuarter = -1;
  tick = setInterval(() => {
    if (tab === "stopwatch" && sw.running) {
      const el = main.querySelector("#swTime");
      const elapsed = stopwatchElapsed(sw);
      if (el) el.textContent = formatDuration(elapsed, { hundredths: true });
      const lap = main.querySelector("#swLap");
      if (lap) lap.textContent = formatDuration(elapsed - (sw.laps[0]?.total || 0), { hundredths: true });
    }
    const sec = Math.floor(Date.now() / 250);
    if (sec !== lastQuarter) { lastQuarter = sec; tickTimers(); }
    const m = new Date().getMinutes();
    if (m !== lastMinute) { lastMinute = m; if (tab === "world" && !editing && modal.hidden) renderWorld(); }
  }, 50);
  render();
  if (hasAlarms) syncAlarms().then(() => { if (tab === "alarms" && modal.hidden) render(); });
  return sheet;
}
