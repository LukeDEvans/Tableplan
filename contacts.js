// contacts.js — the Contacts domain, extracted from app.js as a PURE STRUCTURAL
// MOVE (no behavior change). Rendering, editing, groups, photo, vCard import/
// export, and all contacts state mutation live here; app.js keeps only the thin
// nav entry `showContactsApp` (page routing) and calls into this module.
//
// Dependencies from the app shell are INJECTED via createContactsModule(deps):
//   state          the shared app-state object (contacts read/write state.contacts,
//                  state.contactGroups, state.tombstones — the SAME object app.js holds)
//   elements       the shared DOM-refs object (contactsGrid, contact dialogs, …)
//   persist        save the state (Supabase-backed; contacts are personal state)
//   createId       id generator (same as the app shell's)
//   escapeHtml     HTML-escape helper
//   showMailToast  the shared toast (with optional undo callback)
//   recordDeletion tombstone a deleted id so the delete survives a cross-device merge
//   refreshPlanIfActive  SHARED-STATE TOUCHPOINT — contact birthdays / important
//                  dates appear on the calendar, so a contact change re-renders the
//                  Plan page when it's open. app.js supplies:
//                    () => { if (activeAppArea === "plan") renderPlanPage(); }
//
// The normalizers are PURE top-level exports (createId passed in) because the app
// shell calls them at boot from defaultState(), before this module's factory runs.

import { makeSortable } from './sortable.js';

