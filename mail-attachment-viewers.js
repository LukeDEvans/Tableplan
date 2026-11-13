// mail-attachment-viewers.js — the web's in-app attachment viewer: a full-window
// dialog over the Mail page (`#mailAttachmentViewer`). mail-attachment-view.js
// decides the kind; this file draws it. app.js calls showMailAttachmentViewer()
// with the bytes and injects the few things that reach other pages.
//
//   pdf / image      the browser's own viewer, from a blob: URL of a fixed type
//   text             as text
//   csv              a table (first row as the heading)
//   invite (.ics)    each event's title, time, place and notes, with Add to Calendar
//   contact (.vcf)   each contact's details, with Add to Contacts
//   audio / video    a media element with controls
//   anything else    Download, and Open in Gmail
//
// SECURITY (see mail-attachment-view.js): nothing from the file is ever parsed as
// markup. Every value the sender wrote goes in through textContent, and a blob
// never carries the sender's declared type. A contact's photo is shown only when
// it is an inline bitmap (data:image/png|jpeg|gif|webp); nothing here loads
// anything from the network.

import {
  ATTACHMENT_TEXT_PREVIEW_MAX, attachmentViewKind, attachmentBlobType, attachmentText, sniffDelimiter, parseDelimited
} from "./mail-attachment-view.js";
import { parsePlanIcs } from "./calendar/ics.mjs";
import { parseVcf } from "./contacts.js";

export const INVITE_MAX_EVENTS = 25;
export const CONTACT_MAX_CARDS = 50;
const INLINE_PHOTO_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function dateFromKey(key) {
  const [y, m, d] = String(key || "").split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
function timeLabel(hhmm, locale) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isFinite(h)) return "";
  return new Date(2000, 0, 1, h, m || 0).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}
const FREQ_LABEL = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };

// "Fri, Nov 20, 2026 · 2:00 PM – 3:00 PM" for an event from parsePlanIcs. Pure.
export function inviteWhen(event, locale = undefined) {
  const start = dateFromKey(event?.date);
  if (!start) return "";
  const day = (d) => d.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const end = dateFromKey(event.endDate);
  if (event.allDay !== false || !event.startTime) {
    return end && end > start ? `${day(start)} – ${day(end)} · All day` : `${day(start)} · All day`;
  }
  const from = timeLabel(event.startTime, locale);
  const to = timeLabel(event.endTime, locale);
  if (end && end > start) return `${day(start)}, ${from} – ${day(end)}${to ? `, ${to}` : ""}`;
  return `${day(start)} · ${from}${to ? ` – ${to}` : ""}`;
}

// "Repeats every week" / "Repeats every 2 weeks", or "" for a one-off. Pure.
export function inviteRepeats(event) {
  const rec = event?.recurrence;
  const unit = FREQ_LABEL[rec?.freq];
  if (!unit) return "";
  const n = Math.max(1, Number(rec.interval) || 1);
  return n === 1 ? `Repeats every ${unit}` : `Repeats every ${n} ${unit}s`;
}

// What Add to Calendar hands the event editor. Pure.
export function invitePrefill(event) {
  const timed = event.allDay === false && !!event.startTime;
  return {
    title: event.title || "",
    date: event.date,
    allDay: !timed,
    startTime: timed ? event.startTime : "",
    endTime: timed ? (event.endTime || "") : "",
    notes: event.notes || "",
    location: event.location || "",
    recurrence: event.recurrence || null
  };
}

function row(label, value) {
  const wrap = el("div", "mail-att-field");
  wrap.append(el("span", "mail-att-field-label", label), el("span", "mail-att-field-value", value));
  return wrap;
}

