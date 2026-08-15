// MusicXML → normalized ScoreModel. The ONLY place raw MusicXML is read.
//
// Uses fast-xml-parser in preserveOrder mode so note/backup/forward sequencing
// (which carries timing) is not lost. Onsets accumulate as EXACT rationals in
// quarter notes (value/divisions), independent of any resolution; after the
// whole score is walked, the model's ticksPerQuarter is derived as the LCM of
// all divisions seen and integer ticks are computed losslessly.
//
// Supports the constructs the slice fixtures exercise: divisions (incl. mid-
// piece changes), time/key signatures, multi-staff/multi-voice via backup/
// forward, chords, rests, tuplets (exact because <duration> is integer
// divisions), pickup/anacrusis measures (implicit), and barline repeats/voltas.
// Grace notes are captured with zero duration. Unsupported constructs are noted
// in model.warnings rather than silently dropped.

import { XMLParser } from "fast-xml-parser";
import { rat, add, sub, compare } from "./rational.js";
import { deriveResolution, quartersToTick } from "./score-model.js";

let evSeq = 0;
const evId = () => `ev_${(evSeq += 1).toString(36)}`;

// ── preserveOrder node helpers ─────────────────────────────────────────────────
const tagOf = (n) => Object.keys(n).find((k) => k !== ":@");
const kidsOf = (n) => { const t = tagOf(n); return Array.isArray(n[t]) ? n[t] : []; };
const attr = (n, name) => (n[":@"] ? n[":@"][`@_${name}`] : undefined);
const findChild = (nodes, name) => nodes.find((n) => tagOf(n) === name);
const has = (nodes, name) => nodes.some((n) => tagOf(n) === name);
function textOf(node) {
  const t = tagOf(node); const c = node[t];
  if (Array.isArray(c)) { const tn = c.find((x) => "#text" in x); return tn ? tn["#text"] : undefined; }
  return c;
}
function childText(nodes, name) { const n = findChild(nodes, name); return n == null ? undefined : textOf(n); }
const numOr = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

const STEP_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchToMidi(pitchKids) {
  const step = String(childText(pitchKids, "step") || "C").toUpperCase();
  const octave = numOr(childText(pitchKids, "octave"), 4);
  const alter = numOr(childText(pitchKids, "alter"), 0);
  return (octave + 1) * 12 + (STEP_SEMITONE[step] ?? 0) + alter;
}

