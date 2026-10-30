// X3DH + Double Ratchet + session records, end to end between simulated devices.
// Includes seeded property tests: random interleavings, reordering, loss and
// simultaneous sends across many ratchet steps.

import { describe, it, expect, beforeAll } from "vitest";
import { loadSodium } from "../messaging/crypto/sodium.js";
import { generateDevice, generateSignedPrekey, generateOneTimePrekeys, generateIdentity } from "../messaging/crypto/keys.js";
import { utf8, fromUtf8 } from "../messaging/crypto/bytes.js";
import { emptyRecord, startSession, encryptToDevice, decryptFromDevice, parseWire, MAX_SESSIONS } from "../messaging/crypto/session.js";
import { x3dhInitiate, x3dhRespond } from "../messaging/crypto/x3dh.js";
import { MAX_SKIP } from "../messaging/crypto/ratchet.js";

beforeAll(async () => { await loadSodium(); });

// A simulated device: keys, a prekey store, and one session record per peer.
function makeDevice(name) {
  const keys = generateDevice();
  const spk = generateSignedPrekey(keys, 1);
  const opks = new Map(generateOneTimePrekeys(1, 10).map((k) => [k.id, k]));
  return {
    name, keys, spk, opks, records: new Map(),
    pub() { return { signPub: keys.signPub, dhPub: keys.dhPub }; },
    bundle(useOpk = true) {
      const first = useOpk ? [...opks.values()][0] : null;
      return { spk: { id: spk.id, pub: spk.pub, sig: spk.sig }, opk: first ? { id: first.id, pub: first.pub } : null };
    },
    prekeys() {
      return { signed: (id) => (id === spk.id ? spk : null), oneTime: (id) => opks.get(id) || null };
    },
  };
}

function start(from, to, useOpk = true) {
  from.records.set(to.name, startSession(from.records.get(to.name), { me: from.keys, them: to.pub(), bundle: to.bundle(useOpk) }));
}

function send(from, to, text) {
  const { record, wire } = encryptToDevice(from.records.get(to.name), utf8(text));
  from.records.set(to.name, record);
  return wire;
}

function receive(at, from, wire, now) {
  const r = decryptFromDevice(at.records.get(from.name), { me: at.keys, them: from.pub(), wire, prekeys: at.prekeys(), now });
  at.records.set(from.name, r.record);
  if (r.usedOneTimePrekeyId !== null) at.opks.delete(r.usedOneTimePrekeyId);
  return fromUtf8(r.plaintext);
}

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("X3DH", () => {
  it("both sides derive the same secret and AD, with and without a one-time prekey", () => {
    for (const withOpk of [true, false]) {
      const a = makeDevice("a");
      const b = makeDevice("b");
      const bundle = b.bundle(withOpk);
      const x = x3dhInitiate({ me: a.keys, them: b.pub(), spk: bundle.spk, opk: bundle.opk });
      const y = x3dhRespond({ me: b.keys, initiator: a.pub(), spk: b.spk, opk: withOpk ? b.opks.get(bundle.opk.id) : null, ephemeralPub: x.ephemeralPub });
      expect(x.sk).toEqual(y.sk);
      expect(x.ad).toEqual(y.ad);
    }
  });

  it("refuses a signed prekey not signed by the device", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    const mallory = generateDevice();
    const fake = generateSignedPrekey(mallory, 1);
    expect(() => x3dhInitiate({ me: a.keys, them: b.pub(), spk: { id: 1, pub: fake.pub, sig: fake.sig } })).toThrow(/signature/);
  });
});

