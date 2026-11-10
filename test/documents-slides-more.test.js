// Slides: templates, animation steps, video links, the TV messages and the remote.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSlidesModel, fragmentText } from "../documents/slides/model.js";
import { buildTemplate, TEMPLATES } from "../documents/slides/templates.js";
import { buildSteps } from "../documents/slides/anim.js";
import { parseVideoLink, embedUrl } from "../documents/slides/av.js";
import { toB64, fromB64, chunkJoiner, CHUNK, decode } from "../documents/slides/tv-protocol.js";
import { remoteFollower, presentersIn } from "../documents/slides/remote.js";

describe("templates", () => {
  for (const t of TEMPLATES) {
    it(`${t.name} builds in its theme`, () => {
      const m = createSlidesModel(new Y.Doc());
      buildTemplate(m, t.id);
      expect(m.theme().id).toBe(t.theme);
      expect(m.slideIds().length).toBeGreaterThan(0);
      if (t.id !== "blank") {
        const s = m.slideIds()[0];
        const title = m.items(s).find((i) => i.role === "title");
        expect(fragmentText(m.text(s, title.id)).length).toBeGreaterThan(0);
      }
      for (const sid of m.slideIds()) for (const it of m.items(sid)) {
        const [W, H] = m.size();
        expect(it.x >= 0 && it.y >= 0 && it.x + it.w <= W + 1 && it.y + it.h <= H + 1).toBe(true);
      }
    });
  }
});

describe("animation steps", () => {
  it("groups by click; with and after start at the right times", () => {
    const anims = [
      { item: "a", effect: "fade-in", start: "with", ms: 400, delay: 0 },
      { item: "b", effect: "fly-in", start: "click", ms: 500, delay: 0 },
      { item: "c", effect: "fade-in", start: "with", ms: 300, delay: 100 },
      { item: "d", effect: "zoom-in", start: "after", ms: 200, delay: 0 },
      { item: "b", effect: "spin", start: "click", ms: 600, delay: 0 },
    ];
    const { steps, hidden } = buildSteps(anims);
    expect(steps).toHaveLength(3);
    expect(steps[0].map((s) => s.anim.item)).toEqual(["a"]);
    expect(steps[1].map((s) => [s.anim.item, s.at])).toEqual([["b", 0], ["c", 100], ["d", 400]]);
    expect([...hidden].sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("an item whose first animation is an exit starts visible", () => {
    expect(buildSteps([{ item: "x", effect: "fade-out", start: "click", ms: 1 }]).hidden.size).toBe(0);
  });
});

describe("video links", () => {
  it("reads YouTube, Vimeo and file links", () => {
    expect(parseVideoLink("https://youtu.be/dQw4w9WgXcQ?t=42")).toMatchObject({ kind: "youtube", id: "dQw4w9WgXcQ", start: 42 });
    expect(parseVideoLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m5s").start).toBe(65);
    expect(parseVideoLink("https://www.youtube.com/shorts/dQw4w9WgXcQ").id).toBe("dQw4w9WgXcQ");
    expect(parseVideoLink("https://vimeo.com/123456789")).toMatchObject({ kind: "vimeo", id: "123456789" });
    expect(parseVideoLink("https://example.com/clip.mp4").kind).toBe("file");
    expect(parseVideoLink("http://youtu.be/dQw4w9WgXcQ")).toBeNull();
    expect(parseVideoLink("javascript:alert(1)")).toBeNull();
    expect(parseVideoLink("https://youtube.com/watch?v=<script>")).toBeNull();
  });
  it("makes embed addresses", () => {
    const u = new URL(embedUrl("https://youtu.be/dQw4w9WgXcQ", { autoplay: true, loop: true, start: 10 }));
    expect(u.hostname).toBe("www.youtube-nocookie.com");
    expect(u.searchParams.get("autoplay")).toBe("1");
    expect(u.searchParams.get("playlist")).toBe("dQw4w9WgXcQ");
    expect(u.searchParams.get("start")).toBe("10");
  });
});

describe("the TV messages", () => {
  it("round-trips bytes and joins chunked media", () => {
    const bytes = new Uint8Array(CHUNK * 2 + 77).map((_, i) => i % 251);
    expect(fromB64(toB64(bytes))).toEqual(bytes);
    const j = chunkJoiner();
    const id = "0123456789abcdef0123456789abcdef";
    const n = 3;
    let out = null;
    for (const i of [2, 0, 1]) out = j.add({ id, i, n, d: toB64(bytes.subarray(i * CHUNK, (i + 1) * CHUNK)) }) || out;
    expect(out.bytes).toEqual(bytes);
  });
  it("refuses bad chunks and bad messages", () => {
    const j = chunkJoiner(CHUNK * 2);
    expect(j.add({ id: "nope", i: 0, n: 1, d: "" })).toBeNull();
    expect(j.add({ id: "0123456789abcdef0123456789abcdef", i: 0, n: 99, d: "" })).toBeNull();
    expect(decode("not json")).toBeNull();
    expect(decode('{"x":1}')).toBeNull();
  });
});

describe("the remote", () => {
  function fakeAwareness(me) {
    const states = new Map();
    return { clientID: me, getStates: () => states, states };
  }
  it("turns a phone's Next and Back counts into presses, including quick taps", () => {
    const aw = fakeAwareness(1);
    const did = [];
    const follow = remoteFollower(aw, { next: () => did.push("n"), prev: () => did.push("p"), go: (i) => did.push(`g${i}`), black: () => did.push("b"), end: () => did.push("e") });
    aw.states.set(2, { remote: { to: 1, next: 0, prev: 0 } });
    follow();
    expect(did).toEqual([]);
    aw.states.set(2, { remote: { to: 1, next: 3, prev: 0 } }); // three taps arrived in one update
    follow();
    aw.states.set(2, { remote: { to: 1, next: 3, prev: 1, black: 1 } });
    follow();
    expect(did).toEqual(["n", "n", "n", "p", "b"]);
    aw.states.set(3, { remote: { to: 99, next: 5 } }); // meant for someone else
    follow(); follow();
    expect(did).toHaveLength(5);
  });
  it("lists who is presenting", () => {
    const aw = fakeAwareness(1);
    aw.states.set(2, { user: { name: "Luke" }, show: { slide: "s1", step: 0, ended: false, n: 0, of: 5 } });
    aw.states.set(3, { user: { name: "M" }, show: null });
    expect(presentersIn(aw).map((p) => p.name)).toEqual(["Luke"]);
  });
});