function renderInvite(body, text, { addInviteEvent, timeZone, close }) {
  let events = [];
  try { events = parsePlanIcs(text, { timeZone }); } catch { events = []; }
  if (!events.length) return false;
  const list = el("div", "mail-att-cards");
  events.slice(0, INVITE_MAX_EVENTS).forEach((event) => {
    const card = el("article", "mail-att-card");
    card.append(el("h3", "mail-att-card-title", event.title));
    card.append(row("When", [inviteWhen(event), inviteRepeats(event)].filter(Boolean).join(" · ")));
    if (event.location) card.append(row("Where", event.location));
    if (event.notes) card.append(row("Notes", event.notes));
    if (addInviteEvent) {
      const add = el("button", "primary-btn mail-att-card-action", "Add to Calendar");
      add.type = "button";
      add.addEventListener("click", () => { close(); addInviteEvent(invitePrefill(event)); });
      card.append(add);
    }
    list.append(card);
  });
  if (events.length > INVITE_MAX_EVENTS) list.append(el("p", "mail-att-note", `Showing the first ${INVITE_MAX_EVENTS} of ${events.length} events.`));
  body.append(list);
  return true;
}

function renderContacts(body, text, { addContacts, close }) {
  let cards = [];
  try { cards = parseVcf(text); } catch { cards = []; }
  if (!cards.length) return false;
  const list = el("div", "mail-att-cards");
  if (addContacts) {
    const add = el("button", "primary-btn mail-att-cards-action", cards.length === 1 ? "Add to Contacts" : `Add ${cards.length} to Contacts`);
    add.type = "button";
    add.addEventListener("click", () => { close(); addContacts(text); });
    list.append(add);
  }
  cards.slice(0, CONTACT_MAX_CARDS).forEach((c) => {
    const card = el("article", "mail-att-card");
    const head = el("div", "mail-att-card-head");
    if (INLINE_PHOTO_RE.test(c.photo || "")) {
      const img = el("img", "mail-att-card-photo");
      img.alt = "";
      img.src = c.photo;
      head.append(img);
    }
    head.append(el("h3", "mail-att-card-title", c.name));
    card.append(head);
    (c.phones || []).forEach((p) => card.append(row(p.label || "Phone", p.value)));
    (c.emails || []).forEach((e) => card.append(row(e.label || "Email", e.value)));
    (c.addresses || []).forEach((a) => card.append(row(a.label || "Address", a.value)));
    if (c.birthday) card.append(row("Birthday", c.birthday));
    (c.dates || []).forEach((d) => card.append(row(d.label || "Date", d.value)));
    if ((c.groups || []).length) card.append(row("Groups", c.groups.join(", ")));
    if (c.notes) card.append(row("Notes", c.notes));
    list.append(card);
  });
  if (cards.length > CONTACT_MAX_CARDS) list.append(el("p", "mail-att-note", `Showing the first ${CONTACT_MAX_CARDS} of ${cards.length} contacts.`));
  body.append(list);
  return true;
}

function renderTable(body, text, filename) {
  const { rows, cols, more } = parseDelimited(text, { delimiter: sniffDelimiter(text, filename) });
  if (!rows.length || cols < 2) return false; // one column reads better as plain text
  const wrap = el("div", "mail-att-table-wrap");
  const table = el("table", "mail-att-table");
  const fill = (tr, cells, tag) => {
    for (let i = 0; i < cols; i++) tr.append(el(tag, "", cells[i] ?? ""));
  };
  const head = el("thead");
  const headRow = el("tr");
  fill(headRow, rows[0], "th");
  head.append(headRow);
  const tbody = el("tbody");
  for (let r = 1; r < rows.length; r++) {
    const tr = el("tr");
    fill(tr, rows[r], "td");
    tbody.append(tr);
  }
  table.append(head, tbody);
  wrap.append(table);
  if (more) wrap.append(el("p", "mail-att-note", "This is the start of the file. Download it for the rest."));
  body.append(wrap);
  return true;
}

function renderText(body, text) {
  const pre = el("pre", "mail-att-viewer-text");
  pre.textContent = text.length > ATTACHMENT_TEXT_PREVIEW_MAX
    ? text.slice(0, ATTACHMENT_TEXT_PREVIEW_MAX) + "\n\n… (preview cut short — download for the whole file)"
    : text;
  body.append(pre);
}