describe("sessions", () => {
  it("a conversation in both directions", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    expect(receive(b, a, send(a, b, "hi"))).toBe("hi");
    expect(receive(a, b, send(b, a, "hey"))).toBe("hey");
    for (let i = 0; i < 5; i++) {
      expect(receive(b, a, send(a, b, `a${i}`))).toBe(`a${i}`);
      expect(receive(a, b, send(b, a, `b${i}`))).toBe(`b${i}`);
    }
  });

  it("works without a one-time prekey (all used up)", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b, false);
    expect(parseWire(send(a, b, "x")).opkId).toBe(null);
    a.records.delete("b");
    start(a, b, false);
    expect(receive(b, a, send(a, b, "no opk"))).toBe("no opk");
  });

  it("keeps sending prekey messages until it hears back, and the responder accepts them all", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    const w1 = send(a, b, "1");
    const w2 = send(a, b, "2");
    expect(parseWire(w1).type).toBe("prekey");
    expect(parseWire(w2).type).toBe("prekey");
    expect(receive(b, a, w2)).toBe("2"); // arrives first
    expect(receive(b, a, w1)).toBe("1");
    expect(b.opks.size).toBe(9); // one-time prekey consumed once
    receive(a, b, send(b, a, "back"));
    expect(parseWire(send(a, b, "3")).type).toBe("normal");
  });

  it("uses a one-time prekey only once", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    const bundle = b.bundle(true);
    start(a, b);
    receive(b, a, send(a, b, "first"));
    const c = makeDevice("c");
    c.records.set("b", startSession(undefined, { me: c.keys, them: b.pub(), bundle })); // stale bundle, same opk
    expect(() => receive(b, c, send(c, b, "replayed opk"))).toThrow(/one-time prekey/);
  });

  it("rejects duplicates (replays)", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    receive(b, a, send(a, b, "x"));
    receive(a, b, send(b, a, "y"));
    const w = send(a, b, "once");
    expect(receive(b, a, w)).toBe("once");
    expect(() => receive(b, a, w)).toThrow();
  });

  it("rejects a replay of a message that arrived out of order (its skipped key is used once)", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    receive(b, a, send(a, b, "x"));
    receive(a, b, send(b, a, "y"));
    const early = send(a, b, "early");
    receive(b, a, send(a, b, "overtakes it"));
    expect(receive(b, a, early)).toBe("early");
    expect(() => receive(b, a, early)).toThrow();
  });

  it("rejects tampering without changing the stored record", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    receive(b, a, send(a, b, "x"));
    receive(a, b, send(b, a, "y"));
    const w = send(a, b, "secret");
    const before = JSON.stringify(b.records.get("a"));
    for (const at of [3, 10, 30, 41, w.length - 1]) {
      const bad = w.slice();
      bad[at] ^= 1;
      expect(() => receive(b, a, bad)).toThrow();
      expect(JSON.stringify(b.records.get("a"))).toBe(before);
    }
    expect(receive(b, a, w)).toBe("secret");
  });

  it("rejects a prekey message whose identity key isn't the sender's certified key", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    const imposter = makeDevice("imposter");
    start(imposter, b);
    const w = send(imposter, b, "pretending to be a");
    expect(() => receive(b, a, w)).toThrow(/identity key/);
  });

  it("cannot be read by another device of the same person", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    const b2 = makeDevice("b2");
    start(a, b);
    const w = send(a, b, "for b only");
    expect(() => receive(b2, a, w)).toThrow();
  });

  it("gives up on a gap larger than MAX_SKIP", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    receive(b, a, send(a, b, "x"));
    receive(a, b, send(b, a, "y"));
    for (let i = 0; i < MAX_SKIP + 1; i++) send(a, b, "lost");
    expect(() => receive(b, a, send(a, b, "too far"))).toThrow(/skipped/);
  });

  it("drops skipped keys after their time limit", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    receive(b, a, send(a, b, "x"), 0);
    receive(a, b, send(b, a, "y"), 0);
    const late = send(a, b, "late");
    receive(b, a, send(a, b, "next"), 1000);
    receive(b, a, send(a, b, "much later"), 1000 + 8 * 24 * 3600 * 1000);
    expect(() => receive(b, a, late, 1000 + 8 * 24 * 3600 * 1000)).toThrow();
  });

  it("recovers when both sides start a session at the same time", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    start(b, a);
    const wa = send(a, b, "from a");
    const wb = send(b, a, "from b");
    expect(receive(b, a, wa)).toBe("from a");
    expect(receive(a, b, wb)).toBe("from b");
    for (let i = 0; i < 4; i++) {
      expect(receive(b, a, send(a, b, `a${i}`))).toBe(`a${i}`);
      expect(receive(a, b, send(b, a, `b${i}`))).toBe(`b${i}`);
    }
  });

  it("recovers after one side loses its record (cleared browser data), via a new session", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    receive(b, a, send(a, b, "x"));
    receive(a, b, send(b, a, "y"));
    b.records.delete("a"); // b lost everything about a
    expect(() => receive(b, a, send(a, b, "lost"))).toThrow();
    start(a, b); // a is told to reset and starts over
    expect(receive(b, a, send(a, b, "fresh"))).toBe("fresh");
    expect(receive(a, b, send(b, a, "and back"))).toBe("and back");
  });

  it("keeps at most MAX_SESSIONS sessions per device", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    for (let i = 0; i < MAX_SESSIONS + 3; i++) start(a, b, false);
    expect(a.records.get("b").sessions.length).toBe(MAX_SESSIONS);
  });

  it("doesn't mutate the record passed in", () => {
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    const rec = a.records.get("b");
    const snapshot = JSON.stringify(rec);
    encryptToDevice(rec, utf8("x"));
    expect(JSON.stringify(rec)).toBe(snapshot);
  });

  it("refuses to send without a session, and rejects garbage", () => {
    const b = makeDevice("b");
    const a = makeDevice("a");
    expect(() => encryptToDevice(emptyRecord(), utf8("x"))).toThrow();
    for (const junk of [new Uint8Array(0), Uint8Array.of(2, 1), Uint8Array.of(1, 9), Uint8Array.of(1, 1, 0)]) {
      expect(() => receive(b, a, junk)).toThrow();
    }
  });
});

