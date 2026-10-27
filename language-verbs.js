// Dutch verb forms for the conjugation drill (LANGUAGE_PRACTICE.md §20). Pure.
//
// conjugate(infinitive, tense, person) → { answer, alts?, aux?, participle? } or null
//   tense:  "present" | "past" | "perfect"
//   person: "ik" | "jij" | "hij" | "wij" | "jullie" | "zij"   (hij = hij/zij/het; zij = they)
//
// Two sources:
//  - IRREGULAR: a table of the common strong and irregular verbs (and weak verbs
//    whose perfect takes "zijn"). Forms are written out in full.
//  - The regular (weak) rules: the stem (spelling rules for vowels, double
//    consonants, v→f and z→s), "'t kofschip" for -te/-de, ge-…-t/-d.
//
// A wrong form taught as right is worse than none, so verbFor() returns null for
// anything the rules can't be sure of: separable verbs (opstaan), multi-word or
// reflexive verbs, an inseparable prefix on a strong verb (vertrekken), words
// with a diaeresis, and -eren verbs whose stress isn't known (studeren is
// "studeer", weigeren is "weiger"). Those are simply left out of the drill.

export const PERSONS = Object.freeze(["ik", "jij", "hij", "wij", "jullie", "zij"]);
export const PERSON_LABEL = Object.freeze({ ik: "ik", jij: "jij", hij: "hij / zij", wij: "wij", jullie: "jullie", zij: "zij (they)" });
export const TENSES = Object.freeze(["present", "past", "perfect"]);
export const TENSE_LABEL = Object.freeze({ present: "Present", past: "Past", perfect: "Perfect" });
const PLURAL = new Set(["wij", "jullie", "zij"]);