export function parseMusicXml(xmlString, { representationId = "", id = "" } = {}) {
  const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: "@_", parseTagValue: true });
  const root = parser.parse(xmlString);
  const warnings = [];

  const scoreNode = findChild(root, "score-partwise");
  if (!scoreNode) {
    if (has(root, "score-timewise")) warnings.push("score-timewise not supported; convert to score-partwise");
    else warnings.push("no <score-partwise> root found");
    return finalize({ id, representationId, parts: [], measuresByIndex: [], repeats: [], divisionsSeen: [], warnings });
  }
  const scoreKids = kidsOf(scoreNode);

  // Part list → part metadata.
  const parts = [];
  const partList = findChild(scoreKids, "part-list");
  if (partList) {
    for (const sp of kidsOf(partList).filter((n) => tagOf(n) === "score-part")) {
      parts.push({ id: String(attr(sp, "id") || `P${parts.length + 1}`), name: String(childText(kidsOf(sp), "part-name") || "") });
    }
  }

  const partNodes = scoreKids.filter((n) => tagOf(n) === "part");
  const measuresByIndex = [];        // shared measure structure (from first part), events merged from all
  const repeats = [];
  const divisionsSeen = new Set();

  partNodes.forEach((partNode, partIndex) => {
    const partId = String(attr(partNode, "id") || parts[partIndex]?.id || `P${partIndex + 1}`);
    let divisions = 1;               // per-part running state
    let timeSig = [4, 4];
    let keyFifths = 0;

    const measureNodes = kidsOf(partNode).filter((n) => tagOf(n) === "measure");
    measureNodes.forEach((measureNode, mIndex) => {
      const mKids = kidsOf(measureNode);
      let cursor = rat(0, 1), maxCursor = rat(0, 1), lastNoteEvent = null;

      // Ensure the shared measure entry exists (first part defines structure).
      if (!measuresByIndex[mIndex]) {
        measuresByIndex[mIndex] = {
          index: mIndex,
          printedNumber: String(attr(measureNode, "number") ?? mIndex + 1),
          implicit: String(attr(measureNode, "implicit") || "no") === "yes",
          timeSig, keySigFifths: keyFifths, events: [],
        };
      }
      const measure = measuresByIndex[mIndex];

      for (const child of mKids) {
        const t = tagOf(child);
        if (t === "attributes") {
          const aK = kidsOf(child);
          const div = childText(aK, "divisions"); if (div != null) divisions = numOr(div, divisions);
          const timeNode = findChild(aK, "time");
          if (timeNode) {
            const tK = kidsOf(timeNode);
            timeSig = [numOr(childText(tK, "beats"), 4), numOr(childText(tK, "beat-type"), 4)];
            if (partIndex === 0) measure.timeSig = timeSig;
          }
          const keyNode = findChild(aK, "key");
          if (keyNode) { keyFifths = numOr(childText(kidsOf(keyNode), "fifths"), 0); if (partIndex === 0) measure.keySigFifths = keyFifths; }
          divisionsSeen.add(divisions);
        } else if (t === "note") {
          const nK = kidsOf(child);
          const isChord = has(nK, "chord");
          const isRest = has(nK, "rest");
          const isGrace = has(nK, "grace");
          const durDiv = numOr(childText(nK, "duration"), 0);
          const durQ = rat(durDiv, divisions);
          const voice = numOr(childText(nK, "voice"), 1);
          const staff = numOr(childText(nK, "staff"), 1);
          const tied = has(nK, "tie") || has(nK, "tied");
          const pitchNode = findChild(nK, "pitch");
          const midi = pitchNode ? pitchToMidi(kidsOf(pitchNode)) : null;

          if (isChord && lastNoteEvent) {
            // Chord member: share the previous note's onset, do not advance.
            if (midi != null) { lastNoteEvent.midis.push(midi); lastNoteEvent.pitches.push({ midi, tied }); lastNoteEvent.kind = "chord"; }
            continue;
          }
          const ev = {
            id: evId(), partId, staff, voice,
            kind: isRest ? "rest" : "note",
            onset: cursor, dur: durQ,
            midis: midi != null ? [midi] : [],
            pitches: midi != null ? [{ midi, tied }] : [],
            grace: isGrace,
          };
          measure.events.push(ev);
          lastNoteEvent = isRest ? null : ev;
          if (!isGrace) { cursor = add(cursor, durQ); }
        } else if (t === "backup") {
          cursor = sub(cursor, rat(numOr(childText(kidsOf(child), "duration"), 0), divisions));
          lastNoteEvent = null;
        } else if (t === "forward") {
          cursor = add(cursor, rat(numOr(childText(kidsOf(child), "duration"), 0), divisions));
          lastNoteEvent = null;
        } else if (t === "barline") {
          const bK = kidsOf(child);
          const repeat = findChild(bK, "repeat");
          const ending = findChild(bK, "ending");
          if (repeat) repeats.push({ kind: "repeat", direction: String(attr(repeat, "direction") || ""), measureIndex: mIndex });
          if (ending) repeats.push({ kind: "ending", number: String(attr(ending, "number") || ""), type: String(attr(ending, "type") || ""), measureIndex: mIndex });
        }
        if (compare(cursor, maxCursor) > 0) maxCursor = cursor;
      }
      // Actual content length of this measure (in quarters); pickup measures < nominal.
      if (partIndex === 0 || compare(maxCursor, measure._contentQ || rat(0, 1)) > 0) measure._contentQ = maxCursor;
    });
  });

  return finalize({ id, representationId, parts, measuresByIndex, repeats, divisionsSeen: [...divisionsSeen], warnings });
}

function finalize({ id, representationId, parts, measuresByIndex, repeats, divisionsSeen, warnings }) {
  const ticksPerQuarter = deriveResolution(divisionsSeen);
  let runningTick = 0;
  const measures = measuresByIndex.map((m) => {
    // Sort events by exact onset so multi-voice merges read in musical order.
    m.events.sort((a, b) => compare(a.onset, b.onset) || (a.staff - b.staff) || (a.voice - b.voice));
    let anyInexact = false;
    for (const ev of m.events) {
      const on = quartersToTick(ev.onset, ticksPerQuarter);
      const du = quartersToTick(ev.dur, ticksPerQuarter);
      ev.onsetTick = on.tick; ev.durationTicks = du.tick;
      if (!on.exact || !du.exact) anyInexact = true;
    }
    if (anyInexact) warnings.push(`measure ${m.index}: an onset/duration was not exactly representable at ticksPerQuarter=${ticksPerQuarter}`);
    const contentQ = m._contentQ || rat(0, 1);
    const durationTicks = quartersToTick(contentQ, ticksPerQuarter).tick;
    const out = {
      index: m.index, printedNumber: m.printedNumber, implicit: m.implicit,
      timeSig: m.timeSig, keySigFifths: m.keySigFifths,
      startTick: runningTick, durationTicks, durationQuarters: contentQ,
      events: m.events,
    };
    runningTick += durationTicks;
    return out;
  });
  return {
    entity: "scoreModel",
    id: id || `sm_${Date.now().toString(36)}`,
    representationId,
    parseVersion: 0,
    ticksPerQuarter,
    parts, measures, repeats, warnings,
  };
}
