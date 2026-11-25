// Passwords in the Safe (PASSWORDS_DESIGN.md): the crypto (documents/crypto/logins.js),
// the pure helpers (documents/passwords/*) and the data layer end to end against a real
// Postgres with row security, including a device removal re-sealing every login.

import { describe, it, expect, beforeAll } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount } from "../messaging/account.js";
import { toB64, fromB64, utf8 } from "../messaging/crypto/bytes.js";
import { createDocumentsServer } from "../documents/server.js";
import { createDocumentsVaults } from "../documents/vaults.js";
import {
  generateVaultKey, deriveLoginsKey, encryptLogin, decryptLogin, parseLogin, encryptBackup, decryptBackup,
} from "../documents/crypto/index.js";
import { siteKey, loginMatches, displayHost, normalizeSiteInput } from "../documents/passwords/site.js";
import { parseTotp, hotp, totpNow, base32Decode } from "../documents/passwords/totp.js";
import { generatePassword, estimateBits, isWeak } from "../documents/passwords/generator.js";
import { parseCsv, readExport, planImport, toCsv, CHECK_TAG } from "../documents/passwords/transfer.js";
import { attention, pwnedCount, sha1Hex } from "../documents/passwords/checks.js";
import { createLoginsLibrary } from "../documents/passwords/library.js";
import { createDocumentsDatabase, pgliteTransport, USERS, GROUP } from "./documents-pglite-harness.js";

beforeAll(async () => { await loadSodium(); });

const T = "2026-11-21T12:00:00.000Z";
const base = (over = {}) => ({ v: 1, rev: 1, title: "Netflix", sites: ["https://www.netflix.com/login"], username: "luke@example.com", password: "hunter2-but-longer", created: T, updated: T, ...over });
const ctx = { vaultId: "vault-1", scope: "group-1", loginId: "login-1", keyVersion: 1 };

describe("crypto: logins", () => {
  it("round-trips, and only opens in the place it was sealed for", () => {
    const vk = generateVaultKey();
    const lk = deriveLoginsKey(vk, ctx);
    const enc = encryptLogin(lk, base(), ctx);
    expect(decryptLogin(lk, enc, ctx)).toMatchObject({ title: "Netflix", password: "hunter2-but-longer", rev: 1 });
    expect(() => decryptLogin(lk, enc, { ...ctx, loginId: "login-2" })).toThrow();
    expect(() => decryptLogin(lk, enc, { ...ctx, scope: "u-x" })).toThrow();
    expect(() => decryptLogin(lk, enc, { ...ctx, keyVersion: 2 })).toThrow();
    expect(() => decryptLogin(deriveLoginsKey(vk, { ...ctx, keyVersion: 2 }), enc, ctx)).toThrow();
  });

  it("the logins key differs per version, scope and vault, and isn't the vault key", () => {
    const vk = generateVaultKey();
    const a = deriveLoginsKey(vk, ctx);
    expect(a).not.toEqual(vk);
    expect(deriveLoginsKey(vk, { ...ctx, keyVersion: 2 })).not.toEqual(a);
    expect(deriveLoginsKey(vk, { ...ctx, scope: "other" })).not.toEqual(a);
    expect(deriveLoginsKey(vk, { ...ctx, vaultId: "v2" })).not.toEqual(a);
    expect(deriveLoginsKey(vk, ctx)).toEqual(a);
  });

  it("parseLogin keeps known fields only and refuses unsafe sites", () => {
    const p = parseLogin({ ...base(), evil: 1, __proto__: { x: 1 } });
    expect(p.evil).toBeUndefined();
    expect(() => parseLogin(base({ sites: ["javascript:alert(1)"] }))).toThrow();
    expect(() => parseLogin(base({ sites: ["https://user:pw@example.com"] }))).toThrow();
    expect(() => parseLogin(base({ sites: ["ftp://example.com"] }))).toThrow();
    expect(() => parseLogin(base({ v: 2 }))).toThrow();
    expect(() => parseLogin(base({ title: "", sites: [], username: "" }))).toThrow();
    expect(() => parseLogin(base({ rev: 0 }))).toThrow();
    expect(parseLogin(base({ title: "Bank‮gnp.exe" })).title).toBe("Bankgnp.exe");
    expect(parseLogin(base({ notes: "a\r\nb\u0000c" })).notes).toBe("a\nbc");
    expect(parseLogin(base({ password: "p\u0000w d" })).password).toBe("pw d");
    expect(parseLogin(base({ totp: "JBSW Y3DP EHPK 3PXP" })).totp).toBe("JBSWY3DPEHPK3PXP");
  });

  it("refuses a login too large to store", () => {
    const lk = deriveLoginsKey(generateVaultKey(), ctx);
    expect(() => encryptLogin(lk, base({ notes: "😀".repeat(5000) }), ctx)).toThrow(/too large/);
  });

  it("backup files open only with the passphrase and aren't editable", () => {
    const data = utf8("Title,URL\n");
    const file = encryptBackup("correct horse battery", data, { ops: 1, memMiB: 8 });
    expect(decryptBackup("correct horse battery", file)).toEqual(data);
    expect(() => decryptBackup("wrong passphrase!", file)).toThrow(/wrong passphrase/);
    const bad = file.slice(); bad[bad.length - 1] ^= 1;
    expect(() => decryptBackup("correct horse battery", bad)).toThrow();
    const hdr = file.slice(); hdr[22] = 2; // the settings are bound in
    expect(() => decryptBackup("correct horse battery", hdr)).toThrow();
    expect(() => encryptBackup("short", data)).toThrow();
  });
});

