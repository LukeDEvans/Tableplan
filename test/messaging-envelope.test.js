// The envelope inside the encryption, and sealing/opening it through the public API.

import { describe, it, expect, beforeAll } from "vitest";
import { parseEnvelope, DEFAULT_TIMER_SECS, LIMITS } from "../messaging/envelope.js";
import {
  loadSodium, generateDevice, generateIdentity, generateSignedPrekey, startSession, sealEnvelope, openEnvelope, emptyRecord,
} from "../messaging/crypto/index.js";
import { generateOneTimePrekeys } from "../messaging/crypto/keys.js";
import { encryptToDevice } from "../messaging/crypto/session.js";
import { pad } from "../messaging/crypto/padding.js";
import { utf8 } from "../messaging/crypto/bytes.js";

beforeAll(async () => { await loadSodium(); });

const base = (type, body, extra = {}) => ({ v: 1, type, conv: "conv-1", id: "msg-1", sentAt: "2026-10-30T14:00:00.000Z", expireSecs: DEFAULT_TIMER_SECS, body, ...extra });

describe("parseEnvelope", () => {
  it("accepts every message type", () => {
    expect(parseEnvelope(base("text", { text: "Can you grab milk?" })).body.text).toBe("Can you grab milk?");
    const card = parseEnvelope(base("card", { kind: "recipe", ref: "r_123", snapshot: { title: "Lentil soup", thumb: "https://example.com/x.jpg" } }));
    expect(card.body).toEqual({ kind: "recipe", ref: "r_123", snapshot: { title: "Lentil soup", subtitle: null, date: null, thumb: "https://example.com/x.jpg" } });
    expect(parseEnvelope(base("control", { op: "group_create", name: "Household", members: ["luke", "marijane"] })).body.members).toEqual(["luke", "marijane"]);
    expect(parseEnvelope(base("control", { op: "timer_set", secs: null })).body.secs).toBe(null);
    expect(parseEnvelope(base("control", { op: "member_leave" })).body).toEqual({ op: "member_leave" });
    expect(parseEnvelope(base("control", { op: "delete_for_everyone", target: "msg-0" })).body.target).toBe("msg-0");
    expect(parseEnvelope(base("receipt", { read: ["m1", "m2"] })).body.read).toEqual(["m1", "m2"]);
    const sync = parseEnvelope(base("sync", { kind: "sent", envelope: base("text", { text: "copy" }) }));
    expect(sync.body.envelope.body.text).toBe("copy");
    expect(parseEnvelope(base("text", { text: "x" }, { expireSecs: undefined })).expireSecs).toBe(null);
  });

  it("drops unknown fields", () => {
    const e = parseEnvelope({ ...base("text", { text: "x", html: "<b>" }), extra: 1 });
    expect(e).not.toHaveProperty("extra");
    expect(e.body).not.toHaveProperty("html");
  });

  it("rejects malformed or hostile envelopes", () => {
    const bad = [
      null, [], "x",
      { ...base("text", { text: "x" }), v: 2 },
      base("photo", { url: "x" }),
      base("text", { text: "   " }),
      base("text", { text: "x".repeat(LIMITS.text + 1) }),
      base("text", { text: "x" }, { conv: "../etc" }),
      base("text", { text: "x" }, { sentAt: "yesterday" }),
      base("text", { text: "x" }, { sentAt: "Oct 30 2026" }),
      base("text", { text: "x" }, { sentAt: "2026-10-30T14:00:00+05:00" }),
      base("text", { text: "x" }, { expireSecs: 5 }),
      base("card", { kind: "secret", ref: "r", snapshot: { title: "t" } }),
      base("card", { kind: "recipe", ref: "r", snapshot: { title: "t", thumb: "javascript:alert(1)" } }),
      base("card", { kind: "recipe", ref: "r" }),
      base("control", { op: "make_admin" }),
      base("control", { op: "member_add", members: ["a", "a"] }),
      base("control", { op: "member_add", members: Array.from({ length: LIMITS.members + 1 }, (_, i) => `u${i}`) }),
      base("control", { op: "timer_set", secs: 123 }),
      base("receipt", { read: "m1" }),
      base("sync", { kind: "sent", envelope: base("sync", { kind: "read", conv: "c", upTo: "m" }) }),
      base("sync", { kind: "export_keys" }),
    ];
    for (const e of bad) expect(() => parseEnvelope(e)).toThrow(/envelope/);
  });
});

describe("sealEnvelope / openEnvelope", () => {
  function pair() {
    const ia = generateIdentity();
    const ib = generateIdentity();
    const a = generateDevice();
    const b = generateDevice();
    const da = { userId: "luke", deviceId: "a", identitySignPub: ia.signPub, signPub: a.signPub, dhPub: a.dhPub };
    const db = { userId: "marijane", deviceId: "b", identitySignPub: ib.signPub, signPub: b.signPub, dhPub: b.dhPub };
    const spk = generateSignedPrekey(b, 1);
    const [opk] = generateOneTimePrekeys(1, 1);
    const rec = startSession(emptyRecord(), { me: { ...da, dhPriv: a.dhPriv }, them: db, bundle: { spk: { id: 1, pub: spk.pub, sig: spk.sig, createdAt: spk.createdAt }, opk: { id: opk.id, pub: opk.pub } } });
    const open = (wire) => openEnvelope(emptyRecord(), {
      me: { ...db, dhPriv: b.dhPriv }, them: da, wire,
      prekeys: { signed: (id) => (id === 1 ? spk : null), oneTime: (id) => (id === opk.id ? opk : null), seen: () => false },
    });
    return { rec, open, opk };
  }

  it("round-trips an envelope between devices and validates both ends", () => {
    const { rec, open, opk } = pair();
    const sealed = sealEnvelope(rec, base("text", { text: "hello", junk: true }));
    const opened = open(sealed.wire);
    expect(opened.envelope.body).toEqual({ text: "hello" });
    expect(opened.error).toBe(null);
    expect(opened.usedOneTimePrekeyId).toBe(opk.id);
    expect(opened.newPrekeyMessage).toMatchObject({ spkId: 1 });
    expect(() => sealEnvelope(sealed.record, base("text", { text: "" }))).toThrow(/envelope/);
  });

  it("returns the advanced record with no envelope when a decrypted payload is invalid", () => {
    const { rec, open } = pair();
    // A buggy or hostile sender skips sealEnvelope's checks:
    const raw = encryptToDevice(rec, pad(utf8(JSON.stringify(base("text", { text: "   " })))));
    const opened = open(raw.wire);
    expect(opened.envelope).toBe(null);
    expect(opened.error).toMatch(/envelope/);
    expect(opened.record.sessions.length).toBe(1); // store it: that message key is now spent
  });
});