describe("property: random interleaving, reordering and loss", () => {
  for (const seed of [1, 2, 3, 42, 99, 2026, 31337, 777]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const a = makeDevice("a");
      const b = makeDevice("b");
      start(a, b);
      if (r() < 0.3) start(b, a); // sometimes both start at once
      const inFlight = { a: [], b: [] }; // messages waiting for delivery TO a / TO b
      const sent = { a: 0, b: 0 };
      let delivered = 0;
      for (let step = 0; step < 300; step++) {
        const x = r();
        if (x < 0.35) {
          const t = `a->b ${sent.a++}`;
          inFlight.b.push({ w: send(a, b, t), t });
        } else if (x < 0.7) {
          if (!b.records.get("a")) start(b, a); // like the app: start a session before a first send
          const t = `b->a ${sent.b++}`;
          inFlight.a.push({ w: send(b, a, t), t });
        } else {
          const to = r() < 0.5 ? "a" : "b";
          const q = inFlight[to];
          if (!q.length) continue;
          const i = Math.floor(r() * q.length); // deliver any pending one: reordering
          const [m] = q.splice(i, 1);
          if (r() < 0.05) continue; // lost
          const [at, from] = to === "a" ? [a, b] : [b, a];
          expect(receive(at, from, m.w)).toBe(m.t);
          delivered++;
        }
      }
      // Drain: everything still in flight must decrypt, in any order.
      for (const to of ["a", "b"]) {
        const [at, from] = to === "a" ? [a, b] : [b, a];
        for (const m of inFlight[to].reverse()) expect(receive(at, from, m.w)).toBe(m.t);
      }
      expect(delivered).toBeGreaterThan(20);
    });
  }
});

describe("identity separation", () => {
  it("sessions don't depend on the person's primary identity key (device keys only)", () => {
    generateIdentity();
    const a = makeDevice("a");
    const b = makeDevice("b");
    start(a, b);
    expect(receive(b, a, send(a, b, "ok"))).toBe("ok");
  });
});
