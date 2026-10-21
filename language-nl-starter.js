// Dutch starter course — PROVISIONAL (LANGUAGE_PRACTICE.md §4).
//
// This is NOT the Rosetta Stone list. Luke's course is the "November 2026"
// Rosetta Stone Dutch list, which wasn't available on 2026-10-20 (not in the
// repo, Drive or Gmail; Rosetta Stone's public course-contents PDFs are the 2011
// Classic edition and give unit/lesson titles only). Until that list arrives,
// this is an original set of common beginner words and phrases, grouped by
// everyday topic. No unit or lesson here claims to match a Rosetta Stone lesson,
// and every entry is marked "provisional".
//
// Verified Rosetta Stone lessons go in their own level, with their own source
// (kind "rosetta-stone", the curriculum version, the retrieval date), entries
// marked "verified". language-curriculum.js validateCourse() enforces that.
//
// Ids are stable forever (progress is keyed by them): add new ones at the end of
// a lesson, never renumber, never reuse.

const LANG = "nl";
const LEVEL = "nl-starter";
const SOURCE = "nl-starter-2026-10";

// [unitId, unitTitle, [[lessonNo, lessonTitle, [[Dutch, English, note?], …]], …]]
const UNITS = [
  ["nl-s1", "First words", [
    [1, "People and animals", [
      ["de man", "man"], ["de vrouw", "woman"], ["de jongen", "boy"], ["het meisje", "girl"],
      ["het kind", "child"], ["de hond", "dog"], ["de kat", "cat"], ["het paard", "horse"],
      ["de vogel", "bird"], ["de vis", "fish"],
    ]],
    [2, "Food and drink", [
      ["eten", "to eat"], ["drinken", "to drink"], ["het water", "water"], ["de melk", "milk"],
      ["het brood", "bread"], ["de appel", "apple"], ["de kaas", "cheese"], ["het ei", "egg"],
      ["de koffie", "coffee"], ["de thee", "tea"], ["de soep", "soup"], ["de suiker", "sugar"],
    ]],
    [3, "Numbers", [
      ["één", "one"], ["twee", "two"], ["drie", "three"], ["vier", "four"], ["vijf", "five"],
      ["zes", "six"], ["zeven", "seven"], ["acht", "eight"], ["negen", "nine"], ["tien", "ten"],
    ]],
    [4, "Colors", [
      ["rood", "red"], ["blauw", "blue"], ["groen", "green"], ["geel", "yellow"], ["wit", "white"],
      ["zwart", "black"], ["oranje", "orange"], ["bruin", "brown"], ["roze", "pink"], ["grijs", "gray"],
    ]],
    [5, "Everyday verbs", [
      ["lopen", "to walk"], ["rennen", "to run"], ["zwemmen", "to swim"], ["lezen", "to read"],
      ["schrijven", "to write"], ["slapen", "to sleep"], ["koken", "to cook"], ["spelen", "to play"],
      ["zien", "to see"], ["horen", "to hear"],
    ]],
  ]],
  ["nl-s2", "Hello and goodbye", [
    [1, "Greetings", [
      ["hallo", "hello"], ["goedemorgen", "good morning"], ["goedemiddag", "good afternoon"],
      ["goedenavond", "good evening"], ["welterusten", "good night", "said at bedtime"],
      ["tot ziens", "goodbye"], ["dank je wel", "thank you"], ["alsjeblieft", "please (informal)"],
      ["alstublieft", "please (formal)"], ["ja", "yes"], ["nee", "no"], ["pardon", "excuse me"],
    ]],
    [2, "Introductions", [
      ["Hoe gaat het?", "How are you?"], ["Het gaat goed.", "I'm doing well."],
      ["Mijn naam is …", "My name is …"], ["Hoe heet je?", "What's your name?"],
      ["Leuk je te ontmoeten.", "Nice to meet you."], ["Waar kom je vandaan?", "Where are you from?"],
      ["Ik kom uit Amerika.", "I'm from America."], ["Ik spreek een beetje Nederlands.", "I speak a little Dutch."],
      ["Ik begrijp het niet.", "I don't understand."], ["Kunt u dat herhalen?", "Could you repeat that?"],
    ]],
    [3, "Family", [
      ["de vader", "father"], ["de moeder", "mother"], ["de broer", "brother"], ["de zus", "sister"],
      ["de zoon", "son"], ["de dochter", "daughter"], ["de opa", "grandpa"], ["de oma", "grandma"],
      ["de man", "husband", "also \"man\""], ["de vrouw", "wife", "also \"woman\""],
    ]],
  ]],
  ["nl-s3", "Work and school", [
    [1, "At school", [
      ["de leraar", "teacher"], ["het boek", "book"], ["de tafel", "table"], ["de stoel", "chair"],
      ["de school", "school"], ["het huiswerk", "homework"], ["de vraag", "question"],
      ["het antwoord", "answer"], ["leren", "to learn"], ["het potlood", "pencil"],
    ]],
    [2, "At work", [
      ["werken", "to work"], ["het kantoor", "office"], ["de baas", "boss"], ["de collega", "colleague"],
      ["de vergadering", "meeting"], ["de klant", "customer"], ["bellen", "to call"],
      ["het bureau", "desk"], ["druk", "busy"], ["de pauze", "break"],
    ]],
  ]],
  ["nl-s4", "Shopping", [
    [1, "In the shop", [
      ["de winkel", "shop"], ["de markt", "market"], ["kopen", "to buy"], ["betalen", "to pay"],
      ["het geld", "money"], ["duur", "expensive"], ["goedkoop", "cheap"],
      ["Hoeveel kost het?", "How much does it cost?"], ["de kassa", "checkout"], ["de tas", "bag"],
    ]],
    [2, "Clothes", [
      ["de jas", "coat"], ["de schoen", "shoe"], ["de broek", "pants"], ["de jurk", "dress"],
      ["het overhemd", "shirt"], ["de trui", "sweater"], ["de sok", "sock"], ["de hoed", "hat"],
      ["groot", "big"], ["klein", "small"],
    ]],
  ]],
  ["nl-s5", "Getting around", [
    [1, "Travel", [
      ["de trein", "train"], ["de fiets", "bicycle"], ["de auto", "car"], ["het vliegtuig", "airplane"],
      ["de boot", "boat"], ["de straat", "street"], ["de stad", "city"], ["het kaartje", "ticket"],
      ["het vliegveld", "airport"], ["de reis", "trip"],
    ]],
    [2, "Directions", [
      ["links", "left"], ["rechts", "right"], ["rechtdoor", "straight ahead"], ["hier", "here"],
      ["daar", "there"], ["dichtbij", "nearby"], ["ver", "far"], ["Waar is …?", "Where is …?"],
      ["de kaart", "map"], ["de hoek", "corner"],
    ]],
    [3, "At home", [
      ["het huis", "house"], ["de kamer", "room"], ["de keuken", "kitchen"], ["de deur", "door"],
      ["het raam", "window"], ["het bed", "bed"], ["de badkamer", "bathroom"], ["de tuin", "garden"],
      ["de trap", "stairs"], ["de sleutel", "key"],
    ]],
  ]],
  ["nl-s6", "Time", [
    [1, "Days", [
      ["maandag", "Monday"], ["dinsdag", "Tuesday"], ["woensdag", "Wednesday"], ["donderdag", "Thursday"],
      ["vrijdag", "Friday"], ["zaterdag", "Saturday"], ["zondag", "Sunday"], ["vandaag", "today"],
      ["morgen", "tomorrow"], ["gisteren", "yesterday"],
    ]],
    [2, "Time words", [
      ["de dag", "day"], ["de week", "week"], ["de maand", "month"], ["het jaar", "year"],
      ["de middag", "afternoon"], ["de avond", "evening"], ["de nacht", "night"], ["nu", "now"],
      ["altijd", "always"], ["nooit", "never"],
    ]],
  ]],
];

