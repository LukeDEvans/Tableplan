// MusicXML export — serialize the app-owned ScoreModel back to MusicXML
// (design §6/§34). The canonical model is format-independent; this proves it can
// round-trip (MusicXML → model → MusicXML preserves musical meaning) and gives
// the user their data back as an open format — never a proprietary prison.
//
// Pure and DOM-free. Uses the model's own integer `ticksPerQuarter` as MusicXML
// `divisions`, so onsets/durations are exact (the model froze no global
// resolution). Multiple voices in a part are serialized with <backup>, so a
// two-staff piano measure round-trips.
//
// Scope (v0): notes, chords, rests, multi-part, multi-voice, per-measure time &
// key changes. NOT yet emitted (documented, non-destructive — the ORIGINAL
// source bytes are always retained as the lossless export path): ties/slurs,
// articulations, dynamics, tuplet brackets, repeats/voltas. Such a model reports
// them via `warnings` so nothing is silently claimed as complete.

const STEP_ALTER = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];

/** MIDI number → { step, alter, octave } (sharp spelling; round-trips by pitch). */
export function midiToPitch(midi) {
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const [step, alter] = STEP_ALTER[pc];
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return { step, alter, octave };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const timeEq = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];

function pitchXml(midi) {
  const { step, alter, octave } = midiToPitch(midi);
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

function noteXml(ev, midi, isChord) {
  const staff = ev.staff ? `<staff>${ev.staff}</staff>` : "";
  return `<note>${isChord ? "<chord/>" : ""}${pitchXml(midi)}<duration>${ev.durationTicks}</duration><voice>${ev.voice || 1}</voice>${staff}</note>`;
}

function restXml(ev) {
  const staff = ev.staff ? `<staff>${ev.staff}</staff>` : "";
  return `<note><rest/><duration>${ev.durationTicks}</duration><voice>${ev.voice || 1}</voice>${staff}</note>`;
}

function eventXml(ev) {
  if (ev.kind === "rest" || !ev.midis || !ev.midis.length) return restXml(ev);
  // First pitch as the note, the rest as <chord/> members (same onset & duration).
  return ev.midis.map((midi, i) => noteXml(ev, midi, i > 0)).join("");
}

// Group a part-measure's events into voices in first-appearance order, each in
// onset order, so multiple voices can be laid down with <backup> between them.
function voiceGroups(events) {
  const order = [];
  const byVoice = new Map();
  for (const ev of events) {
    const v = ev.voice || 1;
    if (!byVoice.has(v)) { byVoice.set(v, []); order.push(v); }
    byVoice.get(v).push(ev);
  }
  return order.map((v) => byVoice.get(v).slice().sort((a, b) => (a.onsetTick || 0) - (b.onsetTick || 0)));
}

/**
 * Serialize a ScoreModel to a MusicXML (score-partwise) string.
 * @returns { xml, warnings }
 */
export function serializeToMusicXml(model, { software = "Cadence" } = {}) {
  const divisions = model?.ticksPerQuarter || 1;
  const parts = (model?.parts && model.parts.length) ? model.parts : [{ id: "P1", name: "Music" }];
  const measures = model?.measures || [];
  const warnings = [];
  if (measures.some((m) => (m.events || []).some((e) => e.pitches && e.pitches.some((p) => p.tied)))) {
    warnings.push("ties are not serialized in v0 (original source bytes remain the lossless export)");
  }

  const partListXml = parts
    .map((p) => `<score-part id="${esc(p.id)}"><part-name>${esc(p.name || p.id)}</part-name></score-part>`)
    .join("");

  const partsXml = parts.map((part) => {
    let firstMeasure = true, prevKey = null, prevTime = null;
    const measuresXml = measures.map((m) => {
      const evs = (m.events || []).filter((e) => (e.partId || parts[0].id) === part.id);

      // Attributes: divisions once per part; key/time on change.
      const attrs = [];
      if (firstMeasure) attrs.push(`<divisions>${divisions}</divisions>`);
      const key = m.keySigFifths || 0;
      if (key !== prevKey) attrs.push(`<key><fifths>${key}</fifths></key>`);
      const ts = m.timeSig || [4, 4];
      if (!timeEq(ts, prevTime)) attrs.push(`<time><beats>${ts[0]}</beats><beat-type>${ts[1]}</beat-type></time>`);
      prevKey = key; prevTime = ts; firstMeasure = false;
      const attrsXml = attrs.length ? `<attributes>${attrs.join("")}</attributes>` : "";

      // Body: each voice in turn, <backup> to restart the bar for the next voice.
      const groups = voiceGroups(evs);
      const body = groups.map((group, gi) => {
        const notes = group.map(eventXml).join("");
        if (gi === groups.length - 1) return notes;
        const dur = group.reduce((s, e) => s + (e.durationTicks || 0), 0);
        return `${notes}<backup><duration>${dur}</duration></backup>`;
      }).join("");

      const number = esc(m.printedNumber || (m.index + 1));
      const implicit = m.implicit ? ` implicit="yes"` : "";
      return `<measure number="${number}"${implicit}>${attrsXml}${body}</measure>`;
    }).join("");
    return `<part id="${esc(part.id)}">${measuresXml}</part>`;
  }).join("");

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<score-partwise version="3.1">` +
    `<identification><encoding><software>${esc(software)}</software></encoding></identification>` +
    `<part-list>${partListXml}</part-list>` +
    partsXml +
    `</score-partwise>`;

  return { xml, warnings };
}