// inf: [en, pastSingular, pastPlural, participle, aux ("hebben" | "zijn" | "zijn|hebben"), present?]
// present (only where it isn't regular): [ik, jij, hij] — plural is the infinitive;
// a "a|b" value accepts either form, the first is shown.
const T = {
  zijn: ["to be", "was", "waren", "geweest", "zijn", ["ben", "bent", "is"], ["zijn", "zijn", "zijn"]],
  hebben: ["to have", "had", "hadden", "gehad", "hebben", ["heb", "hebt|heb", "heeft"]],
  kunnen: ["can, to be able to", "kon", "konden", "gekund", "hebben", ["kan", "kunt|kan", "kan"]],
  willen: ["to want", "wilde|wou", "wilden", "gewild", "hebben", ["wil", "wilt|wil", "wil"]],
  zullen: ["shall, will", "zou", "zouden", null, "hebben", ["zal", "zult|zal", "zal"]],
  mogen: ["may, to be allowed to", "mocht", "mochten", "gemogen", "hebben", ["mag", "mag", "mag"]],
  moeten: ["must, to have to", "moest", "moesten", "gemoeten", "hebben"],
  gaan: ["to go", "ging", "gingen", "gegaan", "zijn", ["ga", "gaat", "gaat"]],
  staan: ["to stand", "stond", "stonden", "gestaan", "hebben", ["sta", "staat", "staat"]],
  slaan: ["to hit", "sloeg", "sloegen", "geslagen", "hebben", ["sla", "slaat", "slaat"]],
  doen: ["to do", "deed", "deden", "gedaan", "hebben", ["doe", "doet", "doet"]],
  zien: ["to see", "zag", "zagen", "gezien", "hebben", ["zie", "ziet", "ziet"]],
  komen: ["to come", "kwam", "kwamen", "gekomen", "zijn", ["kom", "komt", "komt"]],
  worden: ["to become", "werd", "werden", "geworden", "zijn"],
  weten: ["to know (a fact)", "wist", "wisten", "geweten", "hebben"],
  zeggen: ["to say", "zei", "zeiden", "gezegd", "hebben"],
  vragen: ["to ask", "vroeg", "vroegen", "gevraagd", "hebben"],
  kopen: ["to buy", "kocht", "kochten", "gekocht", "hebben"],
  zoeken: ["to look for", "zocht", "zochten", "gezocht", "hebben"],
  brengen: ["to bring", "bracht", "brachten", "gebracht", "hebben"],
  denken: ["to think", "dacht", "dachten", "gedacht", "hebben"],
  eten: ["to eat", "at", "aten", "gegeten", "hebben"],
  drinken: ["to drink", "dronk", "dronken", "gedronken", "hebben"],
  lopen: ["to walk", "liep", "liepen", "gelopen", "hebben|zijn"],
  rijden: ["to drive, to ride", "reed", "reden", "gereden", "hebben|zijn"],
  schrijven: ["to write", "schreef", "schreven", "geschreven", "hebben"],
  blijven: ["to stay", "bleef", "bleven", "gebleven", "zijn"],
  lezen: ["to read", "las", "lazen", "gelezen", "hebben"],
  geven: ["to give", "gaf", "gaven", "gegeven", "hebben"],
  nemen: ["to take", "nam", "namen", "genomen", "hebben"],
  spreken: ["to speak", "sprak", "spraken", "gesproken", "hebben"],
  helpen: ["to help", "hielp", "hielpen", "geholpen", "hebben"],
  beginnen: ["to begin", "begon", "begonnen", "begonnen", "zijn"],
  vinden: ["to find", "vond", "vonden", "gevonden", "hebben"],
  zingen: ["to sing", "zong", "zongen", "gezongen", "hebben"],
  zwemmen: ["to swim", "zwom", "zwommen", "gezwommen", "hebben|zijn"],
  liggen: ["to lie (down)", "lag", "lagen", "gelegen", "hebben"],
  zitten: ["to sit", "zat", "zaten", "gezeten", "hebben"],
  slapen: ["to sleep", "sliep", "sliepen", "geslapen", "hebben"],
  roepen: ["to call out", "riep", "riepen", "geroepen", "hebben"],
  laten: ["to let", "liet", "lieten", "gelaten", "hebben"],
  vallen: ["to fall", "viel", "vielen", "gevallen", "zijn"],
  houden: ["to hold", "hield", "hielden", "gehouden", "hebben"],
  hangen: ["to hang", "hing", "hingen", "gehangen", "hebben"],
  krijgen: ["to get, to receive", "kreeg", "kregen", "gekregen", "hebben"],
  kijken: ["to look, to watch", "keek", "keken", "gekeken", "hebben"],
  verliezen: ["to lose", "verloor", "verloren", "verloren", "hebben"],
  vergeten: ["to forget", "vergat", "vergaten", "vergeten", "zijn|hebben"],
  begrijpen: ["to understand", "begreep", "begrepen", "begrepen", "hebben"],
  sterven: ["to die", "stierf", "stierven", "gestorven", "zijn"],
  trekken: ["to pull", "trok", "trokken", "getrokken", "hebben"],
  breken: ["to break", "brak", "braken", "gebroken", "hebben"],
  dragen: ["to carry, to wear", "droeg", "droegen", "gedragen", "hebben"],
  wassen: ["to wash", "waste", "wasten", "gewassen", "hebben"],
  bakken: ["to bake", "bakte", "bakten", "gebakken", "hebben"],
  lachen: ["to laugh", "lachte", "lachten", "gelachen", "hebben"],
  heten: ["to be called", "heette", "heetten", "geheten", "hebben"],
  winnen: ["to win", "won", "wonnen", "gewonnen", "hebben"],
  vliegen: ["to fly", "vloog", "vlogen", "gevlogen", "hebben|zijn"],
  sluiten: ["to close", "sloot", "sloten", "gesloten", "hebben"],
  verdwijnen: ["to disappear", "verdween", "verdwenen", "verdwenen", "zijn"],
  bijten: ["to bite", "beet", "beten", "gebeten", "hebben"],
  genieten: ["to enjoy", "genoot", "genoten", "genoten", "hebben"],
  bieden: ["to offer", "bood", "boden", "geboden", "hebben"],
  verbieden: ["to forbid", "verbood", "verboden", "verboden", "hebben"],
  vangen: ["to catch", "ving", "vingen", "gevangen", "hebben"],
  ontvangen: ["to receive", "ontving", "ontvingen", "ontvangen", "hebben"],
  binden: ["to tie", "bond", "bonden", "gebonden", "hebben"],
  verbinden: ["to connect", "verbond", "verbonden", "verbonden", "hebben"],
  springen: ["to jump", "sprong", "sprongen", "gesprongen", "hebben|zijn"],
  stinken: ["to stink", "stonk", "stonken", "gestonken", "hebben"],
  schieten: ["to shoot", "schoot", "schoten", "geschoten", "hebben"],
  snijden: ["to cut", "sneed", "sneden", "gesneden", "hebben"],
  lijken: ["to seem, to look like", "leek", "leken", "geleken", "hebben"],
  wijzen: ["to point", "wees", "wezen", "gewezen", "hebben"],
  zwijgen: ["to be silent", "zweeg", "zwegen", "gezwegen", "hebben"],
  kruipen: ["to crawl", "kroop", "kropen", "gekropen", "hebben|zijn"],
  ruiken: ["to smell", "rook", "roken", "geroken", "hebben"],
  buigen: ["to bend", "boog", "bogen", "gebogen", "hebben"],
  liegen: ["to lie (not tell the truth)", "loog", "logen", "gelogen", "hebben"],
  meten: ["to measure", "mat", "maten", "gemeten", "hebben"],
  stelen: ["to steal", "stal", "stalen", "gestolen", "hebben"],
  wegen: ["to weigh", "woog", "wogen", "gewogen", "hebben"],
  steken: ["to stab, to sting", "stak", "staken", "gestoken", "hebben"],
  werpen: ["to throw", "wierp", "wierpen", "geworpen", "hebben"],
  vechten: ["to fight", "vocht", "vochten", "gevochten", "hebben"],
  genezen: ["to heal", "genas", "genazen", "genezen", "zijn|hebben"],
  bevelen: ["to order, to command", "beval", "bevalen", "bevolen", "hebben"],
  vertrekken: ["to leave, to depart", "vertrok", "vertrokken", "vertrokken", "zijn"],
  verlaten: ["to leave (a place)", "verliet", "verlieten", "verlaten", "hebben"],
  bekijken: ["to look at", "bekeek", "bekeken", "bekeken", "hebben"],
  verkopen: ["to sell", "verkocht", "verkochten", "verkocht", "hebben"],
  ontbijten: ["to have breakfast", "ontbeet", "ontbeten", "ontbeten", "hebben"],
  verstaan: ["to understand (hear)", "verstond", "verstonden", "verstaan", "hebben", ["versta", "verstaat", "verstaat"]],
  bestaan: ["to exist", "bestond", "bestonden", "bestaan", "hebben", ["besta", "bestaat", "bestaat"]],
  ontstaan: ["to arise", "ontstond", "ontstonden", "ontstaan", "zijn", ["ontsta", "ontstaat", "ontstaat"]],
  fluiten: ["to whistle", "floot", "floten", "gefloten", "hebben"],
  duiken: ["to dive", "dook", "doken", "gedoken", "hebben|zijn"],
  schenken: ["to pour, to give", "schonk", "schonken", "geschonken", "hebben"],
  klimmen: ["to climb", "klom", "klommen", "geklommen", "hebben|zijn"],
  glijden: ["to slide", "gleed", "gleden", "gegleden", "hebben|zijn"],
  schrikken: ["to be startled", "schrok", "schrokken", "geschrokken", "zijn"],
  zenden: ["to send", "zond", "zonden", "gezonden", "hebben"],
  gieten: ["to pour", "goot", "goten", "gegoten", "hebben"],
  kiezen: ["to choose", "koos", "kozen", "gekozen", "hebben"],
  // Weak verbs whose perfect takes "zijn" (or either, with movement).
  verhuizen: ["to move (house)", null, null, null, "zijn"],
  trouwen: ["to get married", null, null, null, "zijn"],
  gebeuren: ["to happen", null, null, null, "zijn"],
  groeien: ["to grow", null, null, null, "zijn"],
  reizen: ["to travel", null, null, null, "hebben|zijn"],
  rennen: ["to run", null, null, null, "hebben|zijn"],
  fietsen: ["to cycle", null, null, null, "hebben|zijn"],
  wandelen: ["to walk, to hike", null, null, null, "hebben|zijn"],
  stoppen: ["to stop", null, null, null, "hebben|zijn"],
  landen: ["to land", null, null, null, "zijn"],
  lukken: ["to succeed (it works)", null, null, null, "zijn"],
  slagen: ["to pass, to succeed", null, null, null, "zijn"],
};

