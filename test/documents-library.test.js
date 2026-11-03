// The Documents library (documents/library.js) against a real Postgres with row
// security, real messaging accounts and vaults, and an in-memory object store.

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { createMessagingServer } from "../messaging/server.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { createMessagingAccount } from "../messaging/account.js";
import { toB64, utf8, fromUtf8 } from "../messaging/crypto/bytes.js";
import { createDocumentsServer } from "../documents/server.js";
import { createDocumentsVaults } from "../documents/vaults.js";
import { createDocumentsLibrary } from "../documents/library.js";
import { createDocumentsStorage, memoryObjectStore } from "../documents/storage.js";
import { generateFileKey, wrapFileKey, encryptMeta } from "../documents/crypto/index.js";
import { createDocumentsDatabase, pgliteTransport, USERS, GROUP } from "./documents-pglite-harness.js";

let db, objects;
beforeAll(async () => { await loadSodium(); });
beforeEach(async () => { db = await createDocumentsDatabase(); objects = memoryObjectStore(); }, 60_000);

let clock = Date.parse("2026-11-03T12:00:00Z");
const scopeMembers = async (scope) => (scope === GROUP ? [USERS.luke, USERS.wife] : []);
const PERSONAL = `u-${USERS.luke}`;
const STARTING = ["IDs & Records", "Home", "Vehicles", "Insurance", "Medical"];

function device(userKey) {
  const userId = USERS[userKey];
  const transport = pgliteTransport(db, userId);
  const account = createMessagingAccount({ server: createMessagingServer(transport), store: createKeystore(memoryBackend()), userId });
  const server = createDocumentsServer(transport);
  const vaults = createDocumentsVaults({ server, store: createKeystore(memoryBackend()), account, userId, scopeMembers });
  const storage = createDocumentsStorage(objects);
  const library = createDocumentsLibrary({ server, storage, vaults, store: createKeystore(memoryBackend()), userId, now: () => clock });
  return { userId, account, server, vaults, library };
}

async function household() {
  const luke = device("luke");
  await luke.account.setupPhone();
  await luke.vaults.createVault(PERSONAL);
  await luke.vaults.createVault(GROUP);
  const her = device("wife");
  await her.account.setupPhone();
  await her.vaults.ensureBox();
  for (const [a, b] of [[luke, her], [her, luke]]) { await a.account.resolveDevices([b.userId]); await a.account.markVerified(b.userId); }
  await luke.vaults.grantPending(GROUP);
  await her.vaults.open(GROUP);
  return { luke, her };
}

const pdf = utf8("%PDF-1.7 pretend passport scan");

describe("folders", () => {
  it("starting folders: Receipts first, idempotent, shared with Marijane", async () => {
    const { luke, her } = await household();
    await luke.library.ensureStartingFolders(GROUP, { receipts: true, names: STARTING });
    await luke.library.ensureStartingFolders(GROUP, { receipts: true, names: STARTING });
    const names = (await her.library.folders(GROUP)).map((f) => f.name);
    expect(names).toEqual(["Receipts", ...STARTING]);
    expect((await db.query(`select count(*)::int n from public.doc_folders`)).rows[0].n).toBe(6);
    // the server only ever sees ciphertext names
    const raw = (await db.query(`select enc_name from public.doc_folders`)).rows.map((r) => r.enc_name).join(" ");
    expect(raw).not.toMatch(/Receipts|Medical/);
  });

  it("rename; the Receipts folder can't be deleted; deleting a folder sends its files to Recently deleted", async () => {
    const { luke } = await household();
    await luke.library.ensureStartingFolders(GROUP, { receipts: true, names: ["Home"] });
    const [rcpt, home] = await luke.library.folders(GROUP);
    await luke.library.renameFolder(GROUP, home.id, "House");
    expect((await luke.library.folders(GROUP)).map((f) => f.name)).toEqual(["Receipts", "House"]);
    await expect(luke.library.deleteFolder(GROUP, rcpt.id)).rejects.toMatchObject({ code: "RECEIPTS" });
    const id = await luke.library.addFile(GROUP, { content: pdf, meta: { name: "Deed", mime: "application/pdf" }, folderId: home.id });
    await luke.library.deleteFolder(GROUP, home.id);
    expect((await luke.library.folders(GROUP)).map((f) => f.name)).toEqual(["Receipts"]);
    expect(await luke.library.files(GROUP)).toEqual([]);
    expect((await luke.library.files(GROUP, { includeDeleted: true })).map((f) => f.id)).toEqual([id]);
  });
});