// "YYYY-MM-DD" (with year), so the birthday calendar can show an age.
const CONTACT_DATE_RE = /^(\d{4}-)?(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function normalizeContactRows(arr, defLabel, createId) {
  return Array.isArray(arr) ? arr.map((r) => ({
    id: r?.id || createId("crow"),
    label: String(r?.label ?? "").trim() || defLabel,
    value: String(r?.value ?? "").trim(),
  })).filter((r) => r.value) : [];
}
export function normalizeContacts(list, createId) {
  return Array.isArray(list) ? list.map((c) => {
    let firstName = String(c?.firstName ?? "").trim();
    let lastName = String(c?.lastName ?? "").trim();
    // Migrate older single-"name" records: first token → first, rest → last.
    if (!firstName && !lastName && c?.name) {
      const parts = String(c.name).trim().split(/\s+/);
      firstName = parts.shift() || "";
      lastName = parts.join(" ");
    }
    const name = `${firstName} ${lastName}`.trim() || String(c?.name || "").trim();
    // Migrate older single phone/email strings into the labelled lists.
    let phones = normalizeContactRows(c?.phones, "Mobile", createId);
    if (!phones.length && String(c?.phone || "").trim()) phones = [{ id: createId("crow"), label: "Mobile", value: String(c.phone).trim() }];
    let emails = normalizeContactRows(c?.emails, "Email", createId);
    if (!emails.length && String(c?.email || "").trim()) emails = [{ id: createId("crow"), label: "Email", value: String(c.email).trim() }];
    return {
      id: c?.id || createId("contact"),
      firstName, lastName, name,
      favorite: Boolean(c?.favorite),
      photo: (typeof c?.photo === "string" && c.photo.startsWith("data:image")) ? c.photo : "",
      phones, emails,
      birthday: (typeof c?.birthday === "string" && CONTACT_DATE_RE.test(c.birthday)) ? c.birthday : "",
      dates: normalizeContactRows(c?.dates, "Date", createId).filter((d) => CONTACT_DATE_RE.test(d.value)),
      addresses: normalizeContactRows(c?.addresses, "Home", createId),
      groups: Array.isArray(c?.groups) ? [...new Set(c.groups.map((g) => String(g || "").trim()).filter(Boolean))] : [],
      notes: String(c?.notes || "").trim(),
      createdAt: c?.createdAt || new Date().toISOString(),
    };
  }).filter((c) => c.name) : [];
}

// The explicit groups registry lets a group exist (and stay selectable in the
// sidebar) even with zero contacts in it — the way an empty email folder or an
// unused calendar still shows. Deduped, trimmed, non-empty.
export function normalizeContactGroups(list) {
  return Array.isArray(list) ? [...new Set(list.map((g) => String(g || "").trim()).filter(Boolean))] : [];
}

export function createContactsModule(deps) {
  const { state, elements, persist, createId, escapeHtml, showMailToast, recordDeletion, refreshPlanIfActive } = deps;

// The sidebar's group list = the registry UNIONED with every group actually in
// use on a contact, so pre-existing groups (added before the registry existed,
// or typed straight into the contact editor) still appear. Sorted A–Z.
function allContactGroups() {
  const set = new Set(normalizeContactGroups(state.contactGroups));
  (state.contacts || []).forEach((c) => (c.groups || []).forEach((g) => { const t = String(g || "").trim(); if (t) set.add(t); }));
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ── Contacts page ─────────────────────────────────────────────────────────────
const CONTACT_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const CONTACT_MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
let editingContactId = null;
let contactPhotoDraft = "";
// Which group the sidebar has selected ("" = All Contacts). Single-select
// navigation, mirroring the Mail folder list.
let contactsSelectedGroup = "";

function contactInitials(name) {
  return (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
}

// "MM-DD" → "March 5"; "YYYY-MM-DD" → "March 5, 1990".
function formatContactBirthday(bday) {
  if (!bday) return "";
  const mmdd = bday.length > 5 ? bday.slice(5) : bday;
  const [mo, day] = mmdd.split("-").map(Number);
  const label = `${CONTACT_MONTHS[mo - 1]} ${day}`;
  return bday.length > 5 ? `${label}, ${bday.slice(0, 4)}` : label;
}

// Days until the next yearly occurrence of an "MM-DD"/"YYYY-MM-DD" date.
function contactDaysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const mmdd = dateStr.length > 5 ? dateStr.slice(5) : dateStr;
  const [mo, day] = mmdd.split("-").map(Number);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let next = new Date(today.getFullYear(), mo - 1, day);
  if (next < today) next = new Date(today.getFullYear() + 1, mo - 1, day);
  return Math.round((next - today) / 86400000);
}

const CONTACT_STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L4.5 9.7l5.9-.9z"/></svg>';
const CONTACT_COPY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
let contactsGridBound = false;

// The letter a contact files under for the A–Z index, given the active sort.
function contactSortLetter(c, sort) {
  const s = (sort === "last" ? (c.lastName || c.name) : c.name).trim();
  const ch = (s[0] || "#").toUpperCase();
  return /[A-Z]/.test(ch) ? ch : "#";
}

function renderContactsPage() {
  const grid = elements.contactsGrid;
  if (!grid) return;
  const all = state.contacts || [];
  // The group sidebar (folder-style single-select) replaces the old dropdown.
  renderContactsGroupSidebar();
  const q = (elements.contactsSearchInput?.value || "").trim().toLowerCase();
  // A selected group that no longer exists (renamed/deleted elsewhere) falls
  // back to "All Contacts".
  if (contactsSelectedGroup && !allContactGroups().includes(contactsSelectedGroup)) contactsSelectedGroup = "";
  const group = contactsSelectedGroup;
  const sort = "last"; // always sort by last name (favorites still lead)
  let contacts = [...all];
  if (group) contacts = contacts.filter((c) => (c.groups || []).includes(group));
  if (q) contacts = contacts.filter((c) => `${c.name} ${(c.emails || []).map((e) => e.value).join(" ")} ${(c.phones || []).map((p) => p.value).join(" ")} ${c.notes} ${(c.addresses || []).map((a) => a.value).join(" ")} ${(c.groups || []).join(" ")}`.toLowerCase().includes(q));
  const sortFn = (a, b) => {
    if (sort === "last") return (a.lastName || "").localeCompare(b.lastName || "") || (a.firstName || "").localeCompare(b.firstName || "");
    if (sort === "birthday") return contactDaysUntil(a.birthday) - contactDaysUntil(b.birthday) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  };
  if (!contacts.length) {
    grid.innerHTML = `<div class="contacts-empty">${(q || group) ? "No contacts match." : "No contacts yet — add someone to get started."}</div>`;
    renderContactsRail([]);
    bindContactsGrid();
    return;
  }
  const favs = contacts.filter((c) => c.favorite).sort(sortFn);
  const rest = contacts.filter((c) => !c.favorite).sort(sortFn);
  const useLetters = sort !== "birthday";
  const head = (label, key) => `<div class="contact-section-head" data-section="${escapeHtml(key)}">${escapeHtml(label)}</div>`;
  const railKeys = [];
  let html = "";
  if (favs.length) { html += head("★ Favorites", "fav"); railKeys.push({ key: "fav", label: "★" }); html += favs.map(contactCardHtml).join(""); }
  if (useLetters) {
    let cur = null;
    rest.forEach((c) => {
      const L = contactSortLetter(c, sort);
      if (L !== cur) { cur = L; html += head(L, `L-${L}`); railKeys.push({ key: `L-${L}`, label: L }); }
      html += contactCardHtml(c);
    });
  } else {
    html += rest.map(contactCardHtml).join("");
  }
  grid.innerHTML = html;
  renderContactsRail(railKeys);
  bindContactsGrid();
}

// One delegated set of handlers on the grid (bound once): star toggle, copy
// button, tel:/mailto:/map links pass through, otherwise open the detail view.
function bindContactsGrid() {
  const grid = elements.contactsGrid;
  if (!grid || contactsGridBound) return;
  contactsGridBound = true;
  grid.addEventListener("click", (e) => {
    const fav = e.target.closest("[data-fav-toggle]");
    if (fav) { e.stopPropagation(); toggleContactFavorite(fav.dataset.favToggle); return; }
    const cp = e.target.closest("[data-copy]");
    if (cp) { e.stopPropagation(); copyContactValue(cp.dataset.copy); return; }
    if (e.target.closest("a")) return;
    const card = e.target.closest(".contact-card[data-contact-id]");
    if (card) openContactView(card.dataset.contactId);
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".contact-card[data-contact-id]");
    if (card && e.target === card) { e.preventDefault(); openContactView(card.dataset.contactId); }
  });
}

function renderContactsRail(keys) {
  const rail = document.getElementById("contactsRail");
  if (!rail) return;
  rail.innerHTML = keys.map((k) => `<button type="button" class="contact-rail-letter" data-rail="${escapeHtml(k.key)}">${escapeHtml(k.label)}</button>`).join("");
  rail.hidden = keys.length < 2;
  rail.querySelectorAll("[data-rail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      elements.contactsGrid?.querySelector(`.contact-section-head[data-section="${CSS.escape(btn.dataset.rail)}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

// The group sidebar — folder-style single-select navigation, like the Mail
// label list. "All Contacts" plus one item per group (with a live count), a
// New-group button, and a per-group ⋯ menu for rename/delete.
function renderContactsGroupSidebar() {
  const nav = document.getElementById("contactsGroupNav");
  if (!nav) return;
  const all = state.contacts || [];
  const groups = allContactGroups();
  const countIn = (g) => all.filter((c) => (c.groups || []).includes(g)).length;
  const item = (group, label, count) => {
    const active = contactsSelectedGroup === group;
    const menu = group
      ? `<button class="contacts-group-menu" type="button" data-group-menu="${escapeHtml(group)}" aria-label="Group options" title="Group options"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></button>`
      : "";
    return `
      <div class="contacts-group-row">
        <button class="contacts-group-item${active ? " is-active" : ""}" type="button" data-group="${escapeHtml(group)}" role="tab" aria-selected="${active}">
          <span class="contacts-group-name">${escapeHtml(label)}</span>
          ${count != null ? `<span class="contacts-group-count">${count}</span>` : ""}
        </button>
        ${menu}
      </div>`;
  };
  nav.innerHTML =
    item("", "All Contacts", all.length) +
    `<div class="contacts-group-divider"></div>` +
    (groups.length ? groups.map((g) => item(g, g, countIn(g))).join("") : `<p class="contacts-group-empty">No groups yet.</p>`) +
    `<button class="contacts-group-item contacts-group-new" type="button" id="contactsNewGroupBtn">
      <svg viewBox="0 0 24 24" class="contacts-group-new-icon" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      <span>New group</span>
    </button>`;

  nav.querySelectorAll(".contacts-group-item[data-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      contactsSelectedGroup = btn.dataset.group || "";
      renderContactsPage();
      // On mobile the sidebar is an overlay drawer — collapse it once a group
      // is chosen so the grid is visible right away.
      if (window.innerWidth <= 860) document.getElementById("contactsSidebar")?.classList.remove("is-expanded");
    });
  });
  document.getElementById("contactsNewGroupBtn")?.addEventListener("click", createContactGroup);
  nav.querySelectorAll("[data-group-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      showContactGroupMenu(r.right, r.bottom, btn.dataset.groupMenu);
    });
  });
}