// Weak (regular) verbs known to follow the rules in the past too. Past and
// perfect are drilled only for these and the table above: many verbs that look
// regular are strong (lezen, geven, kijken), so nothing else is guessed.
const WEAK_KNOWN = new Set([
  "werken", "wonen", "maken", "spelen", "leren", "praten", "betalen", "bellen", "koken", "horen",
  "leven", "luisteren", "antwoorden", "wachten", "hopen", "missen", "kussen", "dansen", "poetsen",
  "studeren", "proberen", "gebruiken", "verdienen", "dienen", "huilen", "bouwen", "ontmoeten", "vertellen",
  "bestellen", "herhalen", "beloven", "geloven", "openen", "tekenen", "rekenen", "veranderen", "herinneren",
  "zetten", "plaatsen", "leggen", "branden", "starten", "wensen", "tellen", "delen", "sturen", "kloppen",
  "kennen", "noemen", "volgen", "voelen", "vullen", "rusten", "mailen", "parkeren", "reserveren",
  "controleren", "organiseren", "presenteren", "informeren", "feliciteren", "plannen", "trainen", "ademen",
  "oefenen", "verbeteren", "danken", "bedanken", "groeten", "schudden", "pakken", "drukken", "klikken",
  "duren", "kosten", "regenen", "sneeuwen", "fietsen", "wandelen", "reizen", "rennen", "verhuizen",
  "trouwen", "gebeuren", "groeien", "stoppen", "landen", "lukken", "slagen", "verwachten", "hoesten",
  "juichen", "ruilen", "ruimen", "kammen", "douchen", "huren", "verhuren", "zeilen", "roeien",
  "schaatsen", "tennissen", "voetballen", "zwaaien", "knippen", "plakken", "kleuren", "verven",
]);

