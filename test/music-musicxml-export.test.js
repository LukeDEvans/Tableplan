import { describe, it, expect } from "vitest";
import { parseMusicXml } from "../music/musicxml-parser.js";
import { serializeToMusicXml, midiToPitch } from "../music/musicxml-export.js";

// Compact inline MusicXML builders (mirrors the parser test's helpers).
const score = (partsXml, partList = `<score-part id="P1"><part-name>Piano</part-name></score-part>`) =>
  `<?xml version="1.0"?><score-partwise version="3.1"><part-list>${partList}</part-list>${partsXml}</score-partwise>`;
const note = (step, oct, dur, extra = "") => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;
const rest = (dur) => `<note><rest/><duration>${dur}</duration></note>`;

// Compare the two models on musical essentials (order-independent per measure).
function essence(model) {
  return {
    tpq: model.ticksPerQuarter,
    parts: model.parts.map((p) => p.id),
    measures: model.measures.map((m) => ({
      time: m.timeSig, key: m.keySigFifths,
      events: m.events
        .map((e) => ({ kind: e.kind, on: e.onsetTick, dur: e.durationTicks, midis: [...e.midis].sort((a, b) => a - b), voice: e.voice || 1 }))
        .sort((a, b) => a.on - b.on || (a.midis[0] ?? -1) - (b.midis[0] ?? -1) || a.voice - b.voice),
    })),
  };
}

const roundTrip = (srcXml) => {
  const model1 = parseMusicXml(srcXml, { representationId: "r1" });
  const { xml } = serializeToMusicXml(model1);
  const model2 = parseMusicXml(xml, { representationId: "r2" });
  return { model1, model2 };
};

describe("midiToPitch", () => {
  it("maps reference pitches (round-trips by pitch class)", () => {
    expect(midiToPitch(60)).toEqual({ step: "C", alter: 0, octave: 4 });
    expect(midiToPitch(61)).toEqual({ step: "C", alter: 1, octave: 4 });
    expect(midiToPitch(69)).toEqual({ step: "A", alter: 0, octave: 4 }); // A4 = 440Hz
  });
});

describe("round-trip: MusicXML → model → MusicXML preserves musical meaning", () => {
  it("simple 4/4 measure of quarter notes", () => {
    const src = score(`<part id="P1"><measure number="1">` +
      `<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
      note("C", 4, 1) + note("D", 4, 1) + note("E", 4, 1) + note("F", 4, 1) + `</measure></part>`);
    const { model1, model2 } = roundTrip(src);
    expect(essence(model2)).toEqual(essence(model1));
    expect(model2.measures[0].events.map((e) => e.midis[0])).toEqual([60, 62, 64, 65]);
  });

  it("half notes + rests", () => {
    const src = score(`<part id="P1"><measure number="1">` +
      `<attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
      note("C", 4, 4) + rest(4) + `</measure></part>`);
    const { model1, model2 } = roundTrip(src);
    expect(essence(model2)).toEqual(essence(model1));
    expect(model2.measures[0].events.map((e) => e.kind)).toContain("rest");
  });

  it("a chord (single onset, multiple pitches)", () => {
    const src = score(`<part id="P1"><measure number="1">` +
      `<attributes><divisions>1</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration></note>` +
      `<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration></note>` +
      `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note>` +
      `</measure></part>`);
    const { model1, model2 } = roundTrip(src);
    expect(essence(model2)).toEqual(essence(model1));
    const ev = model2.measures[0].events.find((e) => e.midis.length > 1);
    expect([...ev.midis].sort((a, b) => a - b)).toEqual([60, 64, 67]); // C E G
  });

  it("exact triplets (divisions=3) survive without float drift", () => {
    const src = score(`<part id="P1"><measure number="1">` +
      `<attributes><divisions>3</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>` +
      note("C", 4, 1) + note("D", 4, 1) + note("E", 4, 1) + `</measure></part>`);
    const { model1, model2 } = roundTrip(src);
    expect(model2.ticksPerQuarter).toBe(3);
    expect(essence(model2)).toEqual(essence(model1));
    expect(model2.measures[0].events.map((e) => e.onsetTick)).toEqual([0, 1, 2]);
  });

  it("multi-measure with a mid-piece time & key change", () => {
    const src = score(`<part id="P1">` +
      `<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time></attributes>` + note("C", 4, 1) + note("D", 4, 1) + `</measure>` +
      `<measure number="2"><attributes><key><fifths>2</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time></attributes>` + note("E", 4, 1) + note("F", 4, 1) + note("G", 4, 1) + `</measure>` +
      `</part>`);
    const { model1, model2 } = roundTrip(src);
    expect(essence(model2)).toEqual(essence(model1));
    expect(model2.measures.map((m) => m.timeSig)).toEqual([[2, 4], [3, 4]]);
    expect(model2.measures.map((m) => m.keySigFifths)).toEqual([0, 2]);
  });

  it("two voices in one measure (backup) round-trip", () => {
    const src = score(`<part id="P1"><measure number="1">` +
      `<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>` +
      `<note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice></note>` +
      `<note><pitch><step>D</step><octave>5</octave></pitch><duration>1</duration><voice>1</voice></note>` +
      `<backup><duration>2</duration></backup>` +
      `<note><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice></note>` +
      `<note><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>2</voice></note>` +
      `</measure></part>`);
    const { model1, model2 } = roundTrip(src);
    expect(essence(model2)).toEqual(essence(model1));
    // both voices survived
    const voices = new Set(model2.measures[0].events.map((e) => e.voice));
    expect([...voices].sort()).toEqual([1, 2]);
  });
});

describe("serializer surfaces unsupported features instead of silently dropping", () => {
  it("warns when ties are present (original bytes remain the lossless path)", () => {
    const src = score(`<part id="P1"><measure number="1">` +
      `<attributes><divisions>1</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><tie type="start"/><notations><tied type="start"/></notations></note>` +
      note("C", 4, 1) + `</measure></part>`);
    const model = parseMusicXml(src, { representationId: "r" });
    const { warnings } = serializeToMusicXml(model);
    expect(warnings.some((w) => /tie/i.test(w))).toBe(true);
  });
});
