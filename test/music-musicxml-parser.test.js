import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseMusicXml } from "../music/musicxml-parser.js";
import { offsetToDisplayBeat } from "../music/score-model.js";

const fixture = (name) => readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), "utf8");

// Compact inline MusicXML builder for focused timing cases.
const score = (partsXml, partList = `<score-part id="P1"><part-name>P</part-name></score-part>`) =>
  `<?xml version="1.0"?><score-partwise version="3.1"><part-list>${partList}</part-list>${partsXml}</score-partwise>`;
const note = (step, oct, dur, extra = "") => `<note><pitch><step>${step}</step><octave>${oct}</octave></pitch><duration>${dur}</duration>${extra}</note>`;
const rest = (dur) => `<note><rest/><duration>${dur}</duration></note>`;

describe("parser — basic structure & pitches (fixture file)", () => {
  const model = parseMusicXml(fixture("simple-4-4.musicxml"), { representationId: "rep1" });
  it("derives ticksPerQuarter from divisions (LCM of {1})", () => expect(model.ticksPerQuarter).toBe(1));
  it("reads parts, measures, time & key", () => {
    expect(model.parts).toEqual([{ id: "P1", name: "Piano" }]);
    expect(model.measures).toHaveLength(2);
    expect(model.measures[0].timeSig).toEqual([4, 4]);
    expect(model.measures[0].keySigFifths).toBe(0);
  });
  it("places notes at exact onsets with correct MIDI pitches", () => {
    const m0 = model.measures[0].events;
    expect(m0.map((e) => e.midis[0])).toEqual([60, 62, 64, 65]);     // C4 D4 E4 F4
    expect(m0.map((e) => e.onsetTick)).toEqual([0, 1, 2, 3]);
    expect(m0[0].onset).toEqual({ num: 0, den: 1 });
  });
  it("handles half notes and rests; measure startTick accumulates", () => {
    const m1 = model.measures[1];
    expect(m1.events.map((e) => e.kind)).toEqual(["note", "note", "rest"]);
    expect(m1.events.map((e) => e.onsetTick)).toEqual([0, 2, 3]);
    expect(m1.startTick).toBe(4);
    expect(model.warnings).toEqual([]);
  });
});

describe("parser — tuplets are EXACT (no float approximation)", () => {
  const model = parseMusicXml(score(
    `<part id="P1"><measure number="1"><attributes><divisions>3</divisions><time><beats>1</beats><beat-type>4</beat-type></time></attributes>` +
    note("C", 4, 1) + note("D", 4, 1) + note("E", 4, 1) + `</measure></part>`));
  it("represents triplet eighths as {1,3} offsets with tpq=3, ticks 0,1,2", () => {
    expect(model.ticksPerQuarter).toBe(3);
    const ev = model.measures[0].events;
    expect(ev.map((e) => e.onset)).toEqual([{ num: 0, den: 1 }, { num: 1, den: 3 }, { num: 2, den: 3 }]);
    expect(ev.map((e) => e.onsetTick)).toEqual([0, 1, 2]);
    expect(model.warnings).toEqual([]); // exact — nothing to warn about
  });
});

describe("parser — mid-piece divisions change → LCM resolution", () => {
  const model = parseMusicXml(score(
    `<part id="P1">` +
    `<measure number="1"><attributes><divisions>2</divisions><time><beats>2</beats><beat-type>4</beat-type></time></attributes>` + note("C", 4, 2) + note("D", 4, 2) + `</measure>` +
    `<measure number="2"><attributes><divisions>3</divisions></attributes>` + note("E", 4, 1) + note("F", 4, 1) + note("G", 4, 1) + `</measure>` +
    `</part>`));
  it("derives tpq = LCM(2,3) = 6 and both measures land on exact ticks", () => {
    expect(model.ticksPerQuarter).toBe(6);
    expect(model.measures[0].events.map((e) => e.onsetTick)).toEqual([0, 6]);   // two quarters
    expect(model.measures[1].events.map((e) => e.onsetTick)).toEqual([0, 2, 4]); // triplet eighths
    expect(model.warnings).toEqual([]);
  });
});