// Common verbs offered in the drill even when they're not in your lessons.
export const COMMON_VERBS = Object.freeze([
  "zijn", "hebben", "gaan", "komen", "doen", "zien", "kunnen", "willen", "moeten", "mogen",
  "eten", "drinken", "lezen", "schrijven", "spreken", "nemen", "geven", "kopen", "zeggen", "vragen",
  "denken", "weten", "werken", "wonen", "maken", "spelen", "leren", "praten", "betalen", "bellen",
  "slapen", "lopen", "fietsen", "blijven", "beginnen", "vinden", "zitten", "staan", "kijken", "krijgen",
]);
const COMMON_EN = { werken: "to work", wonen: "to live", maken: "to make", spelen: "to play", leren: "to learn", praten: "to talk", betalen: "to pay", bellen: "to call (phone)" };

// -eren verbs: stress decides the stem. Known stressed ones (studeer), and
// known unstressed ones (luister); any other -eren verb is left out.
const STRESSED_EREN = new Set(["studeren", "proberen", "reageren", "repareren", "noteren", "controleren", "presenteren", "reserveren", "accepteren", "feliciteren", "parkeren", "installeren", "registreren", "regeren", "serveren", "passeren", "emigreren", "citeren", "waarderen", "interesseren", "informeren", "telefoneren", "organiseren", "functioneren", "combineren"]);
const STRESSED_EREN_RE = /(iseren|ificeren|ineren|oneren|uleren)$/;
const SCHWA_EREN = new Set(["luisteren", "veranderen", "herinneren", "weigeren", "verbeteren", "hinderen", "vergaderen", "bewonderen", "verzekeren", "verhinderen", "plunderen", "slingeren", "schitteren", "fladderen", "wandelen"]);

