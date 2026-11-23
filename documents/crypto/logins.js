// Passwords in the Safe (PASSWORDS_DESIGN.md §3–4): one encrypted row per login.
//
// KEYS. A scope's LOGINS KEY is derived from its vault key, per key version:
//
//   logins key = BLAKE2b-256(key = vault key, message = context(vaultId, scope, keyVersion))
//
// so grants, rotation and the recovery code carry it with the vault key and need no
// new machinery, while the derivation is one-way: something that holds only a logins
// key (the coming iPhone AutoFill extension, the Chrome extension) can't get the
// vault key back, so it can't open documents. (PASSWORDS_DESIGN §4 first said "a
// separate key granted the same way"; deriving gives the same separation, with the
// vault key's rotation and recovery for free.)
//
// ROWS. Each login is sealed under the logins key with its context (vault, scope,
// login id, key version) as associated data, so a row can't be moved onto another
// login, scope or version. Padded to 64-byte blocks.
//
// parseLogin rebuilds a clean object from known fields only, on encrypt and decrypt
// (as meta.js): a hostile or newer client can't hand this device a surprise shape,
// a site address that isn't http(s) (no javascript: links), or control characters.

import { sodium } from "../../messaging/crypto/sodium.js";
import { utf8, fromUtf8, concat } from "../../messaging/crypto/bytes.js";
import { pad, unpad } from "../../messaging/crypto/padding.js";
import { requireKey } from "../../messaging/crypto/keys.js";
import { contextBytes, seal, open } from "./wrap.js";
import { cleanName } from "./meta.js";

export const LOGIN_VERSION = 1;
export const LOGIN_LIMITS = Object.freeze({
  title: 200, site: 2048, sites: 20, username: 512, password: 1024, totp: 1024,
  notes: 10000, tags: 20, tag: 40, history: 10, plaintext: 16 * 1024,
});
export const LOGIN_KINDS = Object.freeze(["login", "note"]);
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const keyCtx = ({ vaultId, scope, keyVersion }) =>
  contextBytes("LiveDocs/logins-key/v1", [["vaultId", vaultId], ["scope", scope], ["keyVersion", keyVersion]]);
const rowCtx = ({ vaultId, scope, loginId, keyVersion }) =>
  contextBytes("LiveDocs/login/v1", [["vaultId", vaultId], ["scope", scope], ["loginId", loginId], ["keyVersion", keyVersion]]);

export function deriveLoginsKey(vaultKey, ctx) {
  requireKey("vault key", vaultKey);
  return sodium().crypto_generichash(32, keyCtx(ctx), vaultKey);
}

// ---- the login object -------------------------------------------------------------------

// Text fields keep line breaks only where they mean something (notes); passwords keep
// every character except control ones (a password with a tab can't be typed anyway).
function text(v, max, name, { multiline = false, raw = false } = {}) {
  if (v == null || v === "") return "";
  if (typeof v !== "string") throw new Error(`login: ${name} must be text`);
  let s = v.normalize("NFC");
  if (raw) s = s.replace(/[\p{Cc}]/gu, "");
  else if (multiline) s = s.replace(/\r\n?/g, "\n").replace(/[^\P{Cc}\n\t]/gu, "").replace(/(?!‍)\p{Cf}/gu, "");
  else s = cleanName(s);
  if ([...s].length > max) throw new Error(`login: ${name} is too long`);
  return s;
}

const iso = (v, name) => {
  if (typeof v !== "string" || !ISO_RE.test(v) || Number.isNaN(Date.parse(v))) throw new Error(`login: ${name} must be a UTC time`);
  return v;
};

