// Access rules of migrations/2026-11-03-documents.sql, run against a real Postgres
// (PGlite) with row security, as Luke, his wife (same household), a coworker (shares
// a business space with Luke, not the household), a stranger and anon.

import { describe, it, expect, beforeAll } from "vitest";
import { createDocumentsDatabase, asUser, USERS, GROUP } from "./documents-pglite-harness.js";

const { luke, wife, stranger, coworker } = USERS;
const DEV = {
  luke: "a0000000-0000-0000-0000-000000000001",
  lukeOld: "a0000000-0000-0000-0000-000000000009",
  wife: "b0000000-0000-0000-0000-000000000001",
  stranger: "c0000000-0000-0000-0000-000000000001",
};
const k43 = (c) => c.repeat(43);
const s86 = (c) => c.repeat(86);
const b64 = (n, c = "A") => c.repeat(n);
const PERSONAL = `u-${luke}`;
const isErr = (r) => typeof r === "string";

let db;
let houseVault, lukeVault;

beforeAll(async () => {
  db = await createDocumentsDatabase();
  // Devices are registered through messaging; seed them directly (as the owner role).
  const dev = (id, user, n, revoked = false) => `('${id}', '${user}', 'phone', '${k43(n)}', '${k43(n.toLowerCase())}', 1, '${s86("a")}', '${s86("b")}', 1, '${k43("Z")}', '${s86("c")}', 1, ${revoked ? "now()" : "null"})`;
  await db.exec(`insert into public.msg_devices (device_id, user_id, kind, sign_pub, dh_pub, created_at_ms, identity_sig, device_sig, spk_id, spk_pub, spk_sig, spk_created_at_ms, revoked_at) values
    ${dev(DEV.luke, luke, "L")}, ${dev(DEV.lukeOld, luke, "O", true)}, ${dev(DEV.wife, wife, "W")}, ${dev(DEV.stranger, stranger, "S")};`);
}, 60_000);

describe("vaults", () => {
  it("each person creates their own Personal vault; members create the Household one", async () => {
    const p = await asUser(db, luke, `insert into public.doc_vaults (scope) values ($1) returning id`, [PERSONAL]);
    expect(isErr(p)).toBe(false);
    lukeVault = p[0].id;
    const h = await asUser(db, wife, `insert into public.doc_vaults (scope) values ($1) returning id`, [GROUP]);
    expect(isErr(h)).toBe(false);
    houseVault = h[0].id;
  });

  it("nobody else can create, read or see whose vault it is", async () => {
    expect(isErr(await asUser(db, wife, `insert into public.doc_vaults (scope) values ($1)`, [`u-${stranger}`]))).toBe(true);
    expect(isErr(await asUser(db, stranger, `insert into public.doc_vaults (scope) values ('${GROUP}x')`))).toBe(true);
    expect(await asUser(db, wife, `select id from public.doc_vaults where scope = $1`, [PERSONAL])).toEqual([]);
    expect(await asUser(db, coworker, `select id from public.doc_vaults`)).toEqual([]);
    expect(await asUser(db, stranger, `select public.doc_vault_scope($1) s`, [houseVault])).toEqual([{ s: null }]);
    expect(await asUser(db, wife, `select public.doc_vault_scope($1) s`, [houseVault])).toEqual([{ s: GROUP }]);
    expect(isErr(await asUser(db, null, `select * from public.doc_vaults`))).toBe(true);
    expect(isErr(await asUser(db, luke, `select public.doc_scope_allows($1, $2)`, [GROUP, stranger]))).toBe(true);
  });

  it("start at version 1; move up one step at a time; scope never changes", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.doc_vaults (scope, key_version) values ($1, 2)`, [`u-${luke}-x`]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_vaults set key_version = 3 where id = $1`, [lukeVault]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_vaults set key_version = 2 where id = $1`, [lukeVault]))).toBe(false);
    expect(isErr(await asUser(db, luke, `update public.doc_vaults set key_version = 1 where id = $1`, [lukeVault]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_vaults set scope = $2 where id = $1`, [lukeVault, GROUP]))).toBe(true);
    // the wife can't rotate Luke's Personal vault (row isn't visible to her)
    const r = await asUser(db, wife, `update public.doc_vaults set key_version = 3 where id = $1 returning id`, [lukeVault]);
    expect(r).toEqual([]);
  });
});

