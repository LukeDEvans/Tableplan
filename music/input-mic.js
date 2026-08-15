// Microphone input provider — implements the InputProvider contract by running
// the audio through the pure pitch layer (music/pitch.js) and forwarding the
// resulting noteOn/noteOff PerformanceEvents to the sink. All the messy
// transcription is in pitch.js (unit-tested); this file is just Web Audio glue,
// so swapping in a better detector later touches nothing else.
//
// v0 is monophonic. Degrades cleanly where getUserMedia / AudioContext are
// unavailable via isAvailable().

import { detectPitch, createPitchTracker } from "./pitch.js";

export function createMicInputProvider(opts = {}) {
  let ctx = null, stream = null, analyser = null, raf = null, sink = null, tracker = null, buf = null, running = false;

  function loop() {
    if (!running || !analyser) return;
    analyser.getFloatTimeDomainData(buf);
    const frame = detectPitch(buf, ctx.sampleRate);
    frame.t = (typeof performance !== "undefined" ? performance.now() : Date.now());
    for (const ev of tracker.frame(frame)) sink?.(ev);
    raf = requestAnimationFrame(loop);
  }

  return {
    id: "mic",
    kind: "microphone",
    async isAvailable() {
      return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia
        && (typeof AudioContext !== "undefined" || typeof webkitAudioContext !== "undefined");
    },
    async start(s) {
      sink = s;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const AC = typeof AudioContext !== "undefined" ? AudioContext : webkitAudioContext;
      ctx = new AC();
      if (ctx.state === "suspended") { try { await ctx.resume(); } catch { /* gesture required */ } }
      const src = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      src.connect(analyser);
      buf = new Float32Array(analyser.fftSize);
      tracker = createPitchTracker(opts);
      running = true;
      loop();
      return 1;
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* noop */ }
      try { ctx?.close(); } catch { /* noop */ }
      ctx = null; stream = null; analyser = null; sink = null; tracker = null; buf = null;
    },
  };
}
