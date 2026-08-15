// Pitch layer — the pure, testable heart of microphone input. Two pieces:
//   detectPitch(buffer, sampleRate) → { frequency, clarity, rms }   (autocorrelation)
//   createPitchTracker() : a state machine turning a stream of detection frames
//                          into normalized noteOn/noteOff PerformanceEvents.
// The browser glue (input-mic.js) only feeds real audio frames through these, so
// the transcription logic is unit-tested with synthetic tones — no microphone.
//
// v0 is MONOPHONIC (strongest fundamental). That pairs well with the following
// engine, which matches on pitch membership; polyphonic transcription is a
// later upgrade behind the same event boundary.

import { noteOn, noteOff } from "./performance-event.js";

/** MIDI note number for a frequency (A4=440→69). */
export function freqToMidi(freq) {
  return Math.round(69 + 12 * Math.log2(freq / 440));
}

/**
 * Autocorrelation pitch detection with an RMS gate, plausible-pitch lag range
 * (~50–1500 Hz), fundamental-favouring peak pick, and parabolic interpolation.
 * Returns frequency 0 when unvoiced/too quiet.
 */
export function detectPitch(buf, sampleRate, { minRms = 0.01, minFreq = 50, maxFreq = 1500 } = {}) {
  const size = buf.length;
  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / size);
  if (rms < minRms) return { frequency: 0, clarity: 0, rms };

  const half = Math.floor(size / 2);
  const minLag = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxLag = Math.min(half - 1, Math.floor(sampleRate / minFreq));

  const corr = new Float64Array(maxLag + 2);
  let energy = 0;
  for (let i = 0; i < half; i++) energy += buf[i] * buf[i];
  let maxCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < half; i++) sum += buf[i] * buf[i + lag];
    corr[lag] = sum;
    if (sum > maxCorr) maxCorr = sum;
  }
  if (maxCorr <= 0) return { frequency: 0, clarity: 0, rms };

  // Favour the FUNDAMENTAL: the first local-peak lag whose correlation clears a
  // fraction of the global max (avoids octave-up errors that pick a shorter lag).
  const threshold = 0.85 * maxCorr;
  let bestLag = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] > threshold && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) { bestLag = lag; break; }
  }
  if (bestLag < 0) return { frequency: 0, clarity: 0, rms };

  const c1 = corr[bestLag - 1], c2 = corr[bestLag], c3 = corr[bestLag + 1];
  const denom = c1 - 2 * c2 + c3;
  const shift = denom ? 0.5 * (c1 - c3) / denom : 0;
  const period = bestLag + shift;
  return { frequency: sampleRate / period, clarity: energy ? c2 / energy : 0, rms };
}

/**
 * Frame-by-frame note tracker. Feed detection frames; get 0–2 events per frame.
 * Emits a noteOn once a new pitch is stable for `stableFrames`, and a noteOff on
 * a pitch change or after `silenceFrames` of silence — debounced so mic jitter
 * doesn't machine-gun events.
 */
export function createPitchTracker({ minClarity = 0.85, minRms = 0.01, stableFrames = 2, silenceFrames = 3 } = {}) {
  let current = null, candidate = null, candCount = 0, silence = 0;
  return {
    frame({ frequency, clarity, rms, t = 0 }) {
      const events = [];
      const voiced = frequency > 0 && clarity >= minClarity && rms >= minRms;
      if (!voiced) {
        candidate = null; candCount = 0; silence += 1;
        if (current != null && silence >= silenceFrames) { events.push(noteOff(t, current, { source: "mic" })); current = null; }
        return events;
      }
      silence = 0;
      const midi = freqToMidi(frequency);
      if (midi === current) { candidate = null; candCount = 0; return events; }
      if (midi === candidate) candCount += 1; else { candidate = midi; candCount = 1; }
      if (candCount >= stableFrames) {
        if (current != null) events.push(noteOff(t, current, { source: "mic" }));
        events.push(noteOn(t, midi, { confidence: round2(clarity), uncertainty: round2(1 - clarity), source: "mic" }));
        current = midi; candidate = null; candCount = 0;
      }
      return events;
    },
    reset() { current = null; candidate = null; candCount = 0; silence = 0; },
    current() { return current; },
  };
}

const round2 = (n) => Math.round(n * 100) / 100;