describe("site matching", () => {
  it("matches the registrable domain, never a look-alike", () => {
    const l = { sites: ["https://google.com"] };
    expect(loginMatches(l, "https://accounts.google.com/signin")).toBe(true);
    expect(loginMatches(l, "https://google.com.evil.io/")).toBe(false);
    expect(loginMatches(l, "https://evilgoogle.com/")).toBe(false);
    expect(loginMatches(l, "http://google.com/")).toBe(false); // saved for https: not on http
    expect(loginMatches({ sites: ["http://google.com"] }, "https://google.com/")).toBe(true);
    expect(loginMatches({ sites: ["https://apple.com"] }, "https://аpple.com/")).toBe(false); // Cyrillic а
  });
  it("uses public suffixes, private ones included", () => {
    expect(siteKey("https://a.bbc.co.uk")).toBe("bbc.co.uk");
    expect(siteKey("https://luke.github.io")).toBe("luke.github.io");
    expect(loginMatches({ sites: ["https://luke.github.io"] }, "https://other.github.io")).toBe(false);
    expect(siteKey("http://192.168.1.1:8080/")).toBe("192.168.1.1");
    expect(loginMatches({ sites: ["http://192.168.1.1"] }, "http://192.168.1.2")).toBe(false);
  });
  it("this-address-only matches the exact host", () => {
    const l = { sites: ["https://my.bank.com"], exactSite: true };
    expect(loginMatches(l, "https://my.bank.com/x")).toBe(true);
    expect(loginMatches(l, "https://www.bank.com/")).toBe(false);
  });
  it("shows hosts raw and turns typing into addresses", () => {
    expect(displayHost("https://www.netflix.com/login")).toBe("netflix.com");
    expect(displayHost("https://аpple.com/")).toBe("xn--pple-43d.com");
    expect(normalizeSiteInput("netflix.com")).toBe("https://netflix.com/");
    expect(normalizeSiteInput("javascript:alert(1)")).toBe(null);
    expect(normalizeSiteInput("not a site")).toBe(null);
    expect(normalizeSiteInput("")).toBe(null);
  });
});