// "er-" is left out on purpose: erkennen is er+kennen but ergeren is not, so
// verbs starting with "er" are refused for past forms (see verbFor).
const INSEPARABLE = ["be", "ge", "her", "ont", "ver"];
const SEPARABLE = ["aan", "af", "bij", "door", "in", "mee", "na", "om", "op", "over", "terug", "toe", "uit", "weg", "samen", "thuis", "langs", "vast", "los", "voor", "voorbij", "tegen", "neer", "rond", "binnen", "buiten"];
const VOWELS = "aeiouy";
const isVowel = (c) => VOWELS.includes(c);
const vowelGroups = (s) => (String(s).match(/[aeiouy]+/g) || []).length;

const pick = (v) => String(v).split("|")[0];
const altsOf = (v) => String(v).split("|").slice(1);

function inseparablePrefix(inf) {
  for (const p of INSEPARABLE) {
    if (!inf.startsWith(p)) continue;
    const rest = inf.slice(p.length);
    // The rest must be a verb in its own right: a vowel before its -en, and a
    // possible word start (not "llen" from "bellen").
    const restBase = rest.replace(/en$/, "");
    const okStart = isVowel(rest[0]) ? rest.length >= 5 : !/^([b-df-hj-np-tv-z])\1/.test(rest);
    if (rest.length >= 4 && /en$/.test(rest) && vowelGroups(restBase) >= 1 && okStart) return p;
  }
  return "";
}

function looksSeparable(inf) {
  return SEPARABLE.some((p) => inf.startsWith(p) && inf.length - p.length >= 4 && /en$/.test(inf.slice(p.length)) && vowelGroups(inf.slice(p.length).replace(/en$/, "")) >= 1);
}

// The stem by the spelling rules, plus the consonant 't kofschip looks at
// (before v→f / z→s). null when unsure.
export function regularStem(inf) {
  if (!/^[a-z]+en$/.test(inf)) return null;
  let base = inf.slice(0, -2);
  // Double consonant → single (zitten → zit, bakken → bak).
  if (base.length >= 2 && base[base.length - 1] === base[base.length - 2] && !isVowel(base[base.length - 1])) {
    base = base.slice(0, -1);
  } else {
    const m = base.match(/^(.*)([aeiou])([^aeiouyj])$/);
    if (m && !isVowel(m[1].slice(-1) || "x") && m[1].slice(-1) !== "i") {
      const vowel = m[2];
      const prefix = inseparablePrefix(inf);
      const core = base.slice(prefix.length);
      let double;
      if (vowel === "i") double = false;
      else if (vowel !== "e") double = true;
      else if (vowelGroups(core) <= 1) double = true;
      else if (/eren$/.test(inf)) {
        if (STRESSED_EREN.has(inf) || STRESSED_EREN_RE.test(inf)) double = true;
        else if (SCHWA_EREN.has(inf)) double = false;
        else return null; // stress unknown
      } else double = false; // -elen / -enen / -emen …: unstressed
      if (double) base = `${m[1]}${vowel}${vowel}${m[3]}`;
    }
  }
  const kof = base;
  let stem = base;
  if (/v$/.test(stem)) stem = `${stem.slice(0, -1)}f`;
  else if (/z$/.test(stem)) stem = `${stem.slice(0, -1)}s`;
  return { stem, kof };
}

const KOFSCHIP = /(t|k|f|s|ch|p|x)$/;

// Everything about one verb, or null if it can't be drilled safely.
// `pastKnown` is false when only the present can be trusted.
export function verbFor(infinitive, en = "") {
  const inf = String(infinitive || "").trim().toLowerCase();
  if (!/^[a-z]+$/.test(inf)) return null; // multi-word, reflexive, diaeresis
  const row = T[inf];
  if (row && row[1]) {
    const [ten, pastSg, pastPl, part, aux, pres, presPl] = row;
    const st = pres ? null : regularStem(inf);
    if (!pres && !st) return null;
    const present = pres
      ? { ik: pres[0], jij: pres[1], hij: pres[2], wij: presPl?.[0] || inf, jullie: presPl?.[1] || inf, zij: presPl?.[2] || inf }
      : regularPresent(inf, st.stem);
    return { inf, en: en || ten, present, pastSg, pastPl, participle: part, aux, strong: true, pastKnown: true };
  }
  if (looksSeparable(inf)) return null;
  const prefix = inseparablePrefix(inf);
  if (prefix && T[inf.slice(prefix.length)]) return null; // ver+kopen etc.: not the regular pattern
  const st = regularStem(inf);
  if (!st) return null;
  const { stem, kof } = st;
  const out = { inf, en: en || row?.[0] || COMMON_EN[inf] || "", present: regularPresent(inf, stem), strong: false, pastKnown: false };
  if (!WEAK_KNOWN.has(inf) || /^er[^aeiou]/.test(inf)) return out;
  const tde = KOFSCHIP.test(kof) ? "t" : "d";
  const end = stem.endsWith(tde) ? "" : tde;
  return {
    ...out,
    pastKnown: true,
    pastSg: `${stem}${tde}e`,
    pastPl: `${stem}${tde}en`,
    participle: `${prefix ? "" : "ge"}${stem}${end}`,
    aux: row?.[4] || "hebben",
  };
}

