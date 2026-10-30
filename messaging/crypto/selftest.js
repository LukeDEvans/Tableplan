// A self-test of the crypto core that runs wherever the app runs — Chrome, the
// laptop app, and the iPhone's web view — so "it works in every environment" is
// checked, not assumed (MESSAGING_DESIGN.md §4). Used by scripts/qa-messaging-crypto.mjs
// in headless Chromium, and later from Settings → Messaging on the phone.

import { loadSodium } from "./sodium.js";
import { hkdf } from "./kdf.js";
import { fromHex, toHex, utf8, fromUtf8 } from "./bytes.js";
import { generateDevice, generateSignedPrekey, generateOneTimePrekeys, generateIdentity, certifyDevice, verifyDeviceCert, safetyNumber } from "./keys.js";
import { startSession, encryptToDevice, decryptFromDevice } from "./session.js";

export async function runCryptoSelfTest() {
  const started = Date.now();
  const checks = [];
  const check = (name, fn) => {
    try {
      const ok = fn();
      checks.push({ name, ok: ok !== false });
    } catch (e) {
      checks.push({ name, ok: false, error: String(e && e.message || e) });
    }
  };

  await loadSodium();

  check("HKDF matches RFC 5869 case 1", () =>
    toHex(hkdf(fromHex("000102030405060708090a0b0c"), new Uint8Array(22).fill(0x0b), fromHex("f0f1f2f3f4f5f6f7f8f9"), 42))
      === "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865");

  const id = generateIdentity();
  const a = generateDevice();
  const b = generateDevice();
  const cert = { userId: "self-test", deviceId: "d1", kind: "phone", signPub: a.signPub, dhPub: a.dhPub, createdAt: 0 };
  check("device certificate verifies", () => verifyDeviceCert(id.signPub, cert, certifyDevice(id, cert)));
  check("safety number is 60 digits", () => /^\d{60}$/.test(safetyNumber({ userId: "x", signPub: id.signPub }, { userId: "y", signPub: generateIdentity().signPub })));

  const spk = generateSignedPrekey(b, 1);
  const [opk] = generateOneTimePrekeys(1, 1);
  const prekeysB = { signed: (i) => (i === 1 ? spk : null), oneTime: (i) => (i === opk.id ? opk : null) };
  let recA = startSession(undefined, { me: a, them: b, bundle: { spk: { id: 1, pub: spk.pub, sig: spk.sig }, opk: { id: opk.id, pub: opk.pub } } });
  let recB;
  const sendA = (t) => { const r = encryptToDevice(recA, utf8(t)); recA = r.record; return r.wire; };
  const sendB = (t) => { const r = encryptToDevice(recB, utf8(t)); recB = r.record; return r.wire; };
  const recvB = (w) => { const r = decryptFromDevice(recB, { me: b, them: a, wire: w, prekeys: prekeysB }); recB = r.record; return fromUtf8(r.plaintext); };
  const recvA = (w) => { const r = decryptFromDevice(recA, { me: a, them: b, wire: w, prekeys: prekeysB }); recA = r.record; return fromUtf8(r.plaintext); };

  check("first message decrypts", () => recvB(sendA("hello")) === "hello");
  check("reply decrypts", () => recvA(sendB("hi back")) === "hi back");
  check("out-of-order messages decrypt", () => {
    const w1 = sendA("one"); const w2 = sendA("two"); const w3 = sendA("three");
    return recvB(w3) === "three" && recvB(w1) === "one" && recvB(w2) === "two";
  });
  check("replay is rejected", () => {
    const w = sendA("once");
    recvB(w);
    try { recvB(w); return false; } catch { return true; }
  });
  check("tampering is rejected", () => {
    const w = sendB("intact");
    const bad = w.slice(); bad[bad.length - 1] ^= 1;
    try { recvA(bad); return false; } catch { return recvA(w) === "intact"; }
  });
  check("100 alternating messages", () => {
    for (let i = 0; i < 50; i++) {
      if (recvB(sendA(`a${i}`)) !== `a${i}`) return false;
      if (recvA(sendB(`b${i}`)) !== `b${i}`) return false;
    }
    return true;
  });

  return { ok: checks.every((c) => c.ok), checks, ms: Date.now() - started };
}