function createContactGroup() {
  const name = prompt("New group name")?.trim();
  if (!name) return;
  const existing = allContactGroups();
  if (existing.some((g) => g.toLowerCase() === name.toLowerCase())) {
    // Reuse the existing group rather than making a case-variant duplicate.
    contactsSelectedGroup = existing.find((g) => g.toLowerCase() === name.toLowerCase());
  } else {
    state.contactGroups = [...normalizeContactGroups(state.contactGroups), name];
    contactsSelectedGroup = name;
    persist();
  }
  renderContactsPage();
}

function renameContactGroup(oldName) {
  const name = prompt("Rename group", oldName)?.trim();
  if (!name || name === oldName) return;
  const clash = allContactGroups().some((g) => g.toLowerCase() === name.toLowerCase() && g.toLowerCase() !== oldName.toLowerCase());
  if (clash && !confirm(`A group named "${name}" already exists. Merge "${oldName}" into it?`)) return;
  // Rename in the registry…
  state.contactGroups = normalizeContactGroups((normalizeContactGroups(state.contactGroups)).map((g) => g === oldName ? name : g));
  // …and on every contact that carries the old name.
  state.contacts = (state.contacts || []).map((c) => {
    if (!(c.groups || []).includes(oldName)) return c;
    return { ...c, groups: [...new Set(c.groups.map((g) => g === oldName ? name : g))] };
  });
  if (contactsSelectedGroup === oldName) contactsSelectedGroup = name;
  persist();
  renderContactsPage();
}

function deleteContactGroup(name) {
  if (!confirm(`Delete the group "${name}"?\n\nThe contacts themselves aren't deleted — they just leave this group.`)) return;
  state.contactGroups = normalizeContactGroups(state.contactGroups).filter((g) => g !== name);
  state.contacts = (state.contacts || []).map((c) => {
    if (!(c.groups || []).includes(name)) return c;
    return { ...c, groups: c.groups.filter((g) => g !== name) };
  });
  if (contactsSelectedGroup === name) contactsSelectedGroup = "";
  persist();
  renderContactsPage();
}

// Rename/Delete popover for a group, anchored to its ⋯ button. Mirrors the Mail
// folder menu.
function showContactGroupMenu(x, y, name) {
  document.getElementById("contactsGroupMenu")?.remove();
  const menu = document.createElement("div");
  menu.id = "contactsGroupMenu";
  menu.className = "mail-more-menu contacts-group-menu-popover";
  menu.style.left = Math.min(x, window.innerWidth - 190) + "px";
  menu.style.top = Math.min(y, window.innerHeight - 110) + "px";
  menu.innerHTML = `
    <button class="mail-more-option" type="button" data-group-act="rename">Rename group</button>
    <button class="mail-more-option" type="button" data-group-act="delete">Delete group</button>`;
  document.body.appendChild(menu);
  menu.addEventListener("click", (e) => {
    const act = e.target.closest("[data-group-act]")?.dataset.groupAct;
    menu.remove();
    if (act === "rename") renameContactGroup(name);
    else if (act === "delete") deleteContactGroup(name);
  });
  setTimeout(() => document.addEventListener("click", () => menu.remove(), { once: true }), 0);
}

// The contact editor's Groups field: a multi-select checklist of existing
// groups (a contact can be in several) plus an "Add a group…" pill that opens a
// window to create one. Mirrors the recipe-tag chooser's pill style.
function renderContactGroupsPicker(selected) {
  const wrap = document.getElementById("contactGroups");
  if (!wrap) return;
  const sel = new Set((selected || []).map((g) => String(g).trim()).filter(Boolean));
  // All known groups, plus any this contact already carries that aren't yet in
  // the registry (so nothing silently drops).
  const groups = [...new Set([...allContactGroups(), ...sel])].sort((a, b) => a.localeCompare(b));
  wrap.innerHTML = groups.map((g) => `
    <label class="tag-choice">
      <input type="checkbox" value="${escapeHtml(g)}" ${sel.has(g) ? "checked" : ""} />
      <span>${escapeHtml(g)}</span>
    </label>`).join("") +
    `<button type="button" class="tag-choice contact-group-add-choice" id="contactGroupAddBtn">
      <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
      <span>Add a group…</span>
    </button>`;
  wrap.querySelector("#contactGroupAddBtn")?.addEventListener("click", addGroupFromContactPicker);
}

