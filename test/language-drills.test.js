import { describe, it, expect } from "vitest";
import {
  compareAnswer, gradeForTyped, speechMatches, deHetItems, weightedPick, listeningChoices,
  MINIMAL_PAIRS, soundQuestion, levenshtein, plain,
} from "../language-drills.js";
import { buildTiles, checkSentence, sentenceTokens, displaySentence } from "../language-sentences.js";
import { STARTER_SENTENCES } from "../language-nl-sentences.js";
import { DUTCH_COURSE } from "../language-nl-starter.js";
import { seededRng } from "../language-match.js";

describe("language-drills: typed answers", () => {
  it("exact ignores case and punctuation", () => {
    expect(compareAnswer("De Man.", "de man").result).toBe("exact");
    expect(compareAnswer("dank je wel", "Dank je wel!").result).toBe("exact");
  });
  it("close: accent, article, one slip", () => {
    expect(compareAnswer("een", "één")).toMatchObject({ result: "close", why: "accent" });
    expect(compareAnswer("man", "de man")).toMatchObject({ result: "close", why: "article" });
    expect(compareAnswer("het man", "de man")).toMatchObject({ result: "close", why: "article" });
    expect(compareAnswer("de vrow", "de vrouw")).toMatchObject({ result: "close", why: "typo" });
  });
  it("wrong otherwise, including short words with any slip", () => {
    expect(compareAnswer("de kat", "de hond").result).toBe("wrong");
    expect(compareAnswer("ne", "ja").result).toBe("wrong");
    expect(compareAnswer("", "ja").result).toBe("wrong");
  });
  it("alternatives count", () => {
    expect(compareAnswer("alstublieft", "alsjeblieft", ["alstublieft"]).result).toBe("exact");
  });
  it("grades: exact Good, close Hard, wrong Again", () => {
    expect([gradeForTyped("exact"), gradeForTyped("close"), gradeForTyped("wrong")]).toEqual([3, 2, 1]);
  });
  it("levenshtein basics", () => {
    expect(levenshtein("kat", "kat")).toBe(0);
    expect(levenshtein("kat", "kast")).toBe(1);
    expect(plain(" Hoe  gaat het? ")).toBe("hoe gaat het");
  });
});

describe("language-drills: speech", () => {
  it("any close guess passes; articles and accents don't matter", () => {
    expect(speechMatches(["Dag", "de man"], "de man").ok).toBe(true);
    expect(speechMatches(["man"], "de man").ok).toBe(true);
    expect(speechMatches(["hoe gaat het"], "Hoe gaat het?").ok).toBe(true);
    expect(speechMatches(["goedemorgen"], "goedemiddag").ok).toBe(false);
    expect(speechMatches([], "ja")).toEqual({ ok: false, heard: "", score: 0 });
  });
  it("short words need an exact hit", () => {
    expect(speechMatches(["nee"], "ja").ok).toBe(false);
    expect(speechMatches(["Ja!"], "ja").ok).toBe(true);
  });
});

describe("language-drills: de/het, choices, sounds", () => {
  it("one de/het item per noun, from 'de …'/'het …' entries only", () => {
    const items = deHetItems(DUTCH_COURSE.entries);
    expect(items.find((i) => i.noun === "meisje")).toMatchObject({ article: "het", en: "girl" });
    expect(items.filter((i) => i.noun === "man").length).toBe(1); // two lessons, one item
    expect(items.some((i) => i.noun.includes("?"))).toBe(false);
    expect(items.every((i) => ["de", "het"].includes(i.article))).toBe(true);
  });
  it("weighted picks are distinct and favor missed words", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}` }));
    let hits = 0;
    for (let s = 1; s <= 200; s += 1) {
      const p = weightedPick(items, 3, seededRng(s), (id) => (id === "x7" ? 10 : 0));
      expect(new Set(p.map((x) => x.id)).size).toBe(3);
      if (p.some((x) => x.id === "x7")) hits += 1;
    }
    expect(hits).toBeGreaterThan(100); // ~ (21 / 40) per pick → most rounds
  });
  it("listening choices: distinct written forms, include the target", () => {
    const pool = DUTCH_COURSE.entries;
    const t = pool[0];
    const c = listeningChoices(t, pool, 4, seededRng(2));
    expect(c.length).toBe(4);
    expect(c).toContain(t);
    expect(new Set(c.map((e) => plain(e.text))).size).toBe(4);
    expect(c.filter((e) => e.lesson === t.lesson).length).toBe(4);
  });
  it("sounds questions speak one side of a pair", () => {
    for (const pair of MINIMAL_PAIRS) {
      const q = soundQuestion(pair, seededRng(5));
      expect([pair.a, pair.b]).toContain(q.spoken);
      expect(q.choices.length).toBe(2);
      expect(pair.a.text).not.toBe(pair.b.text);
    }
  });
});

describe("language-sentences", () => {
  it("tokens drop final punctuation and commas, and lower-case the opener", () => {
    expect(sentenceTokens("Goedemorgen, hoe gaat het?")).toEqual(["goedemorgen", "hoe", "gaat", "het"]);
    expect(sentenceTokens("Ik woon in Amerika.")).toEqual(["ik", "woon", "in", "Amerika"]);
    expect(sentenceTokens("Amsterdam is mooi.")).toEqual(["Amsterdam", "is", "mooi"]);
  });
  it("tiles: the sentence's words plus distractors it doesn't use", () => {
    const s = STARTER_SENTENCES[0];
    const tiles = buildTiles(s, STARTER_SENTENCES, { extra: 2, rng: seededRng(9) });
    const own = sentenceTokens(s.text);
    expect(tiles.length).toBe(own.length + 2);
    const extra = tiles.map((t) => t.text).filter((t) => !own.includes(t));
    expect(extra.length).toBe(2);
    expect(new Set(tiles.map((t) => t.id)).size).toBe(tiles.length);
  });
  it("checking accepts the sentence and its listed alternatives", () => {
    const s = STARTER_SENTENCES.find((x) => x.alts);
    expect(checkSentence(sentenceTokens(s.text), s).ok).toBe(true);
    expect(checkSentence(sentenceTokens(s.alts[0]), s).ok).toBe(true);
    const wrong = checkSentence(["werk", "morgen", "ik", "op", "kantoor"], s);
    expect(wrong.ok).toBe(false);
    expect(wrong.marks.some((m) => !m)).toBe(true);
    const short = checkSentence(["morgen", "werk"], s);
    expect(short).toMatchObject({ ok: false, missing: 3 });
  });
  it("display adds a full stop only when needed", () => {
    expect(displaySentence("Ik lees")).toBe("Ik lees.");
    expect(displaySentence("Hoe gaat het?")).toBe("Hoe gaat het?");
  });
  it("every starter sentence's tiles rebuild it", () => {
    for (const s of STARTER_SENTENCES) expect(checkSentence(sentenceTokens(s.text), s).ok).toBe(true);
  });
});