// A site address: http or https only, no user:password@ part. Returned as the URL's
// own form (lower-case host, punycode for international names).
export function cleanSite(v) {
  if (typeof v !== "string") throw new Error("login: a site must be text");
  const s = v.trim();
  if (!s || s.length > LOGIN_LIMITS.site) throw new Error("login: bad site");
  let u;
  try { u = new URL(s); } catch { throw new Error("login: a site must be a web address"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("login: a site must start with https://");
  if (u.username || u.password || !u.hostname) throw new Error("login: bad site");
  return u.href;
}

export function parseLogin(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) throw new Error("login: must be an object");
  if (m.v !== LOGIN_VERSION) throw new Error("login: unknown version");
  if (!Number.isInteger(m.rev) || m.rev < 1 || m.rev > 0xffffffff) throw new Error("login: rev must be a whole number from 1");
  const kind = m.kind == null ? "login" : m.kind;
  if (!LOGIN_KINDS.includes(kind)) throw new Error("login: unknown kind");
  const title = text(m.title, LOGIN_LIMITS.title, "title");
  const sitesIn = m.sites == null ? [] : m.sites;
  if (!Array.isArray(sitesIn) || sitesIn.length > LOGIN_LIMITS.sites) throw new Error("login: too many sites");
  const sites = [...new Set(sitesIn.map(cleanSite))];
  const tagsIn = m.tags == null ? [] : m.tags;
  if (!Array.isArray(tagsIn) || tagsIn.length > LOGIN_LIMITS.tags) throw new Error("login: too many tags");
  const tags = [...new Set(tagsIn.map((t) => text(t, LOGIN_LIMITS.tag, "tag")).filter(Boolean))];
  const histIn = m.history == null ? [] : m.history;
  if (!Array.isArray(histIn) || histIn.length > LOGIN_LIMITS.history) throw new Error("login: too much history");
  const history = histIn.map((h) => {
    if (!h || typeof h !== "object") throw new Error("login: bad history");
    return { password: text(h.password, LOGIN_LIMITS.password, "old password", { raw: true }), changed: iso(h.changed, "history time") };
  });
  const out = {
    v: LOGIN_VERSION,
    rev: m.rev,
    kind,
    title,
    sites,
    exactSite: m.exactSite === true,
    username: text(m.username, LOGIN_LIMITS.username, "username"),
    password: text(m.password, LOGIN_LIMITS.password, "password", { raw: true }),
    totp: text(m.totp, LOGIN_LIMITS.totp, "2FA secret").replace(/\s+/g, ""),
    notes: text(m.notes, LOGIN_LIMITS.notes, "notes", { multiline: true }),
    tags,
    favorite: m.favorite === true,
    history,
    created: iso(m.created, "created"),
    updated: iso(m.updated, "updated"),
  };
  if (!out.title && !out.sites.length && !out.username) throw new Error("login: give it a name, a site or a username");
  return out;
}

export function encryptLogin(loginsKey, login, ctx) {
  requireKey("logins key", loginsKey);
  const plain = utf8(JSON.stringify(parseLogin(login)));
  if (plain.length > LOGIN_LIMITS.plaintext) throw new Error("login: too large");
  return seal(loginsKey, pad(plain), rowCtx(ctx));
}

export function decryptLogin(loginsKey, enc, ctx) {
  requireKey("logins key", loginsKey);
  const plain = unpad(open(loginsKey, enc, rowCtx(ctx)));
  if (plain.length > LOGIN_LIMITS.plaintext) throw new Error("login: too large");
  return parseLogin(JSON.parse(fromUtf8(plain)));
}

// ---- encrypted backup file (PASSWORDS_DESIGN §7) ------------------------------------------
//
// A passphrase-protected export: Argon2id (64 MiB, 3 passes) → XChaCha20-Poly1305.
// File: "LIVPW1" ‖ salt (16) ‖ ops (u8) ‖ memMiB (u16) ‖ nonce (24) ‖ ciphertext.
// The header is bound in as associated data.

const BACKUP_MAGIC = utf8("LIVPW1");
const BACKUP_OPS = 3;
const BACKUP_MEM_MIB = 64;

function backupKey(passphrase, salt, ops, memMiB) {
  if (typeof passphrase !== "string" || [...passphrase].length < 8) throw new Error("backup: use a passphrase of at least 8 characters");
  if (ops < 1 || ops > 10 || memMiB < 8 || memMiB > 1024) throw new Error("backup: bad settings");
  const s = sodium();
  return s.crypto_pwhash(32, utf8(passphrase.normalize("NFC")), salt, ops, memMiB * 1024 * 1024, s.crypto_pwhash_ALG_ARGON2ID13);
}

export function encryptBackup(passphrase, bytes, { ops = BACKUP_OPS, memMiB = BACKUP_MEM_MIB } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new Error("backup: bytes");
  const s = sodium();
  const salt = s.randombytes_buf(16);
  const header = concat(BACKUP_MAGIC, salt, Uint8Array.of(ops, memMiB >> 8, memMiB & 0xff));
  const key = backupKey(passphrase, salt, ops, memMiB);
  const nonce = s.randombytes_buf(24);
  const ct = s.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes, header, null, nonce, key);
  return concat(header, nonce, ct);
}

export function decryptBackup(passphrase, file) {
  if (!(file instanceof Uint8Array) || file.length < 6 + 16 + 3 + 24 + 16) throw new Error("backup: not a Liv passwords backup");
  for (let i = 0; i < 6; i++) if (file[i] !== BACKUP_MAGIC[i]) throw new Error("backup: not a Liv passwords backup");
  const header = file.subarray(0, 25);
  const salt = file.subarray(6, 22);
  const ops = file[22];
  const memMiB = (file[23] << 8) | file[24];
  const key = backupKey(passphrase, salt, ops, memMiB);
  try {
    return sodium().crypto_aead_xchacha20poly1305_ietf_decrypt(null, file.subarray(49), header, file.subarray(25, 49), key);
  } catch {
    throw new Error("backup: wrong passphrase, or the file was changed");
  }
}