// The groups currently ticked in the editor's picker.
function currentContactPickerSelection() {
  return [...document.querySelectorAll("#contactGroups input:checked")].map((i) => i.value);
}

// "Add a group…" — create a group and tick it, keeping whatever was already
// ticked. Registers it immediately so it's available everywhere (like the
// sidebar's New group).
function addGroupFromContactPicker() {
  const name = prompt("New group name")?.trim();
  if (!name) return;
  const match = allContactGroups().find((g) => g.toLowerCase() === name.toLowerCase());
  const finalName = match || name;
  if (!match) {
    state.contactGroups = [...normalizeContactGroups(state.contactGroups), name];
    persist();
  }
  const selected = new Set(currentContactPickerSelection());
  selected.add(finalName);
  renderContactGroupsPicker([...selected]);
}

function toggleContactFavorite(id) {
  state.contacts = (state.contacts || []).map((c) => c.id === id ? { ...c, favorite: !c.favorite } : c);
  persist();
  renderContactsPage();
}

function copyContactValue(text) {
  if (!text) return;
  const done = () => showMailToast("Copied");
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => showMailToast("Couldn't copy"));
  else done();
}

function contactAvatarHtml(c) {
  return c.photo
    ? `<span class="contact-avatar has-photo" style="background-image:url('${escapeHtml(c.photo)}')" aria-hidden="true"></span>`
    : `<span class="contact-avatar" aria-hidden="true">${escapeHtml(contactInitials(c.name))}</span>`;
}

// Detail rows shared by the card and the read-only view. `copy` adds a copy
// button beside phone/email values.
function contactDetailRowsHtml(c, { copy = false } = {}) {
  const line = (ico, html) => `<div class="contact-card-row"><span class="contact-row-ico" aria-hidden="true">${ico}</span><span class="contact-row-val">${html}</span></div>`;
  const tag = (label) => label ? `<span class="contact-row-tag">${escapeHtml(label)}</span> ` : "";
  const copyBtn = (v) => copy ? ` <button type="button" class="contact-copy" data-copy="${escapeHtml(v)}" aria-label="Copy" title="Copy">${CONTACT_COPY_SVG}</button>` : "";
  const rows = [];
  if (c.birthday) rows.push(line("🎂", escapeHtml(formatContactBirthday(c.birthday))));
  (c.dates || []).forEach((d) => rows.push(line("🎉", `${tag(d.label)}${escapeHtml(formatContactBirthday(d.value))}`)));
  (c.phones || []).forEach((p) => rows.push(line("📞", `${tag(p.label)}<a href="tel:${escapeHtml(p.value.replace(/[^+\d]/g, ""))}">${escapeHtml(p.value)}</a>${copyBtn(p.value)}`)));
  (c.emails || []).forEach((e) => rows.push(line("✉️", `${tag(e.label)}<a href="mailto:${escapeHtml(e.value)}">${escapeHtml(e.value)}</a>${copyBtn(e.value)}`)));
  (c.addresses || []).forEach((a) => rows.push(line("📍", `${tag(a.label)}<a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.value)}" target="_blank" rel="noopener">${escapeHtml(a.value)}</a>`)));
  if (c.notes) rows.push(`<div class="contact-card-notes">${escapeHtml(c.notes)}</div>`);
  return rows.join("");
}

function contactCardHtml(c) {
  const rows = contactDetailRowsHtml(c, { copy: true });
  const groups = (c.groups || []).length ? `<div class="contact-card-groups">${c.groups.map((g) => `<span class="contact-group-chip">${escapeHtml(g)}</span>`).join("")}</div>` : "";
  const star = `<button type="button" class="contact-fav-btn${c.favorite ? " is-fav" : ""}" data-fav-toggle="${escapeHtml(c.id)}" aria-pressed="${c.favorite ? "true" : "false"}" aria-label="${c.favorite ? "Remove favorite" : "Add favorite"}" title="${c.favorite ? "Unfavorite" : "Favorite"}">${CONTACT_STAR_SVG}</button>`;
  return `<div class="contact-card" role="button" tabindex="0" data-contact-id="${escapeHtml(c.id)}" aria-label="View ${escapeHtml(c.name)}">
    <div class="contact-card-head">
      ${contactAvatarHtml(c)}
      <span class="contact-card-name">${escapeHtml(c.name)}</span>
      ${star}
    </div>
    ${groups}
    <div class="contact-card-body">${rows || '<div class="contact-card-row contact-row-muted">No details yet</div>'}</div>
  </div>`;
}

let viewingContactId = null;
function openContactView(id) {
  const c = (state.contacts || []).find((x) => x.id === id);
  if (!c) return;
  viewingContactId = id;
  document.getElementById("contactViewName").textContent = c.name;
  const groups = (c.groups || []).length ? `<div class="contact-card-groups">${c.groups.map((g) => `<span class="contact-group-chip">${escapeHtml(g)}</span>`).join("")}</div>` : "";
  const rows = contactDetailRowsHtml(c, { copy: true });
  document.getElementById("contactViewBody").innerHTML = `
    <div class="contact-view-head">${contactAvatarHtml(c)}</div>
    ${groups}
    <div class="contact-card-body">${rows || '<div class="contact-card-row contact-row-muted">No details yet</div>'}</div>`;
  elements.contactViewDialog.showModal();
}

// Fill the month/day birthday selects; day options track the chosen month.
function populateContactBirthdaySelects() {
  const moSel = document.getElementById("contactBirthMonth");
  if (moSel && moSel.options.length <= 1) {
    CONTACT_MONTHS.forEach((name, i) => { const o = document.createElement("option"); o.value = String(i + 1); o.textContent = name; moSel.appendChild(o); });
    moSel.addEventListener("change", () => refreshContactBirthDays());
  }
  const yrSel = document.getElementById("contactBirthYear");
  if (yrSel && yrSel.options.length <= 1) {
    const now = new Date().getFullYear();
    for (let y = 2000; y <= now; y++) { const o = document.createElement("option"); o.value = String(y); o.textContent = String(y); yrSel.appendChild(o); }
  }
  refreshContactBirthDays();
}