describe("2FA codes", () => {
  // RFC 6238 appendix B (secret "12345678901234567890", 8 digits).
  const secret = new TextEncoder().encode("12345678901234567890");
  it("matches the RFC 6238 test vectors", async () => {
    for (const [t, code] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [20000000000, "65353130"]]) {
      expect(await hotp(secret, Math.floor(t / 30), { digits: 8, algorithm: "SHA1" })).toBe(code);
    }
    const s256 = new TextEncoder().encode("12345678901234567890123456789012");
    expect(await hotp(s256, Math.floor(59 / 30), { digits: 8, algorithm: "SHA256" })).toBe("46119246");
  });
  it("reads otpauth addresses and bare secrets", async () => {
    const t = parseTotp("otpauth://totp/Example:luke@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&digits=8");
    expect(t).toMatchObject({ digits: 8, period: 30, issuer: "Example", account: "luke@example.com" });
    expect(t.secret).toEqual(secret);
    expect((await totpNow(t, 59_000)).code).toBe("94287082");
    expect((await totpNow("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000))).toMatchObject({ code: "287082", remaining: 1 });
    expect(() => parseTotp("otpauth://hotp/x?secret=GEZDGNBVGY3TQOJQ")).toThrow();
    expect(() => base32Decode("not base32!")).toThrow();
  });
});

describe("generator and strength", () => {
  it("makes passwords of the asked length with every chosen kind", () => {
    for (let i = 0; i < 50; i++) {
      const p = generatePassword({ length: 16 });
      expect(p).toHaveLength(16);
      expect(/[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p)).toBe(true);
      expect(/[0O1lI]/.test(p)).toBe(false);
    }
    expect(generatePassword({ length: 12, upper: false, digits: false, symbols: false })).toMatch(/^[a-z]{12}$/);
    expect(generatePassword({ length: 3 })).toHaveLength(8);
    expect(new Set(Array.from({ length: 100 }, () => generatePassword())).size).toBe(100);
  });
  it("calls common, short and patterned passwords weak", () => {
    expect(isWeak("password1")).toBe(true);
    expect(isWeak("Summer2024")).toBe(true);
    expect(isWeak("aaaaaaaaaaaaaaaa")).toBe(true);
    expect(isWeak(generatePassword())).toBe(false);
    expect(estimateBits("abcdefghijklmnop")).toBeLessThan(estimateBits("q8#Lr2!vTz9@mW4k"));
  });
});

describe("import and export", () => {
  const icloud = 'Title,URL,Username,Password,Notes,OTPAuth\r\n"Netflix",https://www.netflix.com/,luke@example.com,"pw, with ""quotes""",,\r\nBank,https://my.bank.com/,luke,bankpw-icloud,"line1\nline2",otpauth://totp/Bank?secret=JBSWY3DPEHPK3PXP\r\n';
  const chrome = "name,url,username,password,note\nnetflix.com,https://netflix.com/login,luke@example.com,older-chrome-pw,\nBank,https://bank.com/,luke,bankpw-chrome,\nAndroid,android://abc@com.app/,,x,\nEmpty,https://e.com,,,\n";

  it("parses quoted CSV, BOMs and line breaks in cells", () => {
    expect(parseCsv('﻿a,b\n"x\ny","z""w"\n')).toEqual([["a", "b"], ["x\ny", 'z"w']]);
  });
  it("reads both formats and skips rows with nothing to keep", () => {
    const a = readExport(icloud);
    expect(a.format).toBe("icloud");
    expect(a.entries[0]).toMatchObject({ title: "Netflix", password: 'pw, with "quotes"', source: "icloud" });
    expect(a.entries[1].totp).toMatch(/^otpauth:/);
    const b = readExport(chrome);
    expect(b.format).toBe("chrome");
    expect(b.entries.map((e) => e.title)).toEqual(["netflix.com", "Bank", "Android"]);
    expect(b.entries[2].sites).toEqual([]);
    expect(b.skipped).toBe(1);
    expect(() => readExport("foo,bar\n1,2")).toThrow();
  });
  it("merges: iCloud wins a disagreement; the other password goes to history, tagged", () => {
    const plan = planImport([], [...readExport(chrome).entries, ...readExport(icloud).entries], T);
    const nf = plan.add.find((l) => l.username === "luke@example.com");
    expect(nf.password).toBe('pw, with "quotes"');
    expect(nf.history).toEqual([{ password: "older-chrome-pw", changed: T }]);
    expect(nf.tags).toContain(CHECK_TAG);
    expect(nf.sites).toHaveLength(2);
    const bank = plan.add.find((l) => l.title === "Bank");
    expect(bank.password).toBe("bankpw-icloud");
    expect(bank.totp).toMatch(/^otpauth:/);
    expect(plan.add).toHaveLength(3);
  });
  it("a login already in Liv keeps its password; the same import twice changes nothing", () => {
    const first = planImport([], readExport(icloud).entries, T);
    const existing = first.add.map((l, i) => ({ ...l, id: `id-${i}` }));
    expect(planImport(existing, readExport(icloud).entries, T)).toMatchObject({ add: [], update: [], same: 2 });
    const changed = planImport(existing, readExport(chrome).entries, T);
    const u = changed.update.find((x) => x.login.title === "Netflix");
    expect(u.login.password).toBe('pw, with "quotes"');
    expect(u.login.history[0].password).toBe("older-chrome-pw");
  });
  it("exports in the iCloud layout, one row per site, and reads back", () => {
    const csv = toCsv([{ kind: "login", title: "A", sites: ["https://a.com/", "https://b.com/"], username: "u", password: 'p"w', notes: "", totp: "" }, { kind: "note", title: "Wifi", notes: "pw: x" }]);
    const back = readExport(csv);
    expect(back.entries).toHaveLength(2);
    expect(back.entries[0]).toMatchObject({ password: 'p"w', sites: ["https://a.com/"] });
  });
});

describe("Needs attention", () => {
  it("flags reused, weak, leaked and import conflicts", () => {
    const logins = [
      { id: "1", sites: ["https://a.com"], password: "SharedPassword-123!", tags: [] },
      { id: "2", sites: ["https://b.com"], password: "SharedPassword-123!", tags: [] },
      { id: "3", sites: ["https://www.a.com"], password: "Unique-Long-Passphrase-9", tags: [] },
      { id: "4", sites: ["https://c.com"], password: "short", tags: [CHECK_TAG] },
      { id: "5", kind: "note", notes: "x" },
    ];
    const a = attention(logins, new Map([["3", 12]]));
    expect(a.get("1")).toEqual(["reused"]);
    expect(a.get("3")).toEqual(["leaked"]);
    expect(a.get("4")).toEqual(["weak", "check"]);
    expect(a.has("5")).toBe(false);
  });
  it("sends only the first 5 hash characters, with padding, and matches locally", async () => {
    const hash = await sha1Hex("password");
    expect(hash).toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, text: async () => `0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n` };
    };
    expect(await pwnedCount("password", { fetchImpl })).toBe(9545824);
    expect(calls[0].url).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    expect(calls[0].opts.headers["Add-Padding"]).toBe("true");
    expect(await pwnedCount("something-else", { fetchImpl })).toBe(0);
  });
});

