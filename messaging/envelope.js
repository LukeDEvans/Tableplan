// The message envelope: what sits INSIDE the encryption (MESSAGING_DESIGN.md §5).
// Pure validation, no crypto. Everything a device decrypts goes through
// parseEnvelope before the app sees it, so a malformed or hostile payload from any
// device is rejected in one place.
//
// Shape only. WHO may send what is the caller's job, using the sender it learned
// from decryption (MESSAGING_DESIGN.md §5): `sync` only from the user's own certified
// devices; `control` only from current group members; `delete_for_everyone` only for
// the sender's own messages. A card `thumb` is a URL the sender chose — load it only
// through the app's image proxy or on tap, never automatically (it would tell the
// sender when and from where the card was read).

export const ENVELOPE_VERSION = 1;
export const TIMER_CHOICES = [3600, 86400, 604800, 2419200]; // 1 h, 1 day, 1 week, 4 weeks
export const DEFAULT_TIMER_SECS = 604800; // 1 week (Luke, 2026-10-30)
export const LIMITS = { text: 4000, name: 80, members: 32, readIds: 500, snapshotField: 200 };

const TYPES = new Set(["text", "card", "control", "receipt", "sync"]);
const CARD_KINDS = new Set(["recipe", "event", "trip", "shop"]);
const CONTROL_OPS = new Set([
  "group_create", "group_rename", "member_add", "member_remove", "member_leave",
  "timer_set", "delete_for_everyone", "reset_session",
]);
const SYNC_KINDS = new Set(["sent", "verified", "read", "conv"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function fail(msg) {
  throw new Error(`envelope: ${msg}`);
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const id = (v, what) => (typeof v === "string" && ID_RE.test(v) ? v : fail(`bad ${what}`));
const str = (v, max, what) => (typeof v === "string" && v.length <= max ? v : fail(`bad ${what}`));
const optStr = (v, max, what) => (v === undefined || v === null ? null : str(v, max, what));

function idList(v, max, what) {
  if (!Array.isArray(v) || v.length > max) fail(`bad ${what}`);
  const out = v.map((x) => id(x, what));
  if (new Set(out).size !== out.length) fail(`duplicate ${what}`);
  return out;
}

function timer(v) {
  if (v === null) return null;
  if (TIMER_CHOICES.includes(v)) return v;
  return fail("bad timer");
}

function parseBody(type, b) {
  if (!isObj(b)) fail("missing body");
  switch (type) {
    case "text": {
      const text = str(b.text, LIMITS.text, "text");
      if (!text.trim()) fail("empty text");
      return { text };
    }
    case "card": {
      if (!CARD_KINDS.has(b.kind)) fail("bad card kind");
      if (!isObj(b.snapshot)) fail("missing card snapshot");
      const s = b.snapshot;
      const thumb = optStr(s.thumb, 2000, "card thumb");
      if (thumb && !/^https:\/\//.test(thumb)) fail("card thumb must be https");
      return {
        kind: b.kind,
        ref: id(b.ref, "card ref"),
        snapshot: {
          title: str(s.title, LIMITS.snapshotField, "card title"),
          subtitle: optStr(s.subtitle, LIMITS.snapshotField, "card subtitle"),
          date: optStr(s.date, 40, "card date"),
          thumb,
        },
      };
    }
    case "control": {
      if (!CONTROL_OPS.has(b.op)) fail("bad control op");
      switch (b.op) {
        case "group_create":
          return { op: b.op, name: optStr(b.name, LIMITS.name, "group name"), members: idList(b.members, LIMITS.members, "member") };
        case "group_rename":
          return { op: b.op, name: optStr(b.name, LIMITS.name, "group name") };
        case "member_add":
        case "member_remove":
          return { op: b.op, members: idList(b.members, LIMITS.members, "member") };
        case "timer_set":
          return { op: b.op, secs: timer(b.secs) };
        case "delete_for_everyone":
          return { op: b.op, target: id(b.target, "target message") };
        default:
          return { op: b.op };
      }
    }
    case "receipt":
      return { read: idList(b.read, LIMITS.readIds, "read id") };
    case "sync": {
      if (!SYNC_KINDS.has(b.kind)) fail("bad sync kind");
      if (b.kind === "sent") return { kind: "sent", envelope: parseEnvelope(b.envelope, { nested: true }) };
      if (b.kind === "verified") return { kind: "verified", userId: id(b.userId, "user"), verified: b.verified === true };
      if (b.kind === "conv") {
        // A conversation's current shape, for my newly linked device (no history; §0, 2).
        return { kind: "conv", conv: id(b.conv, "conversation"), name: optStr(b.name, LIMITS.name, "group name"), members: idList(b.members, LIMITS.members + 1, "member"), secs: timer(b.secs ?? null) };
      }
      return { kind: "read", conv: id(b.conv, "conversation"), upTo: id(b.upTo, "message") };
    }
    default:
      return fail("bad type");
  }
}

export function parseEnvelope(e, { nested = false } = {}) {
  if (!isObj(e)) fail("not an object");
  if (e.v !== ENVELOPE_VERSION) fail("unsupported version");
  if (!TYPES.has(e.type)) fail("bad type");
  if (nested && e.type === "sync") fail("nested sync");
  const sentAt = str(e.sentAt, 40, "sentAt");
  if (!ISO_RE.test(sentAt) || Number.isNaN(Date.parse(sentAt))) fail("bad sentAt");
  return {
    v: ENVELOPE_VERSION,
    type: e.type,
    conv: id(e.conv, "conversation"),
    id: id(e.id, "message id"),
    sentAt,
    expireSecs: e.expireSecs === undefined ? null : timer(e.expireSecs),
    body: parseBody(e.type, e.body),
  };
}
