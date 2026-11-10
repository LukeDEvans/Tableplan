// Built-in templates (SLIDES_DESIGN.md §4): real presentations made in code, each in a
// theme that suits it, with placeholder text to type over and speaker-note hints. They
// ship with the app (no server). Pictures are left as soft boxes to fill with your own.

import { writeJson, linesJson } from "./text.js";
import { themeById } from "./themes.js";
import { esc } from "./chrome.js";
import { openDialog } from "../editor/panels.js";

export const TEMPLATES = Object.freeze([
  { id: "blank", name: "Blank", theme: "plain", blurb: "A title slide, nothing else" },
  { id: "trip", name: "Trip recap", theme: "coastal", blurb: "Where you went, day by day, with photos" },
  { id: "album", name: "Photo album", theme: "gallery", blurb: "Big photos with short captions" },
  { id: "year", name: "Family year in review", theme: "household", blurb: "Month by month highlights" },
  { id: "pitch", name: "Business pitch", theme: "urbangreens", blurb: "Problem, solution, numbers, ask" },
  { id: "update", name: "Project update", theme: "studio", blurb: "Where things stand and what's next" },
  { id: "talk", name: "Talk or lesson", theme: "paper", blurb: "Big ideas, one per slide" },
  { id: "event", name: "Party or event", theme: "sunset", blurb: "When, where, and what to bring" },
]);

// A slide spec: { layout, texts: { role: lines | { lines, bullets } }, notes, extra: [items], bg }
function addSlides(model, specs) {
  const first = model.slideIds()[0];
  const [W, H] = model.size();
  specs.forEach((sp, i) => {
    const sid = i === 0 ? first : model.addSlide({ layout: sp.layout });
    if (i === 0) model.setLayout(sid, sp.layout);
    if (sp.bg) model.setSlide(sid, { bg: sp.bg });
    for (const it of model.items(sid)) {
      const t = sp.texts?.[it.role];
      if (!t) continue;
      const json = Array.isArray(t) ? linesJson(t) : linesJson(t.lines, { bullets: !!t.bullets });
      writeJson(model.text(sid, it.id), json);
    }
    if (sp.notes) writeJson(model.notes(sid), linesJson([sp.notes]));
    for (const ex of sp.extra || []) {
      const id = model.addItem(sid, { ...ex, x: Math.round(ex.fx * W), y: Math.round(ex.fy * H), w: Math.round(ex.fw * W), h: Math.round(ex.fh * H) });
      if (ex.text) writeJson(model.text(sid, id), linesJson(ex.text, { align: ex.align || null }));
    }
    if (sp.transition) model.setSlide(sid, { transition: sp.transition });
  });
}

// A soft box where a photo goes (a shape the person replaces with Insert › Image).
const photo = (fx, fy, fw, fh, label = "Your photo here") => ({ t: "shape", shape: "rect", fill: "@lt2", stroke: "@dk2", sw: 2, dash: "dash", color: "@dk2", size: 20, align: "center", valign: "middle", fx, fy, fw, fh, text: [label], name: "Photo placeholder" });
const fade = { kind: "fade", ms: 600 };

