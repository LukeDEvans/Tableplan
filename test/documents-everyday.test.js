// Everyday documents (documents/everyday.js) against PGlite with the real migrations
// and row security, and the memory object store: folders, adding and opening, edits,
// search by the database, Recently deleted and purging, and that another household
// sees nothing. Also: the receipts outbox files into it the same way as into the Safe.

import { describe, it, expect, beforeAll } from "vitest";
import { createDocumentsDatabase, pgliteTransport, USERS, GROUP } from "./documents-pglite-harness.js";
import { asUser } from "./documents-pglite-harness.js";
import { createEverydayLibrary, EVERYDAY_STARTING_FOLDERS } from "../documents/everyday.js";
import { createDocumentsStorage, memoryObjectStore } from "../documents/storage.js";
import { createReceiptOutbox, fileReceipts } from "../documents/outbox.js";
import { createKeystore, memoryBackend } from "../messaging/keystore.js";
import { MIME_TYPES as SAFE_TYPES } from "../documents/crypto/meta.js";
import { MIME_TYPES } from "../documents/common.js";

const PERSONAL = `u-${USERS.luke}`;
const bytes = (s) => new TextEncoder().encode(s);
let db, objects, clock;
const lib = (who) => createEverydayLibrary({
  transport: pgliteTransport(db, USERS[who]),
  storage: createDocumentsStorage({ ...objects, tier: "everyday" }),
  now: () => clock,
});

beforeAll(async () => {
  db = await createDocumentsDatabase();
  objects = memoryObjectStore();
  clock = Date.now();
}, 60_000);

