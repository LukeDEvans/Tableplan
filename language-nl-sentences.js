// Dutch starter sentences — PROVISIONAL (LANGUAGE_PRACTICE.md §15).
//
// Original, simple sentences built from the starter set's words, one or more
// per starter lesson, for the Sentences exercise. Like the starter words they
// are not Rosetta Stone content. `alts` lists other correct word orders (time
// first or subject first). Ids are permanent: progress is keyed by them.

const S = [
  ["nl-s1-1", "De man heeft een hond.", "The man has a dog."],
  ["nl-s1-1", "Het meisje ziet een kat.", "The girl sees a cat."],
  ["nl-s1-1", "Het kind speelt met de hond.", "The child plays with the dog."],
  ["nl-s1-2", "Ik drink koffie met melk.", "I drink coffee with milk."],
  ["nl-s1-2", "Wij eten brood met kaas.", "We eat bread with cheese."],
  ["nl-s1-2", "De soep is warm.", "The soup is warm."],
  ["nl-s1-3", "Ik heb twee katten.", "I have two cats."],
  ["nl-s1-3", "Zij is tien jaar oud.", "She is ten years old."],
  ["nl-s1-4", "De appel is rood.", "The apple is red."],
  ["nl-s1-4", "Mijn jas is blauw.", "My coat is blue."],
  ["nl-s1-5", "De vis zwemt in het water.", "The fish swims in the water."],
  ["nl-s1-5", "Ik lees een boek.", "I'm reading a book."],
  ["nl-s1-5", "Het kind slaapt.", "The child is sleeping."],
  ["nl-s2-1", "Goedemorgen, hoe gaat het?", "Good morning, how are you?"],
  ["nl-s2-2", "Ik heet Anna.", "My name is Anna."],
  ["nl-s2-2", "Ik woon in Amerika.", "I live in America."],
  ["nl-s2-2", "Spreek jij Nederlands?", "Do you speak Dutch?"],
  ["nl-s2-3", "Mijn zus heet Emma.", "My sister's name is Emma."],
  ["nl-s2-3", "Mijn vader en moeder wonen in een groot huis.", "My father and mother live in a big house."],
  ["nl-s3-1", "De leraar stelt een vraag.", "The teacher asks a question."],
  ["nl-s3-1", "Ik maak mijn huiswerk.", "I'm doing my homework."],
  ["nl-s3-2", "Morgen werk ik op kantoor.", "Tomorrow I'm working at the office.", ["Ik werk morgen op kantoor."]],
  ["nl-s3-2", "De baas is erg druk.", "The boss is very busy."],
  ["nl-s4-1", "Hoeveel kost de tas?", "How much does the bag cost?"],
  ["nl-s4-1", "Ik betaal bij de kassa.", "I pay at the checkout."],
  ["nl-s4-1", "Dat is te duur.", "That is too expensive."],
  ["nl-s4-2", "De jurk is te klein.", "The dress is too small."],
  ["nl-s4-2", "Ik koop een nieuwe trui.", "I'm buying a new sweater."],
  ["nl-s5-1", "Wij gaan met de trein naar de stad.", "We're going to the city by train."],
  ["nl-s5-1", "Ik fiets naar mijn werk.", "I cycle to work."],
  ["nl-s5-2", "Waar is het station?", "Where is the station?"],
  ["nl-s5-2", "Ga rechtdoor en dan links.", "Go straight ahead and then left."],
  ["nl-s5-3", "De sleutel ligt op de tafel.", "The key is on the table."],
  ["nl-s5-3", "De keuken is beneden.", "The kitchen is downstairs."],
  ["nl-s6-1", "Vandaag is het maandag.", "Today is Monday.", ["Het is vandaag maandag."]],
  ["nl-s6-1", "Gisteren was ik thuis.", "Yesterday I was at home.", ["Ik was gisteren thuis."]],
  ["nl-s6-2", "Ik werk elke dag.", "I work every day."],
  ["nl-s6-2", "Volgende week gaan wij naar Amsterdam.", "Next week we're going to Amsterdam.", ["Wij gaan volgende week naar Amsterdam."]],
];

export const STARTER_SENTENCES = Object.freeze(S.map(([lesson, text, en, alts], i) => Object.freeze({
  id: `nl-ss-${String(i + 1).padStart(2, "0")}`,
  lang: "nl",
  text,
  en,
  lesson,
  unit: lesson.replace(/-\d+$/, ""),
  level: "nl-starter",
  source: "nl-starter-2026-10",
  verification: "provisional",
  ...(alts ? { alts } : {}),
})));