function refreshContactBirthDays() {
  const daySel = document.getElementById("contactBirthDay");
  if (!daySel) return;
  const mo = Number(document.getElementById("contactBirthMonth")?.value) || 0;
  const max = mo ? CONTACT_MONTH_DAYS[mo - 1] : 31;
  const prev = daySel.value;
  daySel.innerHTML = '<option value="">Day</option>' + Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  if (prev && Number(prev) <= max) daySel.value = prev;
}

// Generic labelled row (phone / email / address / date). valueType "date" gives
// a date picker; anything else is a text box.
const CONTACT_PLUS_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const CONTACT_X_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const CONTACT_DRAG_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
let contactDragRow = null;

// Add a labelled row. Reorderable lists (data-reorder="1": phone/email/address)
// get a drag handle plus a leading "+" on the first row / "×" on the rest;
// other lists (important dates) get a plain "×" remove per row.
function addContactRow(listId, { label = "", value = "", labelPh = "Label", valuePh = "", valueType = "text" } = {}) {
  const list = document.getElementById(listId);
  if (!list) return;
  const reorder = list.dataset.reorder === "1";
  const row = document.createElement("div");
  row.className = "contact-multi-row";
  const handle = reorder ? `<button type="button" class="contact-row-drag" aria-label="Drag to reorder" title="Drag to reorder">${CONTACT_DRAG_SVG}</button>` : "";
  row.innerHTML = `${handle}
    <input type="text" class="contact-row-label" placeholder="${escapeHtml(labelPh)}" value="${escapeHtml(label)}" aria-label="Label" />
    <input type="${valueType}" class="contact-row-value" placeholder="${escapeHtml(valuePh)}" value="${escapeHtml(value)}" aria-label="${escapeHtml(valuePh || "Value")}" />
    <button type="button" class="icon-btn contact-row-action contact-row-remove" aria-label="Remove">${CONTACT_X_SVG}</button>`;
  list.appendChild(row);
  if (reorder) {
    setupContactRowDrag(row, list);
    refreshContactReorderList(list);
  } else {
    row.querySelector(".contact-row-action").addEventListener("click", () => row.remove());
  }
}

// In a reorderable list the first row's button is "+" (add another); the rest
// are "×" (remove). Drag handles show only when there's more than one row.
function refreshContactReorderList(list) {
  const rows = [...list.querySelectorAll(".contact-multi-row")];
  rows.forEach((row, i) => {
    const btn = row.querySelector(".contact-row-action");
    const drag = row.querySelector(".contact-row-drag");
    if (drag) drag.style.visibility = rows.length > 1 ? "visible" : "hidden";
    const isFirst = i === 0;
    btn.classList.toggle("contact-row-add", isFirst);
    btn.classList.toggle("contact-row-remove", !isFirst);
    btn.innerHTML = isFirst ? CONTACT_PLUS_SVG : CONTACT_X_SVG;
    btn.setAttribute("aria-label", isFirst ? "Add another" : "Remove");
    btn.onclick = isFirst
      ? () => addContactRow(list.id, { labelPh: list.dataset.labelPh || "Label", valuePh: list.dataset.valuePh || "", valueType: list.dataset.valueType || "text" })
      : () => { row.remove(); refreshContactReorderList(list); };
  });
}

function setupContactRowDrag(row, list) {
  // Reorder multi-value rows via the shared sortable primitive, using the drag
  // handle (the row is all inputs). DOM-only reorder; the contact form reads the row
  // order on save, and refreshContactReorderList fixes the +/× buttons. Bound once.
  if (list.__sortableBound) return;
  list.__sortableBound = true;
  makeSortable(list, {
    rowSelector: ".contact-multi-row",
    getId: (r) => String([...list.querySelectorAll(".contact-multi-row")].indexOf(r)),
    handleSelector: ".contact-row-drag",
    onReorder: () => refreshContactReorderList(list),
    itemLabel: (r) => (r.querySelector(".contact-row-value")?.value || "row").trim().slice(0, 40),
  });
}

function contactDragAfter(list, y) {
  let best = null, bestOffset = -Infinity;
  list.querySelectorAll(".contact-multi-row:not(.is-dragging)").forEach((row) => {
    const box = row.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = row; }
  });
  return best;
}

function populateContactList(listId, items, opts) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.dataset.labelPh = opts.labelPh || "Label";
  list.dataset.valuePh = opts.valuePh || "";
  list.dataset.valueType = opts.valueType || "text";
  list.innerHTML = "";
  const rows = (items && items.length) ? items : [{ label: opts.defLabel || "", value: "" }];
  rows.forEach((r) => addContactRow(listId, { label: r.label, value: r.value, labelPh: opts.labelPh, valuePh: opts.valuePh, valueType: opts.valueType }));
}

function readContactRows(listId, defLabel) {
  return [...document.querySelectorAll(`#${listId} .contact-multi-row`)].map((row) => ({
    id: createId("crow"),
    label: row.querySelector(".contact-row-label").value.trim() || defLabel,
    value: row.querySelector(".contact-row-value").value.trim(),
  })).filter((r) => r.value);
}