describe("everyday documents", () => {
  it("the allowed file kinds are the Safe's", () => {
    expect([...MIME_TYPES]).toEqual([...SAFE_TYPES]);
  });

  it("starting folders: Receipts first, then Home and Vehicles; idempotent", async () => {
    const luke = lib("luke");
    const made = await luke.ensureStartingFolders(GROUP, { receipts: true, names: EVERYDAY_STARTING_FOLDERS.household });
    expect(made.map((f) => f.name)).toEqual(["Receipts", "Home", "Vehicles"]);
    const again = await lib("wife").ensureStartingFolders(GROUP, { receipts: true, names: EVERYDAY_STARTING_FOLDERS.household });
    expect(again.map((f) => f.name)).toEqual(["Receipts", "Home", "Vehicles"]);
    expect(await lib("stranger").folders(GROUP)).toEqual([]);
  });

  it("adds, lists and opens a file without any keys; the bytes are stored as they are under p/", async () => {
    const luke = lib("luke");
    const home = (await luke.folders(GROUP)).find((f) => f.name === "Home").id;
    const id = await luke.addFile(GROUP, { content: bytes("%PDF lease"), thumb: bytes("jpg"), text: "LEASE AGREEMENT Oak Street", folderId: home, meta: { name: "Lease", mime: "application/pdf", pages: 3, documentDate: "2026-01-05", tags: ["home", "home", " lease "] } });
    const [f] = await lib("wife").files(GROUP);
    expect(f).toMatchObject({ id, name: "Lease", folderId: home, pages: 3, documentDate: "2026-01-05", tags: ["home", "lease"], addedBy: USERS.luke, parts: ["content", "thumb"] });
    expect(f).not.toHaveProperty("body_text");
    expect(new TextDecoder().decode((await lib("wife").open(GROUP, id)).bytes)).toBe("%PDF lease");
    expect(new TextDecoder().decode(await lib("wife").thumbnail(GROUP, id))).toBe("jpg");
    expect([...objects.objects.keys()].filter((k) => k.includes(id)).sort()).toEqual([`p/${GROUP}/${id}/content`, `p/${GROUP}/${id}/thumb`]);
    await expect(lib("stranger").open(GROUP, id)).rejects.toMatchObject({ code: "MISSING" });
    expect(await lib("luke").files(PERSONAL)).toEqual([]);
  });

  it("search reads names and the text from the pages, in the database", async () => {
    const wife = lib("wife");
    expect((await wife.search(GROUP, "oak street")).length).toBe(1);
    expect((await wife.search(GROUP, "lea")).length).toBe(1);
    expect(await wife.search(GROUP, "nothing like it")).toEqual([]);
    expect(await wife.search(GROUP, "%")).toEqual([]); // wildcards are taken out
    expect(await lib("stranger").search(GROUP, "lease")).toEqual([]);
  });

  it("rename, move, tags and date; folder changes stay in the scope", async () => {
    const luke = lib("luke");
    const [f] = await luke.files(GROUP);
    const vehicles = (await luke.folders(GROUP)).find((x) => x.name === "Vehicles").id;
    await luke.rename(GROUP, f.id, "Oak lease");
    await luke.move(GROUP, f.id, vehicles);
    await luke.setTags(GROUP, f.id, ["a", "b"]);
    await luke.setDocumentDate(GROUP, f.id, "nope");
    const [g] = await luke.files(GROUP);
    expect(g).toMatchObject({ name: "Oak lease", folderId: vehicles, tags: ["a", "b"], documentDate: null });
    const personalFolder = await luke.addFolder(PERSONAL, "Work");
    await expect(luke.move(GROUP, f.id, personalFolder)).rejects.toThrow(/another scope/);
  });

  it("Recently deleted: hidden, put back, then gone after 30 days with its blobs", async () => {
    const luke = lib("luke");
    const [f] = await luke.files(GROUP);
    await luke.trash(GROUP, f.id);
    expect(await luke.files(GROUP)).toEqual([]);
    expect((await luke.files(GROUP, { includeDeleted: true }))[0].deletedAt).toBeTruthy();
    await luke.restore(GROUP, f.id);
    await luke.trash(GROUP, f.id);
    expect(await luke.purgeExpired(GROUP)).toBe(0);
    clock += 31 * 24 * 3600 * 1000;
    await db.query(`update public.doc_pfiles set deleted_at = now() - interval '31 days' where id = $1`, [f.id]);
    expect(await luke.purgeExpired(GROUP)).toBe(1);
    expect(await luke.files(GROUP, { includeDeleted: true })).toEqual([]);
    expect([...objects.objects.keys()].filter((k) => k.includes(f.id))).toEqual([]);
  });

  it("a Live document's version snapshots and images go with it", async () => {
    const { docToContent } = await import("../documents/editor/doc-model.js");
    const { prosemirrorJSONToYDoc } = await import("@tiptap/y-tiptap");
    const { getSchema } = await import("@tiptap/core");
    const { baseExtensions } = await import("../documents/editor/extensions.js");
    const schema = getSchema(baseExtensions({ collaboration: true }));
    const img = "c".repeat(32);
    const ydoc = prosemirrorJSONToYDoc(schema, { type: "doc", content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: `liveimg:${img}` } }] }] }, "default");
    const luke = lib("luke");
    const storage = createDocumentsStorage({ ...objects, tier: "everyday" });
    const id = await luke.addFile(GROUP, { content: docToContent(ydoc), kind: "doc", meta: { name: "Notes", mime: "application/vnd.live.doc" } });
    await storage.putPart(GROUP, id, `i${img}`, bytes("jpeg"));
    await storage.putPart(GROUP, id, "vh03", bytes("snapshot"));
    await asUser(db, USERS.luke, `insert into public.doc_pversions (file_id, scope, slot, size) values ($1, $2, 'h03', 8)`, [id, GROUP]);
    expect([...objects.objects.keys()].filter((k) => k.includes(id)).length).toBe(3);
    await luke.trash(GROUP, id);
    await db.query(`update public.doc_pfiles set deleted_at = now() - interval '31 days' where id = $1`, [id]);
    expect(await luke.purgeExpired(GROUP)).toBe(1);
    expect([...objects.objects.keys()].filter((k) => k.includes(id))).toEqual([]);
  });

  it("a removed folder takes its files to Recently deleted; Receipts can't be removed", async () => {
    const luke = lib("luke");
    const folder = await luke.addFolder(GROUP, "Old");
    await luke.addFile(GROUP, { content: bytes("x"), folderId: folder, meta: { name: "x", mime: "text/plain" } });
    await luke.deleteFolder(GROUP, folder);
    expect((await luke.folders(GROUP)).some((f) => f.id === folder)).toBe(false);
    expect((await luke.files(GROUP, { includeDeleted: true })).find((f) => f.folderId === folder).deletedAt).toBeTruthy();
    const receipts = (await luke.folders(GROUP)).find((f) => f.kind === "receipts").id;
    await expect(luke.deleteFolder(GROUP, receipts)).rejects.toMatchObject({ code: "RECEIPTS" });
  });

  it("the receipts outbox files straight into everyday Receipts", async () => {
    const outbox = createReceiptOutbox(createKeystore(memoryBackend()));
    await outbox.queue([{ bytes: bytes("\xff\xd8 not really"), type: "image/png" }], { scope: GROUP, camera: false });
    const luke = lib("luke");
    const receipts = (await luke.folders(GROUP)).find((f) => f.kind === "receipts").id;
    const out = await fileReceipts({ outbox, library: luke, scope: GROUP, folderId: receipts, mimeOk: (m) => MIME_TYPES.includes(m) });
    expect(out).toEqual({ filed: 1, failed: 0, dropped: 0 });
    const filed = (await luke.files(GROUP)).filter((f) => f.folderId === receipts);
    expect(filed).toHaveLength(1);
    expect(filed[0].tags).toEqual(["receipt"]);
    expect(await outbox.entries()).toEqual([]);
  });
});