describe("device box keys", () => {
  it("only for one's own live device", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.doc_device_boxes (device_id, user_id, box_pub, box_sig) values ($1, $2, $3, $4)`, [DEV.luke, luke, k43("B"), s86("d")]))).toBe(false);
    expect(isErr(await asUser(db, luke, `insert into public.doc_device_boxes (device_id, user_id, box_pub, box_sig) values ($1, $2, $3, $4)`, [DEV.wife, luke, k43("C"), s86("d")]))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.doc_device_boxes (device_id, user_id, box_pub, box_sig) values ($1, $2, $3, $4)`, [DEV.wife, wife, k43("C"), s86("d")]))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.doc_device_boxes (device_id, user_id, box_pub, box_sig) values ($1, $2, $3, $4)`, [DEV.lukeOld, luke, k43("D"), s86("d")]))).toBe(true);
    expect(isErr(await asUser(db, wife, `insert into public.doc_device_boxes (device_id, user_id, box_pub, box_sig) values ($1, $2, $3, $4)`, [DEV.wife, wife, k43("E"), s86("d")]))).toBe(false);
  });
  it("readable by contacts, not strangers; can't be edited", async () => {
    expect((await asUser(db, wife, `select device_id from public.doc_device_boxes where user_id = $1`, [luke])).length).toBe(1);
    expect(await asUser(db, stranger, `select device_id from public.doc_device_boxes`)).toEqual([]);
    expect(isErr(await asUser(db, luke, `update public.doc_device_boxes set box_pub = $1 where device_id = $2`, [k43("F"), DEV.luke]))).toBe(true);
  });
});

describe("grants", () => {
  const grant = (vault, version, device, granterUser, granterDevice) => [
    `insert into public.doc_vault_grants (vault_id, key_version, device_id, sealed, granter_user_id, granter_device_id, granter_sig) values ($1, $2, $3, $4, $5, $6, $7)`,
    [vault, version, device, b64(200), granterUser, granterDevice, s86("g")],
  ];
  it("a member grants the Household vault to a member's live device", async () => {
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 1, DEV.wife, luke, DEV.luke)))).toBe(false);
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 1, DEV.luke, luke, DEV.luke)))).toBe(false);
  });
  it("refuses: Personal to someone else, a removed device, someone else's name or device, a stranger's device", async () => {
    expect(isErr(await asUser(db, luke, ...grant(lukeVault, 2, DEV.wife, luke, DEV.luke)))).toBe(true);
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 1, DEV.lukeOld, luke, DEV.luke)))).toBe(true);
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 2, DEV.wife, luke, DEV.lukeOld)))).toBe(true);
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 2, DEV.wife, wife, DEV.wife)))).toBe(true);
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 2, DEV.wife, luke, DEV.wife)))).toBe(true);
    expect(isErr(await asUser(db, luke, ...grant(houseVault, 2, DEV.stranger, luke, DEV.luke)))).toBe(true);
    expect(isErr(await asUser(db, stranger, ...grant(houseVault, 2, DEV.stranger, stranger, DEV.stranger)))).toBe(true);
  });
  it("members see the vault's grants; nobody else", async () => {
    expect((await asUser(db, wife, `select device_id from public.doc_vault_grants`)).length).toBe(2);
    expect(await asUser(db, stranger, `select device_id from public.doc_vault_grants`)).toEqual([]);
    expect(await asUser(db, coworker, `select device_id from public.doc_vault_grants`)).toEqual([]);
  });
});

describe("old keys and settled statements", () => {
  it("members add and read; signer is always the caller; nothing is edited", async () => {
    expect(isErr(await asUser(db, luke, `insert into public.doc_vault_keys_old (vault_id, key_version, wrapped) values ($1, 1, $2)`, [lukeVault, b64(98)]))).toBe(false);
    expect(isErr(await asUser(db, wife, `insert into public.doc_vault_keys_old (vault_id, key_version, wrapped) values ($1, 1, $2)`, [lukeVault, b64(98)]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_vault_keys_old set wrapped = $1`, [b64(98, "B")]))).toBe(true);
    expect(isErr(await asUser(db, luke, `insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, removed_device_ids, sig) values ($1, 2, $2, $3, $4)`, [lukeVault, luke, `{${DEV.lukeOld}}`, s86("s")]))).toBe(false);
    expect(isErr(await asUser(db, luke, `insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, sig) values ($1, 2, $2, $3)`, [houseVault, wife, s86("s")]))).toBe(true);
    expect(isErr(await asUser(db, stranger, `insert into public.doc_vault_settled (vault_id, key_version, signer_user_id, sig) values ($1, 2, $2, $3)`, [houseVault, stranger, s86("s")]))).toBe(true);
    expect(isErr(await asUser(db, luke, `delete from public.doc_vault_settled`))).toBe(true);
    expect(await asUser(db, wife, `select key_version from public.doc_vault_settled`)).toEqual([]);
  });
});

