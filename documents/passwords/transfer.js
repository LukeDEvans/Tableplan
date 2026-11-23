// Moving passwords in and out (PASSWORDS_DESIGN.md §7). Pure: no keys, no network.
//
// IMPORT reads the CSV exports of Apple's Passwords app / iCloud Keychain
// (Title,URL,Username,Password,Notes,OTPAuth) and Google Password Manager / Chrome
// (name,url,username,password,note), told apart by their header row. Everything runs
// on the device; the file never leaves it.
//
// MERGING (Luke, 2026-11-21): the same site and username is one login. When two
// sources disagree on the password, the newer one wins — neither export carries a
// date, so iCloud's wins — and the other goes into the login's history with the tag
// CHECK_TAG, so Needs attention lists it for Luke to confirm. A login already in Liv
// keeps its password the same way (the import's goes into history, tagged).
//
// EXPORT writes the iCloud layout, so the file can go back into Apple's Passwords app
// (or anything else that reads it).

import { siteKey, normalizeSiteInput } from "./site.js";
import { isValidTotp } from "./totp.js";
import { LOGIN_LIMITS } from "../crypto/logins.js";

export const CHECK_TAG = "Check password";

export function parseCsv(textIn) {
  const text = String(textIn || "").replace(/^﻿/, "");
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const FORMATS = {
  icloud: { title: "title", url: "url", username: "username", password: "password", notes: "notes", totp: "otpauth" },
  chrome: { title: "name", url: "url", username: "username", password: "password", notes: "note" },
};

export function detectFormat(header) {
  const h = header.map((x) => x.trim().toLowerCase());
  if (["title", "url", "username", "password"].every((k) => h.includes(k))) return "icloud";
  if (["name", "url", "username", "password"].every((k) => h.includes(k))) return "chrome";
  return null;
}

const clip = (s, max) => [...String(s || "")].slice(0, max).join("");

// → { format, entries: [{ title, sites, username, password, notes, totp, source }], skipped }
export function readExport(text) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("The file is empty.");
  const format = detectFormat(rows[0]);
  if (!format) throw new Error("This doesn't look like a Passwords (iCloud) or Chrome export.");
  const h = rows[0].map((x) => x.trim().toLowerCase());
  const col = Object.fromEntries(Object.entries(FORMATS[format]).map(([k, name]) => [k, h.indexOf(name)]));
  const get = (r, k) => (col[k] >= 0 ? (r[col[k]] ?? "") : "");
  const entries = [];
  let skipped = 0;
  for (const r of rows.slice(1)) {
    const site = normalizeSiteInput(get(r, "url"));
    const username = get(r, "username").trim();
    const password = get(r, "password");
    const title = get(r, "title").trim() || (site ? new URL(site).hostname.replace(/^www\./, "") : "");
    if (!password && !username) { skipped++; continue; }
    if ([...password].length > LOGIN_LIMITS.password || [...username].length > LOGIN_LIMITS.username) { skipped++; continue; }
    const totp = get(r, "totp").trim();
    entries.push({
      title: clip(title, LOGIN_LIMITS.title),
      sites: site ? [site] : [],
      username,
      password,
      notes: clip(get(r, "notes"), LOGIN_LIMITS.notes),
      totp: totp && isValidTotp(totp) ? totp : "",
      source: format,
    });
  }
  return { format, entries, skipped };
}

export const mergeKey = (l) => `${(l.sites || []).map(siteKey).find(Boolean) || (l.title || "").toLowerCase()}\n${(l.username || "").toLowerCase()}`;

function addHistory(login, password, when) {
  if (!password || password === login.password || (login.history || []).some((h) => h.password === password)) return login;
  const history = [{ password, changed: when }, ...(login.history || [])].slice(0, LOGIN_LIMITS.history);
  const tags = [...new Set([...(login.tags || []), CHECK_TAG])].slice(0, LOGIN_LIMITS.tags);
  return { ...login, history, tags };
}

// existing: logins already in this scope ({ id, ...login }). imports: readExport
// entries from one or more files. → { add: [login], update: [{ id, login }], same }
// iCloud entries are applied before Chrome's, so iCloud wins ties.
export function planImport(existing, imports, nowIso = new Date().toISOString()) {
  const order = { icloud: 0, chrome: 1 };
  const sorted = [...imports].sort((a, b) => (order[a.source] ?? 2) - (order[b.source] ?? 2));
  const byKey = new Map();
  for (const l of existing) if (l.kind !== "note") byKey.set(mergeKey(l), { id: l.id, login: l, changed: false, existing: true });
  let same = 0;
  for (const e of sorted) {
    const key = mergeKey(e);
    const cur = byKey.get(key);
    if (!cur) {
      byKey.set(key, {
        id: null, existing: false, changed: true,
        login: { kind: "login", title: e.title, sites: e.sites, username: e.username, password: e.password, totp: e.totp, notes: e.notes, tags: [], history: [], favorite: false, exactSite: false },
      });
      continue;
    }
    let l = cur.login;
    const before = JSON.stringify(l);
    l = addHistory(l, e.password, nowIso);
    if (!l.password && e.password) l = { ...l, password: e.password };
    if (!l.totp && e.totp) l = { ...l, totp: e.totp };
    if (e.notes && !String(l.notes || "").includes(e.notes)) l = { ...l, notes: [l.notes, e.notes].filter(Boolean).join("\n\n").slice(0, LOGIN_LIMITS.notes) };
    for (const s of e.sites) if (!(l.sites || []).includes(s) && (l.sites || []).length < LOGIN_LIMITS.sites) l = { ...l, sites: [...(l.sites || []), s] };
    if (JSON.stringify(l) === before) { same++; continue; }
    cur.login = l;
    cur.changed = true;
  }
  const add = [], update = [];
  for (const v of byKey.values()) {
    if (!v.changed) continue;
    if (v.existing) update.push({ id: v.id, login: v.login });
    else add.push(v.login);
  }
  return { add, update, same };
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export function toCsv(logins) {
  const lines = [["Title", "URL", "Username", "Password", "Notes", "OTPAuth"].join(",")];
  for (const l of logins) {
    if (l.kind === "note") {
      lines.push([l.title, "", "", "", l.notes, ""].map(csvCell).join(","));
      continue;
    }
    const sites = l.sites?.length ? l.sites : [""];
    // One row per site, as Apple's own export does for a login used on several sites.
    for (const s of sites) lines.push([l.title, s, l.username, l.password, l.notes, l.totp].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