function build() {
  const units = [];
  const entries = [];
  for (const [unitId, unitTitle, lessons] of UNITS) {
    const unit = { id: unitId, title: unitTitle, lessons: [] };
    for (const [no, title, words] of lessons) {
      const lessonId = `${unitId}-${no}`;
      unit.lessons.push({ id: lessonId, title });
      words.forEach(([text, en, note], i) => {
        entries.push({
          id: `${lessonId}-${String(i + 1).padStart(2, "0")}`,
          lang: LANG,
          text,
          en,
          level: LEVEL,
          unit: unitId,
          lesson: lessonId,
          source: SOURCE,
          verification: "provisional",
          ...(note ? { note } : {}),
        });
      });
    }
    units.push(unit);
  }
  return { units, entries };
}

const { units, entries } = build();

export const DUTCH_COURSE = Object.freeze({
  lang: LANG,
  label: "Dutch",
  sources: {
    [SOURCE]: {
      kind: "original",
      title: "Live starter set — common beginner Dutch, written for the app",
      retrieved: "2026-10-20",
      confidence: "Translations checked by hand; not tied to any Rosetta Stone lesson",
      curriculumVersion: null,
    },
  },
  levels: [{ id: LEVEL, title: "Starter (provisional)", provisional: true, units }],
  entries,
});