describe("parser — pickup / anacrusis", () => {
  const model = parseMusicXml(score(
    `<part id="P1">` +
    `<measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` + note("G", 4, 1) + `</measure>` +
    `<measure number="1">` + note("C", 4, 4) + `</measure></part>`));
  it("marks the pickup implicit with content duration < nominal, and offsets the next measure", () => {
    expect(model.measures[0].implicit).toBe(true);
    expect(model.measures[0].durationQuarters).toEqual({ num: 1, den: 1 }); // one quarter of content
    expect(model.measures[0].durationTicks).toBe(1);
    expect(model.measures[1].startTick).toBe(1); // downbeat of m1 sits after the pickup
  });
});

describe("parser — grand staff via backup (multi-voice/staff)", () => {
  const model = parseMusicXml(score(
    `<part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
    `<note><pitch><step>C</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>` +
    `<note><pitch><step>E</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>` +
    `<backup><duration>4</duration></backup>` +
    `<note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note>` +
    `</measure></part>`));
  it("backup rewinds the cursor so staff 2 starts at onset 0", () => {
    const ev = model.measures[0].events;
    const staff2 = ev.find((e) => e.staff === 2);
    expect(staff2.midis[0]).toBe(48);            // C3
    expect(staff2.onsetTick).toBe(0);            // rewound to the downbeat
    const staff1 = ev.filter((e) => e.staff === 1);
    expect(staff1.map((e) => e.onsetTick)).toEqual([0, 2]);
  });
});

describe("parser — chords, 6/8 display beats, and repeats", () => {
  it("merges chord members into one event sharing an onset", () => {
    const model = parseMusicXml(score(
      `<part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>` +
      `<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration></note>` +
      `<note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration></note>` +
      `<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration></note>` +
      `</measure></part>`));
    const ev = model.measures[0].events;
    expect(ev).toHaveLength(1);
    expect(ev[0].kind).toBe("chord");
    expect(ev[0].midis.sort((a, b) => a - b)).toEqual([60, 64, 67]); // C E G, one onset
  });

  it("derives display beats from the time signature (6/8 → eighth beats)", () => {
    const model = parseMusicXml(score(
      `<part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>6</beats><beat-type>8</beat-type></time></attributes>` +
      note("C", 5, 1) + note("D", 5, 1) + note("E", 5, 1) + note("F", 5, 1) + note("G", 5, 1) + note("A", 5, 1) + `</measure></part>`));
    const m = model.measures[0];
    expect(m.timeSig).toEqual([6, 8]);
    expect(m.events.map((e) => e.onsetTick)).toEqual([0, 1, 2, 3, 4, 5]); // tpq=2
    expect(offsetToDisplayBeat(m.events[1].onset, m.timeSig)).toBeCloseTo(2); // 2nd eighth = beat 2
    expect(offsetToDisplayBeat(m.events[3].onset, m.timeSig)).toBeCloseTo(4);
  });

  it("captures barline repeats and voltas", () => {
    const model = parseMusicXml(score(
      `<part id="P1">` +
      `<measure number="1"><attributes><divisions>1</divisions></attributes><barline location="left"><repeat direction="forward"/></barline>` + note("C", 4, 4) + `</measure>` +
      `<measure number="2"><barline location="left"><ending number="1" type="start"/></barline>` + note("D", 4, 4) + `<barline location="right"><repeat direction="backward"/></barline></measure>` +
      `</part>`));
    expect(model.repeats).toEqual([
      { kind: "repeat", direction: "forward", measureIndex: 0 },
      { kind: "ending", number: "1", type: "start", measureIndex: 1 },
      { kind: "repeat", direction: "backward", measureIndex: 1 },
    ]);
  });
});