describe("files", () => {
  it("add, list and open on another device; parts encrypted at rest", async () => {
    const { luke, her } = await household();
    const [rcpt] = await luke.library.ensureStartingFolders(GROUP, { receipts: true });
    const id = await luke.library.addFile(GROUP, {
      content: pdf, thumb: utf8("jpeg-thumb"), text: "TARGET TOTAL $12.40",
      meta: { name: "Target · Nov 3", mime: "application/pdf", pages: 1, documentDate: "2026-11-03", tags: ["groceries"] },
      folderId: rcpt.id,
    });
    const [f] = await her.library.files(GROUP);
    expect(f).toMatchObject({ id, name: "Target · Nov 3", folderId: rcpt.id, pages: 1, tags: ["groceries"], folderMismatch: false, rev: 1, parts: ["content", "thumb", "text"] });
    const opened = await her.library.open(GROUP, id);
    expect(fromUtf8(opened.bytes)).toBe(fromUtf8(pdf));
    expect(opened.mime).toBe("application/pdf");
    expect(fromUtf8(await her.library.thumbnail(GROUP, id))).toBe("jpeg-thumb");
    expect(await her.library.searchText(GROUP, id)).toBe("TARGET TOTAL $12.40");
    for (const [, bytes] of objects.objects) expect(new TextDecoder().decode(bytes)).not.toMatch(/PDF|TARGET|jpeg/);
    expect(await luke.library.usage(GROUP)).toBeGreaterThan(pdf.length);
  });

  it("Personal files stay Luke's", async () => {
    const { luke, her } = await household();
    await luke.library.addFile(PERSONAL, { content: pdf, meta: { name: "Passport", mime: "application/pdf" } });
    expect((await luke.library.files(PERSONAL)).map((f) => f.name)).toEqual(["Passport"]);
    await expect(her.library.files(PERSONAL)).rejects.toMatchObject({ code: "LOCKED" });
    expect((await db.query(`select count(*)::int n from public.doc_files where scope = $1`, [PERSONAL])).rows[0].n).toBe(1);
  });

  it("refuses types that could run script, and folders from elsewhere", async () => {
    const { luke } = await household();
    await expect(luke.library.addFile(GROUP, { content: pdf, meta: { name: "x", mime: "text/html" } })).rejects.toThrow(/not allowed/);
    await expect(luke.library.addFile(GROUP, { content: pdf, meta: { name: "x", mime: "image/svg+xml" } })).rejects.toThrow(/not allowed/);
    const personalFolder = await luke.library.addFolder(PERSONAL, "Work");
    await expect(luke.library.addFile(GROUP, { content: pdf, meta: { name: "x", mime: "application/pdf" }, folderId: personalFolder })).rejects.toMatchObject({ code: "MISSING" });
  });

  it("rename, tags, date and move each bump the revision", async () => {
    const { luke, her } = await household();
    const [rcpt, home] = await luke.library.ensureStartingFolders(GROUP, { receipts: true, names: ["Home"] });
    const id = await luke.library.addFile(GROUP, { content: pdf, meta: { name: "Scan", mime: "application/pdf" } });
    await luke.library.rename(GROUP, id, "Mortgage statement");
    await luke.library.setTags(GROUP, id, ["mortgage"]);
    await luke.library.setDocumentDate(GROUP, id, "2026-10-01");
    await luke.library.move(GROUP, id, home.id);
    const [f] = await her.library.files(GROUP);
    expect(f).toMatchObject({ name: "Mortgage statement", tags: ["mortgage"], documentDate: "2026-10-01", folderId: home.id, rev: 5, folderMismatch: false });
    await expect(luke.library.move(GROUP, id, "f0000000-0000-0000-0000-00000000dead")).rejects.toMatchObject({ code: "MISSING" });
    expect(rcpt.kind).toBe("receipts");
  });
});

