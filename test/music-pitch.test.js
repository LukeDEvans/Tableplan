import { describe, it, expect } from "vitest";
import { detectPitch, freqToMidi, createPitchTracker } from "../music/pitch.js";

// Synthetic tone generator — the microphone stand-in for deterministic tests.
function sine(freq, sampleRate = 44100, n = 2048, amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  return b;
}
function noise(n = 2048, amp = 0.5) {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = amp * (Math.random() * 2 - 1);
  return b;
}

describe("pitch — frequency → MIDI", () => {
  it("maps standard pitches", () => {
    expect(freqToMidi(440)).toBe(69);     // A4
    expect(freqToMidi(261.63)).toBe(60);  // C4
    expect(freqToMidi(220)).toBe(57);     // A3
  });
});

describe("pitch — detectPitch (autocorrelation)", () => {
  it("recovers the fundamental of a pure tone within a few cents", () => {
    for (const f of [220, 261.63, 440, 659.25]) {
      const { frequency, clarity } = detectPitch(sine(f), 44100);
      expect(freqToMidi(frequency)).toBe(freqToMidi(f)); // lands on the right note
      expect(clarity).toBeGreaterThan(0.8);
    }
  });
  it("gates silence and rejects noise", () => {
    expect(detectPitch(new Float32Array(2048), 44100).frequency).toBe(0); // silence
    const n = detectPitch(noise(), 44100);
    expect(n.clarity).toBeLessThan(0.85); // noise has low clarity → tracker won't fire
  });
});

describe("pitch — note tracker (frames → events)", () => {
  const voiced = (midi, clarity = 0.98) => {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    return { frequency: freq, clarity, rms: 0.2 };
  };
  const silent = { frequency: 0, clarity: 0, rms: 0 };

  it("emits a noteOn once a new pitch is stable, and noteOff on silence", () => {
    const tr = createPitchTracker({ stableFrames: 2, silenceFrames: 2 });
    expect(tr.frame({ ...voiced(60), t: 1 })).toEqual([]);           // first frame — not yet stable
    const on = tr.frame({ ...voiced(60), t: 2 });
    expect(on).toHaveLength(1);
    expect(on[0]).toMatchObject({ type: "noteOn", note: { midi: 60 }, source: "mic" });
    expect(on[0].note.confidence).toBeGreaterThan(0.9);

    expect(tr.frame({ ...silent, t: 3 })).toEqual([]);               // one silent frame — debounce
    const off = tr.frame({ ...silent, t: 4 });
    expect(off).toEqual([{ t: 4, type: "noteOff", note: { midi: 60 }, source: "mic" }]);
  });

  it("switches notes: noteOff old + noteOn new when the pitch changes", () => {
    const tr = createPitchTracker({ stableFrames: 2, silenceFrames: 3 });
    tr.frame(voiced(60)); tr.frame(voiced(60)); // establish C4
    tr.frame(voiced(62));                        // E-ish candidate, 1 frame
    const evs = tr.frame({ ...voiced(62), t: 9 });
    expect(evs.map((e) => e.type)).toEqual(["noteOff", "noteOn"]);
    expect(evs[0].note.midi).toBe(60);
    expect(evs[1].note.midi).toBe(62);
  });

  it("ignores low-clarity frames (noise doesn't trigger notes)", () => {
    const tr = createPitchTracker({ stableFrames: 2, minClarity: 0.85 });
    tr.frame(voiced(60, 0.3)); // noisy
    expect(tr.frame(voiced(60, 0.3))).toEqual([]);
    expect(tr.current()).toBeNull();
  });
});