describe("recovery", () => {
  it("own recovery key only; generation only moves up", async () => {
    const ins = `insert into public.doc_recovery_keys (user_id, generation, recovery_pub, params, sig) values ($1, $2, $3, $4, $5)`;
    expect(isErr(await asUser(db, luke, ins, [wife, 1, k43("R"), b64(34), s86("r")]))).toBe(true);
    expect(isErr(await asUser(db, luke, ins, [luke, 1, k43("R"), b64(34), s86("r")]))).toBe(false);
    expect(isErr(await asUser(db, luke, `update public.doc_recovery_keys set generation = 1, recovery_pub = $1 where user_id = $2`, [k43("Q"), luke]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_recovery_keys set generation = 2, recovery_pub = $1 where user_id = $2`, [k43("Q"), luke]))).toBe(false);
    expect(await asUser(db, wife, `select user_id from public.doc_recovery_keys`)).toEqual([]);
  });
  it("own wraps, only for vaults one may use", async () => {
    const ins = `insert into public.doc_recovery_wraps (user_id, vault_id, key_version, kind, wrapped) values ($1, $2, 1, 'anchor', $3)`;
    expect(isErr(await asUser(db, luke, ins, [luke, lukeVault, b64(98)]))).toBe(false);
    expect(isErr(await asUser(db, luke, ins, [luke, houseVault, b64(98)]))).toBe(false);
    expect(isErr(await asUser(db, wife, ins, [wife, lukeVault, b64(98)]))).toBe(true);
    expect(isErr(await asUser(db, wife, ins, [luke, houseVault, b64(98)]))).toBe(true);
    expect(await asUser(db, wife, `select vault_id from public.doc_recovery_wraps`)).toEqual([]);
  });
});

describe("folders and files", () => {
  const F = { rcpt: "f0000000-0000-0000-0000-000000000001", home: "f0000000-0000-0000-0000-000000000002", mine: "f0000000-0000-0000-0000-000000000003" };
  const folder = (id, scope, kind = "user") => [`insert into public.doc_folders (id, scope, enc_name, key_version, kind) values ($1, $2, $3, 1, $4)`, [id, scope, b64(140), kind]];
  const file = (id, scope, folderId, extra = {}) => {
    const row = { id, scope, folder_id: folderId, wrapped_key: b64(98), key_version: 1, enc_meta: b64(200), size: 1000, ...extra };
    const cols = Object.keys(row);
    return [`insert into public.doc_files (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, cols.map((c) => row[c])];
  };

  it("one Receipts folder per scope, and it stays", async () => {
    expect(isErr(await asUser(db, luke, ...folder(F.rcpt, GROUP, "receipts")))).toBe(false);
    expect(isErr(await asUser(db, wife, ...folder("f0000000-0000-0000-0000-000000000009", GROUP, "receipts")))).toBe(true);
    expect(isErr(await asUser(db, wife, `update public.doc_folders set deleted_at = now() where id = $1`, [F.rcpt]))).toBe(true);
    expect(isErr(await asUser(db, wife, `delete from public.doc_folders where id = $1`, [F.rcpt]))).toBe(true);
    expect(isErr(await asUser(db, wife, `update public.doc_folders set enc_name = $1 where id = $2`, [b64(140, "B"), F.rcpt]))).toBe(false);
  });

  it("members add folders in their scopes; not in others'", async () => {
    expect(isErr(await asUser(db, wife, ...folder(F.home, GROUP)))).toBe(false);
    expect(isErr(await asUser(db, luke, ...folder(F.mine, PERSONAL)))).toBe(false);
    expect(isErr(await asUser(db, wife, ...folder("f0000000-0000-0000-0000-000000000004", PERSONAL)))).toBe(true);
    expect(await asUser(db, wife, `select id from public.doc_folders where scope = $1`, [PERSONAL])).toEqual([]);
    expect(isErr(await asUser(db, luke, `update public.doc_folders set scope = $1 where id = $2`, [GROUP, F.mine]))).toBe(true);
  });

  it("files: right scope, folder in the same scope, size and parts checked", async () => {
    const id = "d0000000-0000-0000-0000-000000000001";
    expect(isErr(await asUser(db, wife, ...file(id, GROUP, F.home)))).toBe(false);
    expect(isErr(await asUser(db, luke, ...file("d0000000-0000-0000-0000-000000000002", PERSONAL, F.home)))).toBe(true); // folder in Household
    expect(isErr(await asUser(db, wife, ...file("d0000000-0000-0000-0000-000000000003", PERSONAL, null)))).toBe(true);
    expect(isErr(await asUser(db, luke, ...file("d0000000-0000-0000-0000-000000000004", GROUP, null, { size: 90_000_000 })))).toBe(true);
    expect(isErr(await asUser(db, luke, ...file("d0000000-0000-0000-0000-000000000005", GROUP, null, { parts: "{thumb}" })))).toBe(true);
    expect(isErr(await asUser(db, luke, ...file("d0000000-0000-0000-0000-000000000006", GROUP, null, { parts: "{content,html}" })))).toBe(true);
    expect(isErr(await asUser(db, luke, ...file("d0000000-0000-0000-0000-000000000007", GROUP, null, { enc_meta: "not base64!" })))).toBe(true);
    expect(isErr(await asUser(db, luke, ...file("d0000000-0000-0000-0000-000000000008", GROUP, F.rcpt, { parts: "{content,thumb,text}" })))).toBe(false);
  });

  it("updates bump updated_at; scope, id and author can't change; folder must stay in scope", async () => {
    const id = "d0000000-0000-0000-0000-000000000001";
    const before = (await asUser(db, luke, `select updated_at from public.doc_files where id = $1`, [id]))[0].updated_at;
    await db.exec("select pg_sleep(0.01)");
    expect(isErr(await asUser(db, luke, `update public.doc_files set enc_meta = $1 where id = $2`, [b64(200, "B"), id]))).toBe(false);
    const after = (await asUser(db, luke, `select updated_at from public.doc_files where id = $1`, [id]))[0].updated_at;
    expect(new Date(after) > new Date(before)).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_files set scope = $1 where id = $2`, [PERSONAL, id]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_files set added_by = $1 where id = $2`, [stranger, id]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_files set folder_id = $1 where id = $2`, [F.mine, id]))).toBe(true);
    expect(isErr(await asUser(db, luke, `update public.doc_files set deleted_at = now() where id = $1`, [id]))).toBe(false);
  });

  it("strangers, coworkers and anon see nothing and change nothing", async () => {
    for (const u of [stranger, coworker]) {
      expect(await asUser(db, u, `select id from public.doc_files`)).toEqual([]);
      expect(await asUser(db, u, `select id from public.doc_folders`)).toEqual([]);
      expect(await asUser(db, u, `delete from public.doc_files returning id`)).toEqual([]);
    }
    expect(isErr(await asUser(db, null, `select id from public.doc_files`))).toBe(true);
    expect(isErr(await asUser(db, null, `insert into public.doc_folders (id, scope, enc_name, key_version) values ('f0000000-0000-0000-0000-00000000000a', $1, $2, 1)`, [GROUP, b64(140)]))).toBe(true);
  });

  it("storage used: members get the total, others get nothing", async () => {
    expect(await asUser(db, wife, `select public.doc_usage($1)::int n`, [GROUP])).toEqual([{ n: 2000 }]);
    expect(await asUser(db, stranger, `select public.doc_usage($1) n`, [GROUP])).toEqual([{ n: null }]);
  });
});

describe("privileges", () => {
  it("anon has nothing; trigger functions aren't callable", async () => {
    const rows = await db.query(`select t, has_table_privilege('anon', 'public.' || t, 'select') a_sel, has_table_privilege('anon', 'public.' || t, 'insert') a_ins
      from unnest(array['doc_vaults','doc_device_boxes','doc_vault_grants','doc_vault_keys_old','doc_vault_settled','doc_recovery_keys','doc_recovery_wraps','doc_folders','doc_files']) t`);
    for (const r of rows.rows) { expect(r.a_sel).toBe(false); expect(r.a_ins).toBe(false); }
    const fns = await db.query(`select has_function_privilege('authenticated', 'public.doc_rows_guard()', 'execute') g, has_function_privilege('anon', 'public.doc_can_access(text)', 'execute') a`);
    expect(fns.rows[0]).toEqual({ g: false, a: false });
  });
  it("no TRUNCATE for signed-in users", async () => {
    const r = await db.query(`select bool_or(has_table_privilege('authenticated', 'public.' || t, 'truncate')) any from unnest(array['doc_files','doc_folders','doc_vaults']) t`);
    expect(r.rows[0].any).toBe(false);
  });
  it("the migration runs twice without error", async () => {
    const again = await createDocumentsDatabase();
    const { DOC_MIGRATIONS } = await import("./documents-pglite-harness.js");
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    await again.exec(readFileSync(fileURLToPath(new URL(`../migrations/${DOC_MIGRATIONS[0]}`, import.meta.url)), "utf8"));
  });
});
