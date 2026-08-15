import { describe, it, expect, vi } from "vitest";
import { createPlaybackEngine } from "../playback-engine.js";

// Minimal fake of the one persistent <audio> element the host would pass in.
// Tracks src/currentTime/paused, fires the handlers the engine assigns, and
// lets a test simulate metadata loading and segment end.
function makeFakeAudio() {
  const a = {
    src: "",
    currentTime: 0,
    duration: NaN,
    paused: true,
    ended: false,
    readyState: 0,
    playbackRate: 1,
    load: vi.fn(function () { this.readyState = 0; }),
    play: vi.fn(function () { this.paused = false; this.ended = false; this.onplay && this.onplay(); return Promise.resolve(); }),
    pause: vi.fn(function () { this.paused = true; this.onpause && this.onpause(); }),
  };
  // Test helpers (not part of the real element API):
  a._loadMeta = (dur) => { a.duration = dur; a.readyState = 1; a.onloadedmetadata && a.onloadedmetadata(); };
  a._end = () => { a.ended = true; a.paused = true; a.onended && a.onended(); };
  a._tick = (t) => { a.currentTime = t; a.ontimeupdate && a.ontimeupdate(); };
  return a;
}

function engineWith(audio) {
  return createPlaybackEngine({ createAudio: () => audio });
}

describe("playback engine — single-segment (podcast/music) source", () => {
  it("loads, plays, and reports position on the logical stream", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "ep1", providerId: "podcast", segments: [{ url: "u1", duration: 100 }] });
    expect(a.src).toBe("u1");
    expect(a.paused).toBe(false);          // autoplay by default
    a._tick(30);
    expect(eng.state().position).toBe(30);
    expect(eng.state().duration).toBe(100);
  });

  it("resumes from startPosition once metadata is ready", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "ep1", providerId: "podcast", segments: [{ url: "u1", duration: 100 }], startPosition: 42 });
    expect(a.currentTime).toBe(0);         // deferred until metadata
    a._loadMeta(100);
    expect(a.currentTime).toBe(42);
  });

  it("toggle pauses and resumes", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "ep1", providerId: "podcast", segments: [{ url: "u1", duration: 100 }] });
    eng.toggle();
    expect(a.paused).toBe(true);
    eng.toggle();
    expect(a.paused).toBe(false);
  });

  it("emits 'ended' when the only segment finishes", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    const onEnded = vi.fn();
    eng.on("ended", onEnded);
    eng.load({ id: "ep1", providerId: "podcast", segments: [{ url: "u1", duration: 100 }] });
    a._end();
    expect(onEnded).toHaveBeenCalledWith({ sourceId: "ep1" });
  });
});

describe("playback engine — multi-segment (TTS) source", () => {
  const ttsSource = () => ({
    id: "art1", providerId: "tts",
    segments: [{ url: "c0", duration: 10 }, { url: "c1", duration: 20 }, { url: "c2", duration: 5 }],
  });

  it("advances gaplessly to the next segment when one ends", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load(ttsSource());
    expect(a.src).toBe("c0");
    a._end();                               // segment 0 ends
    expect(a.src).toBe("c1");
    expect(a.paused).toBe(false);           // kept playing
    expect(eng.state().segIndex).toBe(1);
  });

  it("reports logical position across segment boundaries", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load(ttsSource());
    a._end();                               // now on segment 1 (offset 10)
    a._tick(7);
    expect(eng.state().position).toBe(17);  // 10 + 7
    expect(eng.state().duration).toBe(35);  // 10 + 20 + 5
  });

  it("emits 'ended' only after the LAST segment finishes", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    const onEnded = vi.fn();
    eng.on("ended", onEnded);
    eng.load(ttsSource());
    a._end(); a._end();                     // through segments 0 and 1
    expect(onEnded).not.toHaveBeenCalled();
    a._end();                               // last segment
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it("seeks across a segment boundary by loading the right segment + offset", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load(ttsSource());
    eng.seekTo(25);                         // 25s → segment 1 (starts at 10), offset 15
    expect(a.src).toBe("c1");
    expect(eng.state().segIndex).toBe(1);
    a._loadMeta(20);
    expect(a.currentTime).toBe(15);
  });

  it("seeks within the current segment without reloading", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load(ttsSource());
    a._loadMeta(10);
    a.load.mockClear();
    eng.seekTo(4);                          // still segment 0
    expect(a.src).toBe("c0");
    expect(a.load).not.toHaveBeenCalled();
    expect(a.currentTime).toBe(4);
  });
});

describe("playback engine — rate, resume location, and duration filling", () => {
  it("applies rate to the current and subsequent segments", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "x", providerId: "tts", segments: [{ url: "c0", duration: 10 }, { url: "c1", duration: 10 }] });
    eng.setRate(1.5);
    expect(a.playbackRate).toBe(1.5);
    a._end();                               // advance to c1
    expect(a.playbackRate).toBe(1.5);       // rate re-applied on the reused element
  });

  it("resumes mid-way through a later segment", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({
      id: "x", providerId: "tts",
      segments: [{ url: "c0", duration: 10 }, { url: "c1", duration: 10 }, { url: "c2", duration: 10 }],
      startPosition: 23,                    // segment 2, offset 3
    });
    expect(a.src).toBe("c2");
    a._loadMeta(10);
    expect(a.currentTime).toBe(3);
    expect(eng.state().segIndex).toBe(2);
  });

  it("learns an unknown segment duration from metadata", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "x", providerId: "music", segments: [{ url: "u1" }] }); // no duration known
    expect(eng.state().duration).toBe(0);
    a._loadMeta(217);
    expect(eng.state().duration).toBe(217);
  });

  it("setSegmentDuration sharpens the scale without reload", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    eng.load({ id: "x", providerId: "tts", segments: [{ url: "c0" }, { url: "c1" }] });
    eng.setSegmentDuration(0, 12);
    eng.setSegmentDuration(1, 8);
    expect(eng.state().duration).toBe(20);
  });
});

describe("playback engine — guards", () => {
  it("requires a createAudio factory", () => {
    expect(() => createPlaybackEngine({})).toThrow(/createAudio/);
  });
  it("rejects an empty source", () => {
    const eng = engineWith(makeFakeAudio());
    expect(() => eng.load({ id: "x", providerId: "p", segments: [] })).toThrow(/segment/);
  });

  it("stop() detaches handlers so a late ended can't fire into feature code", () => {
    const a = makeFakeAudio();
    const eng = engineWith(a);
    const onEnded = vi.fn();
    eng.on("ended", onEnded);
    eng.load({ id: "x", providerId: "podcast", segments: [{ url: "u1", duration: 10 }] });
    eng.stop();
    expect(a.paused).toBe(true);
    a._end(); // a stray end arriving after stop must be inert
    expect(onEnded).not.toHaveBeenCalled();
    expect(eng.isActive()).toBe(false);
  });
});
