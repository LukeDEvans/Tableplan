// PerformanceEvent — the normalized boundary between input capture and score
// interpretation (design doc §11, revision change 5). Every input source (MIDI,
// microphone, file, test) emits this shape; the FollowingEngine consumes only
// this, never device-specific code. The envelope is deliberately extensible:
// chords/polyphony (chordGroup), sustain/controllers, MIDI channels, and
// uncertainty all fit without a redesign, and unknown future fields ride in meta.
//
// PerformanceEvent:
//   t            number   ms since stream start (monotonic)
//   type         string   "noteOn"|"noteOff"|"onset"|"silence"|"sustain"|"controller"|… (open set)
//   note?        { midi, velocity?, confidence? }
//   chordGroup?  string   concurrent notes sharing this group form a chord
//   controller?  { number, value }
//   channel?     number
//   uncertainty? number   0..1 (mic path); MIDI ≈ 0
//   source       string   provider id (provenance)
//   meta?        object   forward-compat extension bag

export function makeEvent(p = {}) {
  const e = { t: Number.isFinite(p.t) ? p.t : 0, type: p.type || "noteOn", source: p.source || "unknown" };
  if (p.note) e.note = { midi: p.note.midi, ...(p.note.velocity != null ? { velocity: p.note.velocity } : {}), ...(p.note.confidence != null ? { confidence: p.note.confidence } : {}) };
  if (p.controller) e.controller = { number: p.controller.number, value: p.controller.value };
  if (p.channel != null) e.channel = p.channel;
  if (p.chordGroup) e.chordGroup = p.chordGroup;
  if (p.uncertainty != null) e.uncertainty = p.uncertainty;
  if (p.meta) e.meta = p.meta;
  return e;
}

export const noteOn = (t, midi, o = {}) =>
  makeEvent({ t, type: "noteOn", note: { midi, velocity: o.velocity, confidence: o.confidence }, channel: o.channel, chordGroup: o.chordGroup, uncertainty: o.uncertainty, source: o.source });
export const noteOff = (t, midi, o = {}) =>
  makeEvent({ t, type: "noteOff", note: { midi }, channel: o.channel, source: o.source });
export const sustain = (t, on, o = {}) =>
  makeEvent({ t, type: "sustain", controller: { number: 64, value: on ? 127 : 0 }, channel: o.channel, source: o.source });
