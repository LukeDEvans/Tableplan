// Live co-editing over a channel (WORD_PROCESSOR_DESIGN.md §4), with a fake bus in
// place of Supabase Realtime: two people converge, late joiners catch up, the Safe's
// encryption hooks carry only ciphertext, and nothing is sent while alone.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { connectLive, memoryBus } from "../documents/editor/live.js";

const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const text = (d) => d.getText("t").toString();

function person(bus, name, opts = {}) {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const sent = [];
  const open = (h) => { const ch = bus.open(h); return { ...ch, send: (m) => { sent.push(m); ch.send(m); } }; };
  const live = connectLive({ ydoc, awareness, open, me: { id: name, name, color: "#000" }, ...opts });
  return { ydoc, awareness, live, sent };
}

describe("live co-editing", () => {
  it("two people converge, including what each typed before the other joined", async () => {
    const bus = memoryBus();
    const a = person(bus, "a");
    a.ydoc.getText("t").insert(0, "Hello");
    await tick();
    expect(a.sent.length).toBe(0); // alone: nothing sent
    const b = person(bus, "b");
    b.ydoc.getText("t").insert(0, "B: ");
    await tick(50);
    expect(text(a.ydoc)).toBe(text(b.ydoc));
    expect(text(a.ydoc)).toContain("Hello");
    a.ydoc.getText("t").insert(text(a.ydoc).length, " world");
    await tick(400);
    expect(text(b.ydoc)).toBe(text(a.ydoc));
    expect(text(b.ydoc)).toContain("world");
    a.live.close(); b.live.close();
  });

  it("cursors (awareness) reach the other person and leave with them", async () => {
    const bus = memoryBus();
    const a = person(bus, "a");
    const b = person(bus, "b");
    await tick(30);
    a.awareness.setLocalStateField("user", { name: "A" });
    await tick(300);
    expect(b.awareness.getStates().get(a.ydoc.clientID)?.user?.name).toBe("A");
    a.live.close();
    await tick(30);
    expect(b.awareness.getStates().has(a.ydoc.clientID)).toBe(false);
    b.live.close();
  });

  it("with encryption hooks only ciphertext travels, and tampered messages are dropped", async () => {
    const bus = memoryBus();
    const key = 0x5a;
    const xor = async (u8) => u8.map((x) => x ^ key);
    const strict = async (u8) => { if (u8[0] === 0xff) throw new Error("bad"); return u8.map((x) => x ^ key); };
    const a = person(bus, "a", { encrypt: xor, decrypt: strict });
    const b = person(bus, "b", { encrypt: xor, decrypt: strict });
    a.ydoc.getText("t").insert(0, "secret words");
    await tick(400);
    expect(text(b.ydoc)).toBe("secret words");
    const raw = a.sent.map((m) => atob(m.d || "")).join("");
    expect(raw).not.toContain("secret");
    a.live.close(); b.live.close();
  });

  it("a large update arrives in pieces", async () => {
    const bus = memoryBus();
    const a = person(bus, "a");
    a.ydoc.getText("t").insert(0, "x".repeat(400_000));
    const b = person(bus, "b");
    await tick(100);
    expect(text(b.ydoc).length).toBe(400_000);
    expect(a.sent.some((m) => m.t === "part")).toBe(true);
    a.live.close(); b.live.close();
  });
});
