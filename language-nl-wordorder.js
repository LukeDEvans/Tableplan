// Dutch word order practice (LANGUAGE_PRACTICE.md §21) — original sentences,
// written for the app (provisional, like the starter set). Each item gives the
// English, the first `start` words already in place, and the Dutch to build.
// `alts` lists other correct orders. Ids are permanent.

export const WORD_ORDER_RULES = Object.freeze({
  inversion: {
    title: "Verb second",
    rule: "When a sentence starts with something other than the subject — a time, a place — the verb comes second and the subject moves after it.",
  },
  question: {
    title: "Questions",
    rule: "A yes/no question starts with the verb. After a question word (wat, waar, wanneer, hoe…) the verb comes next.",
  },
  subclause: {
    title: "Verb at the end",
    rule: "After omdat, dat, als, of, toen and other linking words, the verb of that part goes to the end. If that part comes first, the main verb follows it straight away.",
  },
  verbend: {
    title: "Two verbs",
    rule: "With a helping verb (wil, kan, moet, ga, heb, ben), the helping verb stays second and the other verb goes to the end.",
  },
});

const I = [
  ["inversion", 1, "Morgen werk ik thuis.", "Tomorrow I'm working from home."],
  ["inversion", 1, "Vandaag is het mooi weer.", "Today the weather is nice."],
  ["inversion", 3, "In de winter fiets ik niet.", "In winter I don't cycle."],
  ["inversion", 3, "Na het eten drinken wij koffie.", "After dinner we drink coffee."],
  ["inversion", 2, "Op zaterdag gaan we naar de markt.", "On Saturday we go to the market."],
  ["inversion", 1, "Gisteren was ik moe.", "Yesterday I was tired."],
  ["inversion", 1, "Soms lees ik de krant.", "Sometimes I read the newspaper."],
  ["inversion", 3, "Om acht uur begint de les.", "The lesson starts at eight."],
  ["question", 0, "Woon je in Amsterdam?", "Do you live in Amsterdam?"],
  ["question", 1, "Waar woon je?", "Where do you live?"],
  ["question", 1, "Wat eet jij vanavond?", "What are you eating tonight?"],
  ["question", 0, "Heb je een fiets?", "Do you have a bike?"],
  ["question", 1, "Wanneer begint de film?", "When does the film start?"],
  ["question", 0, "Spreekt u Engels?", "Do you speak English?"],
  ["question", 2, "Hoe laat is het?", "What time is it?"],
  ["question", 0, "Hebben jullie al gegeten?", "Have you already eaten?"],
  ["subclause", 4, "Ik blijf thuis omdat ik ziek ben.", "I'm staying home because I'm ill."],
  ["subclause", 3, "Ik denk dat het morgen regent.", "I think it will rain tomorrow."],
  ["subclause", 4, "Ik weet niet of hij komt.", "I don't know if he's coming."],
  ["subclause", 3, "Ze zegt dat ze moe is.", "She says that she is tired."],
  ["subclause", 4, "Ik bel je als ik thuis ben.", "I'll call you when I'm home."],
  ["subclause", 4, "Hij leert Nederlands omdat hij in Nederland woont.", "He's learning Dutch because he lives in the Netherlands."],
  ["subclause", 1, "Als het mooi weer is, gaan we naar het strand.", "If the weather is nice, we'll go to the beach."],
  ["subclause", 1, "Toen ik jong was, woonde ik in Utrecht.", "When I was young, I lived in Utrecht."],
  ["verbend", 1, "Ik wil morgen fietsen.", "I want to cycle tomorrow."],
  ["verbend", 1, "Ik heb gisteren hard gewerkt.", "I worked hard yesterday."],
  ["verbend", 1, "We gaan vanavond pizza eten.", "We're going to eat pizza tonight."],
  ["verbend", 1, "Ik kan het niet vinden.", "I can't find it."],
  ["verbend", 1, "Zij is naar huis gegaan.", "She has gone home."],
  ["verbend", 1, "Je moet je huiswerk maken.", "You have to do your homework."],
  ["verbend", 1, "Morgen wil ik vroeg opstaan.", "Tomorrow I want to get up early."],
  ["verbend", 1, "Ik heb het boek nog niet gelezen.", "I haven't read the book yet."],
];

export const WORD_ORDER_ITEMS = Object.freeze(I.map(([rule, start, text, en, alts], i) => Object.freeze({
  id: `nl-wo-${String(i + 1).padStart(2, "0")}`,
  rule, start, text, en,
  ...(alts ? { alts } : {}),
})));