// ---- end to end ------------------------------------------------------------------------------

describe("the data layer, against Postgres with row security", () => {
  const PERSONAL = `u-${USERS.luke}`;
  let db;
  const scopeMembers = async (scope) => (scope === GROUP ? [USERS.luke, USERS.wife] : []);

  function device(userKey, now) {
    const userId = USERS[userKey];
    const transport = pgliteTransport(db, userId);
    const account = createMessagingAccount({ server: createMessagingServer(transport), store: createKeystore(memoryBackend()), userId });
    const server = createDocumentsServer(transport);
    const store = createKeystore(memoryBackend());
    const vaults = createDocumentsVaults({ server, store, account, userId, scopeMembers });
    return { userId, account, server, vaults, store, logins: createLoginsLibrary({ server, vaults, store, now }) };
  }
  const verify = async (a, b) => { await a.account.resolveDevices([b.userId]); await a.account.markVerified(b.userId); };

  async function household(now) {
    db = await createDocumentsDatabase();
    const luke = device("luke", now);
    await luke.account.setupPhone();
    await luke.vaults.createVault(PERSONAL);
    await luke.vaults.createVault(GROUP);
    const her = device("wife", now);
    await her.account.setupPhone();
    await her.vaults.ensureBox();
    await verify(luke, her);
    await verify(her, luke);
    await luke.vaults.grantPending(GROUP);
    await her.vaults.open(GROUP);
    return { luke, her };
  }

  it("saves, lists, shares Household (never Personal) and keeps password history", async () => {
    const { luke, her } = await household();
    const id = await luke.logins.save(GROUP, null, { title: "Netflix", sites: ["https://netflix.com/"], username: "us@example.com", password: "first-password-123" });
    await luke.logins.save(PERSONAL, null, { title: "Work", username: "luke", password: "work-password-123" });
    const [nf] = await her.logins.list(GROUP);
    expect(nf).toMatchObject({ id, title: "Netflix", password: "first-password-123", rev: 1, createdBy: USERS.luke });
    await her.logins.save(GROUP, nf, { password: "second-password-456" });
    const [nf2] = await luke.logins.list(GROUP);
    expect(nf2).toMatchObject({ rev: 2, password: "second-password-456" });
    expect(nf2.history.map((h) => h.password)).toEqual(["first-password-123"]);
    await expect(her.logins.list(PERSONAL)).rejects.toThrow();
    // The server only ever holds ciphertext.
    const rows = (await db.query("select enc from public.safe_logins")).rows.map((r) => r.enc).join("");
    expect(rows).not.toMatch(/Netflix|password|example/);
  });

  it("refuses an older copy the server replays, and only reads what changed", async () => {
    const { luke } = await household();
    const id = await luke.logins.save(GROUP, null, { title: "Bank", password: "v1-password-aaaa" });
    const [old] = (await db.query("select enc, key_version from public.safe_logins where id = $1", [id])).rows;
    const [l1] = await luke.logins.list(GROUP);
    await luke.logins.save(GROUP, l1, { password: "v2-password-bbbb" });
    expect((await luke.logins.list(GROUP))[0].password).toBe("v2-password-bbbb");
    await db.query("update public.safe_logins set enc = $2 where id = $1", [id, old.enc]); // replay rev 1
    expect((await luke.logins.list(GROUP))[0]).toMatchObject({ rev: 2, password: "v2-password-bbbb" });
    // A row moved to another login's id doesn't open (its context names the old id).
    const id2 = await luke.logins.save(GROUP, null, { title: "Other", password: "other-password-x" });
    await db.query("update public.safe_logins set enc = $2 where id = $1", [id2, old.enc]);
    const list = await createLoginsLibrary({ server: luke.server, vaults: luke.vaults, store: createKeystore(memoryBackend()) }).list(GROUP);
    expect(list.map((l) => l.title)).toEqual(["Bank"]);
  });

  it("Recently deleted, restore, move to Personal, and import in batches", async () => {
    const { luke, her } = await household();
    const id = await luke.logins.save(GROUP, null, { title: "Gym", password: "gym-password-1234" });
    await luke.logins.trash(GROUP, id);
    expect((await her.logins.list(GROUP))[0].deletedAt).toBeTruthy();
    await her.logins.restore(GROUP, id);
    const [gym] = await luke.logins.list(GROUP);
    expect(gym.deletedAt).toBe(null);
    await luke.logins.move(GROUP, gym, PERSONAL);
    expect((await luke.logins.list(PERSONAL)).map((l) => l.title)).toEqual(["Gym"]);
    expect((await her.logins.list(GROUP))[0].deletedAt).toBeTruthy();
    const many = Array.from({ length: 120 }, (_, i) => ({ title: `Site ${i}`, username: "u", password: `pw-${i}-xxxxxxxx` }));
    expect(await luke.logins.addMany(PERSONAL, many)).toBe(120);
    expect(await luke.logins.list(PERSONAL)).toHaveLength(121);
  });

  it("removing a device re-seals every login under the new version; the removed device can't read them", async () => {
    const { luke, her } = await household();
    const br = device("luke");
    const code = await br.account.startLink({ label: "Chrome" });
    await luke.account.approveLink(code);
    await br.account.finishLink();
    await br.vaults.ensureBox();
    await luke.vaults.grantPending(GROUP);
    await br.vaults.open(GROUP);
    await luke.logins.save(GROUP, null, { title: "Utility", password: "utility-password-1" });
    expect((await br.logins.list(GROUP))).toHaveLength(1);

    await luke.vaults.removeDevice((await br.account.me()).deviceId, [PERSONAL, GROUP]);
    const rows = (await db.query("select key_version from public.safe_logins")).rows;
    expect(rows.map((r) => r.key_version)).toEqual([2]);
    expect(await her.vaults.open(GROUP)).toMatchObject({ state: "ready", version: 2 });
    expect((await her.logins.list(GROUP))[0]).toMatchObject({ title: "Utility", password: "utility-password-1", rev: 1 });
    expect(await br.vaults.open(GROUP)).toMatchObject({ state: "removed" });
    await expect(br.logins.list(GROUP)).rejects.toThrow();
  });
}, 120_000);