// Downscale a chosen image to a small JPEG data URL so it's cheap to sync.
function handleContactPhotoFile(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 256;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      contactPhotoDraft = canvas.toDataURL("image/jpeg", 0.8);
      renderContactPhotoPreview();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

function renderContactPhotoPreview() {
  const prev = document.getElementById("contactPhotoPreview");
  if (!prev) return;
  if (contactPhotoDraft) {
    prev.style.backgroundImage = `url('${contactPhotoDraft}')`;
    prev.classList.add("has-photo"); prev.textContent = "";
  } else {
    prev.style.backgroundImage = ""; prev.classList.remove("has-photo");
    prev.textContent = contactInitials(`${document.getElementById("contactFirstName")?.value || ""} ${document.getElementById("contactLastName")?.value || ""}`.trim());
  }
}

// Right-click (or click) the photo circle → menu with Add/Change/Remove photo.
function openContactPhotoMenu() {
  const row = document.querySelector("#contactEditDialog .contact-photo-row");
  if (!row) return;
  row.querySelector(".contact-photo-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "contact-photo-menu";
  const has = !!contactPhotoDraft;
  menu.innerHTML = `<button type="button" data-photo="add">${has ? "Change photo" : "Add photo"}</button>${has ? `<button type="button" data-photo="remove">Remove photo</button>` : ""}`;
  row.appendChild(menu);
  const close = () => { menu.remove(); document.removeEventListener("click", onDoc, true); };
  const onDoc = (e) => { if (!e.target.closest(".contact-photo-menu") && e.target.id !== "contactPhotoPreview") close(); };
  menu.addEventListener("click", (e) => {
    const b = e.target.closest("[data-photo]"); if (!b) return;
    if (b.dataset.photo === "add") document.getElementById("contactPhotoInput").click();
    else { contactPhotoDraft = ""; renderContactPhotoPreview(); }
    close();
  });
  setTimeout(() => document.addEventListener("click", onDoc, true), 0);
}

function openContactDialog(id) {
  editingContactId = id || null;
  const c = id ? (state.contacts || []).find((x) => x.id === id) : null;
  const $ = (i) => document.getElementById(i);
  $("contactDialogTitle").textContent = c ? "Edit Contact" : "New Contact";
  populateContactBirthdaySelects();
  $("contactFirstName").value = c?.firstName || "";
  $("contactLastName").value = c?.lastName || "";
  contactPhotoDraft = c?.photo || "";
  renderContactPhotoPreview();
  // Phone / email / address are reorderable lists that always show at least one
  // row (so the leading "+" is available). Dates use plain add/remove rows.
  populateContactList("contactPhoneList", c?.phones, { labelPh: "Mobile", valuePh: "Phone number", defLabel: "Mobile" });
  populateContactList("contactEmailList", c?.emails, { labelPh: "Email", valuePh: "name@example.com", defLabel: "Email" });
  populateContactList("contactAddressList", c?.addresses, { labelPh: "Home", valuePh: "Address", defLabel: "Home" });
  const dateList = $("contactDateList"); dateList.innerHTML = "";
  (c?.dates || []).forEach((d) => addContactRow("contactDateList", { label: d.label, value: d.value.length > 5 ? d.value : "", labelPh: "Anniversary", valueType: "date" }));
  const bday = c?.birthday || "";
  const mmdd = bday.length > 5 ? bday.slice(5) : bday;
  const [mo, day] = mmdd ? mmdd.split("-") : ["", ""];
  $("contactBirthMonth").value = mo ? String(+mo) : "";
  refreshContactBirthDays();
  $("contactBirthDay").value = day ? String(+day) : "";
  const yr = bday.length > 5 ? bday.slice(0, 4) : "";
  const yrSel = $("contactBirthYear");
  if (yr && ![...yrSel.options].some((o) => o.value === yr)) { const o = document.createElement("option"); o.value = yr; o.textContent = yr; yrSel.appendChild(o); }
  yrSel.value = yr;
  renderContactGroupsPicker(c?.groups || []);
  $("contactNotes").value = c?.notes || "";
  $("deleteContactBtn").hidden = !c;
  elements.contactEditDialog.showModal();
  $("contactFirstName").focus();
}

function saveContact() {
  const $ = (i) => document.getElementById(i);
  const firstName = $("contactFirstName").value.trim();
  const lastName = $("contactLastName").value.trim();
  const name = `${firstName} ${lastName}`.trim();
  if (!name) { $("contactFirstName").focus(); return; }
  const mo = $("contactBirthMonth").value, day = $("contactBirthDay").value, yr = $("contactBirthYear").value.trim();
  let birthday = "";
  if (mo && day) {
    const mmdd = `${String(+mo).padStart(2, "0")}-${String(+day).padStart(2, "0")}`;
    birthday = (yr && +yr >= 1900 && +yr <= 2100) ? `${yr}-${mmdd}` : mmdd;
  }
  const groups = [...new Set(currentContactPickerSelection().map((g) => g.trim()).filter(Boolean))];
  const data = {
    firstName, lastName, name,
    photo: contactPhotoDraft || "",
    phones: readContactRows("contactPhoneList", "Mobile"),
    emails: readContactRows("contactEmailList", "Email"),
    birthday,
    dates: readContactRows("contactDateList", "Date").filter((d) => CONTACT_DATE_RE.test(d.value)),
    addresses: readContactRows("contactAddressList", "Home"),
    groups,
    notes: $("contactNotes").value.trim(),
  };
  if (editingContactId) {
    state.contacts = (state.contacts || []).map((c) => c.id === editingContactId ? { ...c, ...data } : c);
  } else {
    state.contacts = [...(state.contacts || []), { id: createId("contact"), createdAt: new Date().toISOString(), ...data }];
  }
  // Register any newly-typed groups so they persist (and stay selectable in the
  // sidebar) even if this is later their only contact and it's removed.
  if (groups.length) {
    const known = new Set(normalizeContactGroups(state.contactGroups));
    const added = groups.filter((g) => !known.has(g));
    if (added.length) state.contactGroups = [...normalizeContactGroups(state.contactGroups), ...added];
  }
  persist();
  elements.contactEditDialog.close();
  renderContactsPage();
  refreshPlanIfActive(); // birthday/date calendar may have changed
}

function deleteContact() {
  if (!editingContactId) return;
  const id = editingContactId;
  const snapshot = (state.contacts || []).find((c) => c.id === id);
  if (!snapshot) return;
  recordDeletion("contacts", id); // tombstone so the delete survives a cross-device merge
  state.contacts = (state.contacts || []).filter((c) => c.id !== id);
  persist();
  elements.contactEditDialog.close();
  renderContactsPage();
  refreshPlanIfActive();
  showMailToast(`Deleted "${snapshot.name}"`, () => {
    if (!(state.contacts || []).some((c) => c.id === id)) {
      if (state.tombstones?.contacts) state.tombstones.contacts = state.tombstones.contacts.filter((x) => x !== String(id));
      state.contacts = [...(state.contacts || []), snapshot];
      persist();
      renderContactsPage();
      refreshPlanIfActive();
    }
  });
}

// ── vCard import / export ─────────────────────────────────────────────────────
function vcardEscape(s) { return String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;"); }
function vcardUnescape(s) { return String(s || "").replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\"); }

function exportContactsVcf() {
  const cs = state.contacts || [];
  if (!cs.length) { showMailToast("No contacts to export"); return; }
  const lines = [];
  cs.forEach((c) => {
    lines.push("BEGIN:VCARD", "VERSION:3.0");
    lines.push(`N:${vcardEscape(c.lastName)};${vcardEscape(c.firstName)};;;`);
    lines.push(`FN:${vcardEscape(c.name)}`);
    (c.phones || []).forEach((p) => lines.push(`TEL;TYPE=${vcardEscape(p.label || "Mobile")}:${vcardEscape(p.value)}`));
    (c.emails || []).forEach((e) => lines.push(`EMAIL;TYPE=${vcardEscape(e.label || "Email")}:${vcardEscape(e.value)}`));
    if (c.birthday) lines.push(`BDAY:${c.birthday.length > 5 ? c.birthday : "--" + c.birthday.replace("-", "")}`);
    (c.dates || []).forEach((d) => lines.push(`X-DATE;TYPE=${vcardEscape(d.label || "Date")}:${d.value}`));
    (c.addresses || []).forEach((a) => lines.push(`ADR;TYPE=${vcardEscape(a.label || "Home")}:;;${vcardEscape(a.value)};;;;`));
    if ((c.groups || []).length) lines.push(`CATEGORIES:${c.groups.map(vcardEscape).join(",")}`);
    if (c.photo && c.photo.includes(",")) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${c.photo.split(",")[1]}`);
    if (c.notes) lines.push(`NOTE:${vcardEscape(c.notes)}`);
    lines.push("END:VCARD");
  });
  const blob = new Blob([lines.join("\r\n")], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "contacts.vcf"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showMailToast(`Exported ${cs.length} contact${cs.length !== 1 ? "s" : ""}`);
}

// A parsed contact matches an existing one if names match, or they share an
// email or phone number.
function findExistingContactMatch(p, contacts) {
  const norm = (s) => String(s || "").trim().toLowerCase();
  const digits = (s) => String(s || "").replace(/\D/g, "");
  const pName = norm(p.name);
  const pEmails = (p.emails || []).map((e) => norm(e.value)).filter(Boolean);
  const pPhones = (p.phones || []).map((ph) => digits(ph.value)).filter(Boolean);
  return contacts.find((c) => {
    if (pName && norm(c.name) === pName) return true;
    if (pEmails.some((v) => (c.emails || []).some((e) => norm(e.value) === v))) return true;
    if (pPhones.some((v) => (c.phones || []).some((ph) => digits(ph.value) === v))) return true;
    return false;
  });
}

function mergeContactInto(existing, parsed) {
  const unionRows = (a, b) => {
    const out = [...(a || [])];
    const seen = new Set(out.map((r) => r.value.toLowerCase()));
    (b || []).forEach((r) => { const k = r.value.toLowerCase(); if (!seen.has(k)) { out.push({ ...r, id: createId("crow") }); seen.add(k); } });
    return out;
  };
  const firstName = existing.firstName || parsed.firstName;
  const lastName = existing.lastName || parsed.lastName;
  return {
    ...existing,
    firstName, lastName,
    name: `${firstName} ${lastName}`.trim() || existing.name || parsed.name,
    photo: existing.photo || parsed.photo,
    phones: unionRows(existing.phones, parsed.phones),
    emails: unionRows(existing.emails, parsed.emails),
    birthday: existing.birthday || parsed.birthday,
    dates: unionRows(existing.dates, parsed.dates),
    addresses: unionRows(existing.addresses, parsed.addresses),
    groups: [...new Set([...(existing.groups || []), ...(parsed.groups || [])])],
    notes: existing.notes || parsed.notes,
  };
}

// Chooser for how to handle duplicates found during import. Resolves to
// "merge" | "skip" | "new", or null on cancel.
function chooseImportMode(dupes, news) {
  return new Promise((resolve) => {
    document.getElementById("planScopeChooser")?.remove();
    const wrap = document.createElement("div");
    wrap.id = "planScopeChooser";
    wrap.className = "plan-scope-overlay";
    wrap.innerHTML = `
      <div class="plan-scope-box" role="dialog" aria-modal="true" aria-label="Import contacts">
        <p class="plan-scope-title">Import contacts</p>
        <p class="plan-scope-sub">${dupes} imported contact${dupes !== 1 ? "s" : ""} ${dupes === 1 ? "looks" : "look"} like ${dupes === 1 ? "a duplicate" : "duplicates"} of existing ones${news ? `, and ${news} ${news !== 1 ? "are" : "is"} new` : ""}. How should the duplicates be handled?</p>
        <div class="plan-scope-actions">
          <button type="button" data-imp="merge">Merge into existing</button>
          <button type="button" data-imp="skip">Skip duplicates</button>
          <button type="button" data-imp="new">Import all as new</button>
          <button type="button" data-imp="cancel" class="plan-scope-cancel">Cancel</button>
        </div>
      </div>`;
    const done = (v) => { document.removeEventListener("keydown", onKey); wrap.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); done(null); } };
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) return done(null);
      const b = e.target.closest("[data-imp]");
      if (!b) return;
      done(b.dataset.imp === "cancel" ? null : b.dataset.imp);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-imp="merge"]')?.focus();
  });
}

async function importContactsVcf(text) {
  const blocks = String(text || "").split(/BEGIN:VCARD/i).slice(1);
  const parsed = [];
  blocks.forEach((block) => {
    const body = block.split(/END:VCARD/i)[0] || "";
    const raw = body.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, ""); // unfold continuation lines
    const c = { firstName: "", lastName: "", name: "", phones: [], emails: [], birthday: "", dates: [], addresses: [], groups: [], notes: "" };
    raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).forEach((line) => {
      const ci = line.indexOf(":"); if (ci < 0) return;
      const rawKey = line.slice(0, ci), val = line.slice(ci + 1);
      const key = rawKey.split(";")[0].toUpperCase();
      const type = (rawKey.split(";").slice(1).find((p) => /^TYPE=/i.test(p)) || "").replace(/^TYPE=/i, "");
      if (key === "FN") c.name = vcardUnescape(val);
      else if (key === "N") { const p = val.split(";"); c.lastName = vcardUnescape(p[0] || ""); c.firstName = vcardUnescape(p[1] || ""); }
      else if (key === "TEL") c.phones.push({ label: type || "Mobile", value: vcardUnescape(val) });
      else if (key === "EMAIL") c.emails.push({ label: type || "Email", value: vcardUnescape(val) });
      else if (key === "BDAY") { const m = val.match(/^--(\d{2})-?(\d{2})/) ; const f = val.match(/(\d{4})-?(\d{2})-?(\d{2})/); if (m) c.birthday = `${m[1]}-${m[2]}`; else if (f) c.birthday = `${f[1]}-${f[2]}-${f[3]}`; }
      else if (key === "X-DATE" || key === "ANNIVERSARY") { const f = val.match(/(\d{4})-?(\d{2})-?(\d{2})/); if (f) c.dates.push({ label: type || (key === "ANNIVERSARY" ? "Anniversary" : "Date"), value: `${f[1]}-${f[2]}-${f[3]}` }); }
      else if (key === "ADR") { const parts = val.split(";").map(vcardUnescape); const joined = parts.slice(2).filter(Boolean).join(", ") || parts.filter(Boolean).join(", "); if (joined) c.addresses.push({ label: type || "Home", value: joined }); }
      else if (key === "CATEGORIES") c.groups = val.split(",").map((s) => vcardUnescape(s).trim()).filter(Boolean);
      else if (key === "NOTE") c.notes = vcardUnescape(val);
    });
    if (!c.name) c.name = `${c.firstName} ${c.lastName}`.trim();
    if (c.name) parsed.push(c);
  });
  if (!parsed.length) { showMailToast("No contacts found in that file"); return; }
  const incoming = normalizeContacts(parsed, createId); // ids + row shapes normalized
  const existing = state.contacts || [];
  const tagged = incoming.map((p) => ({ p, match: findExistingContactMatch(p, existing) }));
  const dupes = tagged.filter((t) => t.match);
  const news = tagged.filter((t) => !t.match);
  let mode = "new";
  if (dupes.length) {
    mode = await chooseImportMode(dupes.length, news.length);
    if (!mode) return; // cancelled — import nothing
  }
  const snapshot = [...existing];
  let addedN = 0, mergedN = 0, skippedN = 0;
  let next = [...existing];
  const addAsNew = (p) => { next.push({ ...p, id: createId("contact") }); addedN++; };
  if (mode === "merge") {
    const mergedById = new Map();
    dupes.forEach(({ p, match }) => { mergedById.set(match.id, mergeContactInto(mergedById.get(match.id) || match, p)); mergedN++; });
    next = next.map((c) => mergedById.get(c.id) || c);
    news.forEach(({ p }) => addAsNew(p));
  } else if (mode === "skip") {
    news.forEach(({ p }) => addAsNew(p));
    skippedN = dupes.length;
  } else {
    tagged.forEach(({ p }) => addAsNew(p));
  }
  state.contacts = next;
  persist();
  renderContactsPage();
  refreshPlanIfActive();
  const parts = [];
  if (addedN) parts.push(`imported ${addedN}`);
  if (mergedN) parts.push(`merged ${mergedN}`);
  if (skippedN) parts.push(`skipped ${skippedN}`);
  showMailToast(parts.length ? parts.join(", ").replace(/^./, (ch) => ch.toUpperCase()) : "Nothing imported", () => {
    state.contacts = snapshot;
    persist(); renderContactsPage(); refreshPlanIfActive();
  });
}


  // Encapsulate the contact-view header buttons (they read/set internal ids). Moved
  // out of app.js's bindEvents so viewingContactId/editingContactId stay private.
  function editViewedContact() {
    const id = viewingContactId;
    elements.contactViewDialog.close();
    if (id) openContactDialog(id);
  }
  function deleteViewedContact() {
    editingContactId = viewingContactId;
    elements.contactViewDialog.close();
    deleteContact();
  }

  return {
    renderContactsPage, openContactDialog, saveContact, deleteContact, openContactView,
    copyContactValue, addContactRow, handleContactPhotoFile, openContactPhotoMenu,
    exportContactsVcf, importContactsVcf, editViewedContact, deleteViewedContact,
  };
}

