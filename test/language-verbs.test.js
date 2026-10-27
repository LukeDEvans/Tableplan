import { describe, it, expect } from "vitest";
import { verbFor, conjugate, regularStem, verbsInEntries, commonVerbs, PERSONS, ruleNote } from "../language-verbs.js";
import { DUTCH_COURSE } from "../language-nl-starter.js";

const all = (inf, tense) => PERSONS.map((p) => conjugate(inf, tense, p)?.answer);

describe("language-verbs: stems", () => {
  it.each([
    ["werken", "werk"], ["maken", "maak"], ["wonen", "woon"], ["zitten", "zit"], ["leven", "leef"], ["reizen", "reis"],
    ["spelen", "speel"], ["leren", "leer"], ["betalen", "betaal"], ["wandelen", "wandel"], ["openen", "open"],
    ["luisteren", "luister"], ["studeren", "studeer"], ["bouwen", "bouw"], ["trainen", "train"], ["verven", "verf"],
    ["herhalen", "herhaal"], ["beloven", "beloof"], ["regenen", "regen"], ["sneeuwen", "sneeuw"], ["roepen", "roep"],
  ])("%s → %s", (inf, stem) => expect(regularStem(inf).stem).toBe(stem));

  it("unknown -eren stress is refused, not guessed", () => {
    expect(regularStem("ergeren")).toBeNull();
    expect(verbFor("ergeren")).toBeNull();
  });
});

describe("language-verbs: present", () => {
  it("regular", () => {
    expect(all("werken", "present")).toEqual(["werk", "werkt", "werkt", "werken", "werken", "werken"]);
    expect(all("zitten", "present")).toEqual(["zit", "zit", "zit", "zitten", "zitten", "zitten"]);
    expect(all("lezen", "present")).toEqual(["lees", "leest", "leest", "lezen", "lezen", "lezen"]);
    expect(all("worden", "present")).toEqual(["word", "wordt", "wordt", "worden", "worden", "worden"]);
  });
  it("irregular, with accepted alternatives", () => {
    expect(all("zijn", "present")).toEqual(["ben", "bent", "is", "zijn", "zijn", "zijn"]);
    expect(all("hebben", "present")).toEqual(["heb", "hebt", "heeft", "hebben", "hebben", "hebben"]);
    expect(all("gaan", "present")).toEqual(["ga", "gaat", "gaat", "gaan", "gaan", "gaan"]);
    expect(all("komen", "present")).toEqual(["kom", "komt", "komt", "komen", "komen", "komen"]);
    expect(conjugate("kunnen", "present", "jij")).toEqual({ answer: "kunt", alts: ["kan"] });
  });
});

describe("language-verbs: past ('t kofschip and strong verbs)", () => {
  it.each([
    ["werken", "werkte", "werkten"], ["wonen", "woonde", "woonden"], ["leven", "leefde", "leefden"],
    ["reizen", "reisde", "reisden"], ["praten", "praatte", "praatten"], ["branden", "brandde", "brandden"],
    ["fietsen", "fietste", "fietsten"], ["douchen", "douchte", "douchten"], ["spelen", "speelde", "speelden"],
    ["drinken", "dronk", "dronken"], ["lopen", "liep", "liepen"], ["zijn", "was", "waren"], ["kopen", "kocht", "kochten"],
  ])("%s → %s / %s", (inf, sg, pl) => {
    expect(conjugate(inf, "past", "ik").answer).toBe(sg);
    expect(conjugate(inf, "past", "wij").answer).toBe(pl);
  });
});

describe("language-verbs: perfect", () => {
  it.each([
    ["werken", "ik", "heb gewerkt"], ["praten", "hij", "heeft gepraat"], ["branden", "wij", "hebben gebrand"],
    ["betalen", "ik", "heb betaald"], ["vertellen", "jij", "hebt verteld"], ["gebruiken", "ik", "heb gebruikt"],
    ["herinneren", "ik", "heb herinnerd"], ["verhuizen", "wij", "zijn verhuisd"], ["gaan", "hij", "is gegaan"],
    ["eten", "ik", "heb gegeten"], ["beginnen", "ik", "ben begonnen"], ["bellen", "ik", "heb gebeld"],
    ["studeren", "zij", "hebben gestudeerd"], ["verven", "ik", "heb geverfd"],
  ])("%s, %s → %s", (inf, p, form) => expect(conjugate(inf, "perfect", p).answer).toBe(form));

  it("movement verbs accept either auxiliary", () => {
    expect(conjugate("lopen", "perfect", "ik")).toMatchObject({ answer: "heb gelopen", alts: ["ben gelopen"] });
    expect(conjugate("vergeten", "perfect", "ik")).toMatchObject({ answer: "ben vergeten", alts: ["heb vergeten"] });
  });
});

describe("language-verbs: what's left out", () => {
  it("separable, multi-word, reflexive and prefixed strong verbs", () => {
    expect(verbFor("opstaan")).toBeNull();
    expect(verbFor("afspreken")).toBeNull();
    expect(verbFor("zich wassen")).toBeNull();
    expect(verbFor("verzinnen")).toBeTruthy(); // regular present, but…
    expect(conjugate("verzinnen", "past", "ik")).toBeNull(); // …no guessed past
  });
  it("a verb that only looks regular gets the present only", () => {
    const v = verbFor("schelden", "to scold");
    expect(v.pastKnown).toBe(false);
    expect(conjugate(v, "present", "jij").answer).toBe("scheldt");
    expect(conjugate(v, "perfect", "ik")).toBeNull();
  });
  it("prefix + a strong verb outside the table is refused", () => {
    expect(verbFor("bezoeken")).toBeNull();
  });
});

describe("language-verbs: verbs from the course", () => {
  it("finds the starter verbs and every common verb is drillable in all tenses", () => {
    const found = verbsInEntries(DUTCH_COURSE.entries).map((v) => v.inf);
    for (const v of ["eten", "drinken", "lopen", "rennen", "lezen", "werken", "leren", "kopen", "betalen", "bellen"]) expect(found).toContain(v);
    for (const v of commonVerbs()) {
      for (const t of ["present", "past", "perfect"]) expect(conjugate(v, t, "ik"), `${v.inf} ${t}`).toBeTruthy();
      expect(v.en).toBeTruthy();
    }
  });
  it("rule notes", () => {
    expect(ruleNote(verbFor("werken"), "past")).toMatch(/-te/);
    expect(ruleNote(verbFor("wonen"), "past")).toMatch(/-de/);
    expect(ruleNote(verbFor("gaan"), "perfect")).toMatch(/zijn/);
  });
});