const BUILD = {
  blank: () => [{ layout: "title", texts: {} }],
  trip: () => [
    { layout: "title", texts: { title: ["Our trip to …"], subtitle: ["Month year"] }, notes: "Say where you went and who came along.", transition: fade },
    { layout: "two-col", texts: { title: ["The plan"], body: { lines: ["Where we stayed", "How we got there", "What we hoped to see"], bullets: true } }, extra: [photo(0.52, 0.24, 0.42, 0.68, "A map or a photo")] },
    { layout: "title-only", texts: { title: ["Day 1"] }, extra: [photo(0.06, 0.24, 0.56, 0.68), { t: "text", font: "@body", size: 20, color: "@dk1", fx: 0.65, fy: 0.24, fw: 0.29, fh: 0.68, text: ["What we did", "", "The best moment"] }], transition: { kind: "slide", dir: "right", ms: 500 } },
    { layout: "title-only", texts: { title: ["Day 2"] }, extra: [photo(0.06, 0.24, 0.56, 0.68), { t: "text", font: "@body", size: 20, color: "@dk1", fx: 0.65, fy: 0.24, fw: 0.29, fh: 0.68, text: ["What we did", "", "The best moment"] }], transition: { kind: "slide", dir: "right", ms: 500 } },
    { layout: "big-number", texts: { number: ["1,240"], body: ["miles driven"] }, notes: "Swap in a fun number from the trip." },
    { layout: "main-point", texts: { title: ["We'd go back for …"] }, transition: fade },
  ],
  album: () => [
    { layout: "title", texts: { title: ["Photo album"], subtitle: ["A season, a year, or a day"] }, transition: fade },
    ...[1, 2, 3, 4].map((n) => ({ layout: "caption", texts: { caption: [`Caption for photo ${n}`] }, extra: [photo(0.06, 0.06, 0.88, 0.7)], transition: { kind: "dissolve", ms: 800 } })),
    { layout: "title-only", texts: { title: ["More favourites"] }, extra: [photo(0.06, 0.24, 0.28, 0.66, "Photo"), photo(0.36, 0.24, 0.28, 0.66, "Photo"), photo(0.66, 0.24, 0.28, 0.66, "Photo")] },
  ],
  year: () => [
    { layout: "title", texts: { title: ["Our year"], subtitle: [String(new Date().getFullYear())] }, transition: fade },
    ...[["Winter", "January – March"], ["Spring", "April – June"], ["Summer", "July – September"], ["Autumn", "October – December"]].map(([s, m]) => ({ layout: "section-desc", texts: { title: [s], subtitle: [m], body: { lines: ["A big moment", "Something new we tried", "A favourite memory"], bullets: true } } })),
    { layout: "title-body", texts: { title: ["Looking ahead"], body: { lines: ["Next year we'd like to …", "A place to visit", "Something to learn together"], bullets: true } } },
  ],
  pitch: () => [
    { layout: "title", texts: { title: ["Company name"], subtitle: ["One line on what you do"] } },
    { layout: "main-point", texts: { title: ["The problem, in one sentence"] }, notes: "Who has this problem, and how often?" },
    { layout: "title-body", texts: { title: ["Our solution"], body: { lines: ["What it is", "Who it's for", "Why it works better"], bullets: true } } },
    { layout: "two-col", texts: { title: ["Why now"], body: { lines: ["What's changed"], bullets: true }, body2: { lines: ["What we've seen"], bullets: true } } },
    { layout: "big-number", texts: { number: ["$0"], body: ["The number that matters most (revenue, customers, growth)"] } },
    { layout: "title-body", texts: { title: ["Plan and ask"], body: { lines: ["What we'll do next", "What we need", "What it gets us"], bullets: true } } },
    { layout: "section", texts: { title: ["Thank you"] } },
  ],
  update: () => [
    { layout: "title", texts: { title: ["Project update"], subtitle: ["Date"] } },
    { layout: "two-col", texts: { title: ["Where things stand"], body: { lines: ["Done", "In progress"], bullets: true }, body2: { lines: ["Blocked", "Needs a decision"], bullets: true } } },
    { layout: "title-body", texts: { title: ["Highlights"], body: { lines: ["Win", "Win", "Lesson learned"], bullets: true } } },
    { layout: "title-only", texts: { title: ["Timeline"] }, extra: [
      { t: "line", stroke: "@dk2", sw: 6, fx: 0.08, fy: 0.55, fw: 0.84, fh: 0 },
      ...[0, 1, 2, 3].map((k) => ({ t: "shape", shape: "ellipse", fill: "@a1", fx: 0.08 + k * 0.27, fy: 0.5, fw: 0.05, fh: 0.09 })),
      ...[0, 1, 2, 3].map((k) => ({ t: "text", font: "@body", size: 16, color: "@dk1", align: "center", fx: 0.02 + k * 0.27, fy: 0.62, fw: 0.17, fh: 0.15, text: [`Step ${k + 1}`], })),
    ] },
    { layout: "title-body", texts: { title: ["Next steps"], body: { lines: ["Who does what by when"], bullets: true } } },
  ],
  talk: () => [
    { layout: "title", texts: { title: ["Title of the talk"], subtitle: ["Your name"] }, transition: fade },
    { layout: "main-point", texts: { title: ["The one idea to remember"] }, notes: "Say it plainly, then pause." },
    { layout: "section", texts: { title: ["Part one"] } },
    { layout: "title-body", texts: { title: ["A point"], body: { lines: ["An example", "Why it matters"], bullets: true } } },
    { layout: "section", texts: { title: ["Part two"] } },
    { layout: "title-body", texts: { title: ["Another point"], body: { lines: ["A story", "What to take from it"], bullets: true } } },
    { layout: "title-body", texts: { title: ["To think about"], body: { lines: ["A question for everyone"], bullets: true } } },
  ],
  event: () => [
    { layout: "title", texts: { title: ["You're invited!"], subtitle: ["What we're celebrating"] }, extra: [{ t: "shape", shape: "star8", fill: "@a2", fx: 0.82, fy: 0.08, fw: 0.12, fh: 0.2 }], transition: { kind: "zoom", ms: 600 } },
    { layout: "two-col", texts: { title: ["When and where"], body: ["Day, date", "Time"], body2: ["Place", "Address"] } },
    { layout: "title-body", texts: { title: ["What to bring"], body: { lines: ["A dish to share", "Something to drink", "Your favourite game"], bullets: true } } },
    { layout: "main-point", texts: { title: ["See you there!"] } },
  ],
};

export function buildTemplate(model, id) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  model.transact(() => {
    model.init({ themeId: t.theme, firstLayout: "title" });
    addSlides(model, BUILD[t.id]());
  });
  return model;
}

// The picker shown for New › Presentation. → template id, { copyOf: fileId }, or null.
export async function templatePicker(root, { mine = [] } = {}) {
  const card = (t) => {
    const th = themeById(t.theme);
    return `<button type="button" class="sl-tpl" data-tpl="${t.id}"><span class="sl-tpl-prev" style="${esc(`background:${th.colors.lt1};color:${th.colors.dk1};border-top:6px solid ${th.colors.a1}`)}"><b style="${esc(`font-family:"${th.fonts.heading}",sans-serif`)}">${esc(t.name)}</b></span><span class="sl-tpl-name">${esc(t.name)}</span><small>${esc(t.blurb)}</small></button>`;
  };
  let picked = null;
  const { value } = await openDialog(root, {
    title: "New presentation",
    body: `<div class="sl-tpl-grid">${TEMPLATES.map(card).join("")}</div>
      ${mine.length ? `<div class="sl-pop-label">Start from one of yours</div><div class="sl-tpl-mine">${mine.slice(0, 30).map((f) => `<button type="button" class="sl-tpl-file" data-copy="${esc(f.id)}">${esc(f.name)}</button>`).join("")}</div>` : ""}`,
    actions: [{ label: "Cancel", value: null }],
    init: (form) => {
      form.closest(".wp-dialog-box")?.classList.add("sl-tpl-dialog");
      form.addEventListener("click", (e) => {
        const b = e.target.closest("[data-tpl], [data-copy]");
        if (!b) return;
        picked = b.dataset.tpl || { copyOf: b.dataset.copy };
        form.requestSubmit(); // closes the dialog
      });
    },
  });
  void value;
  return picked;
}