function regularPresent(inf, stem) {
  const t = stem.endsWith("t") ? stem : `${stem}t`;
  return { ik: stem, jij: t, hij: t, wij: inf, jullie: inf, zij: inf };
}

const AUX = {
  hebben: { ik: "heb", jij: "hebt", hij: "heeft", wij: "hebben", jullie: "hebben", zij: "hebben" },
  zijn: { ik: "ben", jij: "bent", hij: "is", wij: "zijn", jullie: "zijn", zij: "zijn" },
};

export function conjugate(verb, tense, person) {
  const v = typeof verb === "string" ? verbFor(verb) : verb;
  if (!v || !PERSONS.includes(person)) return null;
  if (tense === "present") {
    const f = v.present[person];
    return { answer: pick(f), alts: altsOf(f) };
  }
  if (tense === "past") {
    if (!v.pastKnown) return null;
    const f = PLURAL.has(person) ? v.pastPl : v.pastSg;
    return { answer: pick(f), alts: altsOf(f) };
  }
  if (tense === "perfect") {
    if (!v.pastKnown || !v.participle) return null;
    const auxes = String(v.aux).split("|");
    const forms = auxes.map((a) => `${AUX[a][person]} ${v.participle}`);
    return { answer: forms[0], alts: forms.slice(1), aux: auxes[0], participle: v.participle };
  }
  return null;
}

// Verbs in a set of course entries: single-word infinitives whose English
// starts with "to " (or that the table knows), and that can be drilled safely.
export function verbsInEntries(entries) {
  const out = [];
  const seen = new Set();
  for (const e of entries || []) {
    const text = String(e?.text || "").trim().toLowerCase();
    const en = String(e?.en || "").trim();
    if (!text || seen.has(text)) continue;
    if (!/^to\s/i.test(en) && !T[text]) continue;
    const v = verbFor(text, en);
    if (!v) continue;
    seen.add(text);
    out.push({ ...v, entryId: e.id || "" });
  }
  return out;
}

export function commonVerbs() {
  return COMMON_VERBS.map((inf) => verbFor(inf)).filter(Boolean);
}

// One-line reminder of the rule behind a form, shown after an answer.
export function ruleNote(v, tense) {
  if (tense === "present") {
    if (v.strong && T[v.inf]?.[5]) return `${v.inf} is irregular in the present.`;
    return "ik + stem · jij/hij + stem + t · plural = the infinitive.";
  }
  if (tense === "past") {
    if (v.strong) return `${v.inf} is a strong verb: its past is ${pick(v.pastSg)} / ${v.pastPl}.`;
    return KOFSCHIP.test(regularStem(v.inf)?.kof || "") ? "Stem ends in a 't kofschip letter (t k f s ch p) → -te / -ten." : "Stem doesn't end in a 't kofschip letter → -de / -den.";
  }
  if (tense === "perfect") {
    const aux = String(v.aux).includes("zijn") ? (v.aux === "zijn" ? "Uses zijn (movement or change)." : "Uses hebben, or zijn with a destination.") : "Uses hebben.";
    return `${v.strong ? `Strong: ${v.participle}.` : "Regular: ge + stem + t/d."} ${aux}`;
  }
  return "";
}
