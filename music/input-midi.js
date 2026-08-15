// Web MIDI input provider — implements the InputProvider contract, emitting a
// normalized PerformanceEvent stream (note-on/off, sustain) the FollowingEngine
// consumes. Browser-only; degrades cleanly where Web MIDI is unavailable (e.g.
// iOS Safari) via isAvailable(). No transcription needed — MIDI is exact.

import { noteOn, noteOff, sustain } from "./performance-event.js";

export function createMidiInputProvider() {
  let access = null;
  let sink = null;
  let inputs = [];

  function handle(ev) {
    if (!sink) return;
    const [status, d1, d2] = ev.data;
    const cmd = status & 0xf0;
    const channel = status & 0x0f;
    const t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (cmd === 0x90 && d2 > 0) sink(noteOn(t, d1, { velocity: d2, channel, source: "midi" }));
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) sink(noteOff(t, d1, { channel, source: "midi" }));
    else if (cmd === 0xb0 && d1 === 64) sink(sustain(t, d2 >= 64, { channel, source: "midi" }));
  }

  function wire() {
    inputs.forEach((i) => { i.onmidimessage = null; });
    inputs = access ? [...access.inputs.values()] : [];
    inputs.forEach((i) => { i.onmidimessage = handle; });
  }

  return {
    id: "midi",
    kind: "midi",
    async isAvailable() { return typeof navigator !== "undefined" && typeof navigator.requestMIDIAccess === "function"; },
    async start(s) {
      sink = s;
      access = await navigator.requestMIDIAccess({ sysex: false });
      wire();
      access.onstatechange = wire; // hot-plug support
      return inputs.length;
    },
    /** Number of connected MIDI inputs (for a "connect a keyboard" hint). */
    deviceCount() { return inputs.length; },
    stop() {
      inputs.forEach((i) => { i.onmidimessage = null; });
      if (access) access.onstatechange = null;
      inputs = []; access = null; sink = null;
    },
  };
}