// Opens the viewer. deps: { saveFile, addInviteEvent?, addContacts?, timeZone? }.
// Returns the kind that was shown ("none" when only Download was offered).
export function showMailAttachmentViewer({ bytes, filename, mimeType, gmailUrl }, deps = {}) {
  document.getElementById("mailAttachmentViewer")?.remove();
  const kind = attachmentViewKind(mimeType, filename);
  const urls = [];
  const blobUrl = () => {
    const url = URL.createObjectURL(new Blob([bytes], { type: attachmentBlobType(kind, mimeType, filename) }));
    urls.push(url);
    return url;
  };

  const dlg = el("dialog", "mail-att-viewer");
  dlg.id = "mailAttachmentViewer";
  dlg.setAttribute("aria-label", filename);
  dlg.innerHTML = `
    <div class="mail-att-viewer-bar">
      <button class="icon-btn mail-att-viewer-close" type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
      <span class="mail-att-viewer-name"></span>
      <button class="secondary-btn mail-att-viewer-download" type="button">Download</button>
    </div>
    <div class="mail-att-viewer-body"></div>`;
  dlg.querySelector(".mail-att-viewer-name").textContent = filename;
  const body = dlg.querySelector(".mail-att-viewer-body");
  const close = () => dlg.close();
  const download = () => {
    deps.saveFile?.(new Blob([bytes], { type: "application/octet-stream" }), filename)?.catch?.((e) => console.warn("attachment save failed", e));
  };

  let shown = kind;
  if (kind === "pdf") {
    const frame = el("iframe", "mail-att-viewer-pdf");
    frame.title = filename;
    frame.src = blobUrl();
    body.append(frame);
  } else if (kind === "image") {
    const img = el("img", "mail-att-viewer-img");
    img.alt = filename;
    img.src = blobUrl();
    body.append(img);
  } else if (kind === "audio" || kind === "video") {
    const media = el(kind, `mail-att-viewer-${kind}`);
    media.controls = true;
    media.preload = "metadata";
    if (kind === "video") media.playsInline = true;
    media.src = blobUrl();
    body.append(media);
  } else if (kind === "text" || kind === "csv" || kind === "invite" || kind === "contact") {
    const text = attachmentText(bytes);
    // A file that isn't what its name says (no events, no contacts, one column)
    // still opens: as plain text.
    const drawn = kind === "invite" ? renderInvite(body, text, { addInviteEvent: deps.addInviteEvent, timeZone: deps.timeZone, close })
      : kind === "contact" ? renderContacts(body, text, { addContacts: deps.addContacts, close })
      : kind === "csv" ? renderTable(body, text, filename)
      : false;
    if (!drawn) { renderText(body, text); shown = "text"; }
  } else {
    const empty = el("div", "mail-att-viewer-empty");
    empty.innerHTML = `<p>This kind of file can't be previewed here.</p>
      <div class="mail-att-viewer-actions">
        <button class="primary-btn" type="button" data-att-download>Download</button>
        <a class="secondary-btn" target="_blank" rel="noopener noreferrer">Open in Gmail</a>
      </div>`;
    empty.querySelector("a").href = gmailUrl;
    empty.querySelector("[data-att-download]").addEventListener("click", download);
    dlg.querySelector(".mail-att-viewer-download").hidden = true;
    body.append(empty);
  }
  dlg.dataset.kind = shown;

  dlg.querySelector(".mail-att-viewer-download").addEventListener("click", download);
  dlg.querySelector(".mail-att-viewer-close").addEventListener("click", close);
  dlg.addEventListener("close", () => {
    dlg.querySelectorAll("audio, video").forEach((m) => { try { m.pause(); } catch { /* already gone */ } });
    urls.forEach((u) => URL.revokeObjectURL(u));
    dlg.remove();
  });
  document.body.appendChild(dlg);
  dlg.showModal();
  return shown;
}
