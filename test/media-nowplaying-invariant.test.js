// Invariants the Now-Playing-bar TTS fix relies on: the bar now reads
// mediaEngine.state() (logical, cross-segment) instead of the raw element's
// currentTime. These pin the guarantees for BOTH single-segment media
// (podcast/music/radio — must be byte-identical to element values) and
// multi-segment TTS (must span the whole article).
import { describe, it, expect, vi } from "vitest";
import { createPlaybackEngine } from "../playback-engine.js";

function makeFakeAudio() {
  const a = {
    src: "", currentTime: 0, duration: NaN, paused: true, ended: false, readyState: 0, playbackRate: 1,
    load: vi.fn(function () { this.readyState = 0; }),
    play: vi.fn(function () { this.paused = false; this.ended = false; this.onplay && this.onplay(); return Promise.resolve(); }),
    pause: vi.fn(function () { this.paused = true; this.onpause && this.onpause(); }),
  };
  a._loadMeta = (dur) => { a.duration = dur; a.readyState = 1; a.onloadedmetadata && a.onloadedmetadata(); };
  a._end = () => { a.ended = true; a.paused = true; a.onended && a.onended(); };
  a._tick = (t) => { a.currentTime = t; a.ontimeupdate && a.ontimeupdate(); };
  return a;
}
const engineWith = (a) => createPlaybackEngine({ createAudio: () => a });
// A loaded 3-chunk TTS source; returns { a, eng } (NOT the load snapshot).
function tts3() {
  const a = makeFakeAudio();
  const eng = engineWith(a);
  eng.load({ id: "art", providerId: "tts", segments: [
    { url: "c0", duration: 10 }, { url: "c1", duration: 20 }, { url: "c2", duration: 30 },
  ] });
  return { a, eng };
}

describe("single-segment (podcast/music/radio) — state() equals the element", () => {
  it("position === element.currentTime and duration === element.duration", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "ep", providerId: "podcast", segments: [{ url: "u" }] });
    a._loadMeta(120);
    a._tick(37);
    expect(eng.state().position).toBe(a.currentTime);   // the exact requirement
    expect(eng.state().duration).toBe(a.duration);
    expect(eng.state().providerId).toBe("podcast");     // guard identifies the active kind
  });
  it("live radio (non-finite duration) → engine duration 0, position tracks the element", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "st", providerId: "radio", segments: [{ url: "live" }] });
    a._loadMeta(Infinity);
    a._tick(9);
    expect(eng.state().duration).toBe(0);
    expect(eng.state().position).toBe(9);
    expect(eng.state().providerId).toBe("radio");
  });
});

describe("multi-segment TTS — logical position spans the whole article", () => {
  it("position on chunk 2 = finished chunks + in-chunk time (not chunk-local)", () => {
    const { a, eng } = tts3();
    a._end();          // chunk0 done → chunk1
    a._end();          // chunk1 done → chunk2
    a._tick(5);        // 5s into chunk2
    expect(eng.state().position).toBe(10 + 20 + 5);
    expect(eng.state().duration).toBe(60);
    expect(eng.state().providerId).toBe("tts");
  });

  it("chunk completion transitions to the next chunk (scenario 10)", () => {
    const { a } = tts3();
    expect(a.src).toBe("c0");
    a._end();
    expect(a.src).toBe("c1");         // advanced, same shared element
    expect(a.paused).toBe(false);     // still playing
  });

  it("logical seek crosses chunk boundaries (scenario 5)", () => {
    const { a, eng } = tts3();
    eng.seekTo(35);                   // 35s = 5s into chunk2 (10+20)
    expect(a.src).toBe("c2");
    a._loadMeta(30);                  // metadata arrives → pending offset applies
    expect(a.currentTime).toBe(5);
    expect(eng.state().position).toBe(35);
  });

  it("pause/resume mid-article preserves logical position (scenario 6)", () => {
    const { a, eng } = tts3();
    a._end(); a._tick(8);             // 18s logical (chunk1 offset 10 + 8)
    eng.toggle();
    expect(a.paused).toBe(true);
    expect(eng.state().position).toBe(18);   // unchanged by pause
    eng.toggle();
    expect(a.paused).toBe(false);
    expect(eng.state().position).toBe(18);
  });

  it("completion reports the full duration/position (scenario 11)", () => {
    const { a, eng } = tts3();
    a._end(); a._end();               // to last chunk
    a._tick(30);                      // end of chunk2
    expect(eng.state().position).toBe(60);
    expect(eng.state().duration).toBe(60);
  });
});

describe("switching sources leaves no stale logical state (scenario 12)", () => {
  it("loading a new single-segment source resets position + providerId", () => {
    const { a, eng } = tts3();
    eng.seekTo(35); a._loadMeta(30);       // deep into the article
    expect(eng.state().position).toBe(35);
    eng.load({ id: "m1", providerId: "music", segments: [{ url: "song" }] });
    a._loadMeta(200); a._tick(3);
    expect(eng.state().providerId).toBe("music");
    expect(eng.state().position).toBe(3);  // fresh, not the stale 35
  });
});