describe("a server that lies", () => {
  it("an older copy of the metadata is refused; the device keeps the newer one", async () => {
    const { luke } = await household();
    const id = await luke.library.addFile(GROUP, { content: pdf, meta: { name: "Old name", mime: "application/pdf" } });
    const old = (await db.query(`select enc_meta from public.doc_files where id = $1`, [id])).rows[0].enc_meta;
    await luke.library.rename(GROUP, id, "New name");
    await db.query(`update public.doc_files set enc_meta = $1 where id = $2`, [old, id]);
    const [f] = await luke.library.files(GROUP);
    expect(f).toMatchObject({ name: "New name", stale: true });
    await expect(luke.library.rename(GROUP, id, "Third")).rejects.toMatchObject({ code: "STALE" });
  });

  it("a moved row (folder_id changed by the server) is shown where the metadata says", async () => {
    const { luke } = await household();
    const [rcpt, home] = await luke.library.ensureStartingFolders(GROUP, { receipts: true, names: ["Home"] });
    const id = await luke.library.addFile(GROUP, { content: pdf, meta: { name: "Deed", mime: "application/pdf" }, folderId: home.id });
    await db.query(`update public.doc_files set folder_id = $1 where id = $2`, [rcpt.id, id]);
    const [f] = await luke.library.files(GROUP);
    expect(f).toMatchObject({ folderId: home.id, folderMismatch: true });
  });

  it("after a device is removed, a row added under the old key isn't shown; real files still open", async () => {
    const { luke } = await household();
    const browser = device("luke");
    const code = await browser.account.startLink({ label: "Chrome" });
    await luke.account.approveLink(code);
    await browser.account.finishLink();
    await browser.vaults.ensureBox();
    await luke.vaults.grantPending(GROUP);
    await browser.vaults.open(GROUP);
    const real = await luke.library.addFile(GROUP, { content: pdf, meta: { name: "Real", mime: "application/pdf" } });
    const oldKey = (await browser.vaults.keysFor(GROUP)).key;
    await luke.vaults.removeDevice((await browser.account.me()).deviceId, [GROUP]);
    // The removed browser (still holding version 1) slips in a document under it.
    const vault = await luke.server.vault(GROUP);
    const fid = crypto.randomUUID();
    const fk = generateFileKey();
    await db.query(`insert into public.doc_files (id, scope, wrapped_key, key_version, enc_meta, size) values ($1, $2, $3, 1, $4, 10)`,
      [fid, GROUP, toB64(wrapFileKey(oldKey, fk, { vaultId: vault.id, scope: GROUP, fileId: fid, keyVersion: 1 })), toB64(encryptMeta(fk, fid, { v: 1, rev: 1, name: "Bank details (updated)", mime: "application/pdf" }))]);
    // ...with a real blob, so only the settled-version rule stands in the way.
    const { encryptBlob } = await import("../documents/crypto/index.js");
    await createDocumentsStorage(objects).put(GROUP, fid, { content: encryptBlob(fk, fid, "content", utf8("forged")) });
    const list = await luke.library.files(GROUP);
    expect(list.map((f) => f.name)).toEqual(["Real"]);
    expect(fromUtf8((await luke.library.open(GROUP, real)).bytes)).toBe(fromUtf8(pdf));
    await expect(luke.library.open(GROUP, fid)).rejects.toMatchObject({ code: "MISSING" });
  });
});

describe("Recently deleted", () => {
  it("trash, restore, and gone after 30 days (blobs too)", async () => {
    const { luke } = await household();
    const id = await luke.library.addFile(GROUP, { content: pdf, thumb: utf8("t"), meta: { name: "Old bill", mime: "application/pdf" } });
    await luke.library.trash(GROUP, id);
    expect(await luke.library.files(GROUP)).toEqual([]);
    await luke.library.restore(GROUP, id);
    expect((await luke.library.files(GROUP)).length).toBe(1);
    await luke.library.trash(GROUP, id);
    expect(await luke.library.purgeExpired(GROUP)).toBe(0);
    expect(await luke.library.purge(GROUP, id)).toBe(false); // too early: nothing goes
    expect((await luke.library.files(GROUP, { includeDeleted: true })).length).toBe(1);
    expect([...objects.objects.keys()].filter((k) => k.includes(id)).length).toBe(2);
    clock += 31 * 24 * 3600 * 1000;
    // The database checks the 30 days by its own clock: age the row there too.
    await db.query(`update public.doc_files set deleted_at = now() - interval '31 days'`);
    expect(await luke.library.purgeExpired(GROUP)).toBe(1);
    expect((await db.query(`select count(*)::int n from public.doc_files`)).rows[0].n).toBe(0);
    expect([...objects.objects.keys()].filter((k) => k.includes(id))).toEqual([]);
  });
});

describe("egress", () => {
  it("thumbnails and opening reuse the listed rows: one table read per listing, not one per file", async () => {
    const { luke } = await household();
    const ids = [];
    for (let i = 0; i < 8; i++) ids.push(await luke.library.addFile(GROUP, { content: pdf, thumb: utf8(`thumb ${i}`), meta: { name: `Doc ${i}`, mime: "application/pdf" } }));
    let listReads = 0, rowReads = 0;
    const real = { files: luke.server.files, file: luke.server.file };
    luke.server.files = async (...a) => { listReads++; return real.files(...a); };
    luke.server.file = async (...a) => { rowReads++; return real.file(...a); };
    await luke.library.files(GROUP);
    for (const id of ids) expect(fromUtf8(await luke.library.thumbnail(GROUP, id))).toMatch(/^thumb \d$/);
    await luke.library.open(GROUP, ids[0]);
    expect(listReads).toBe(1);
    expect(rowReads).toBe(0);
  });
});
