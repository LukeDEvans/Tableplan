// Slides: PowerPoint in and out (SLIDES_DESIGN.md §10).

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import * as Y from "yjs";
import { unzipSync, strFromU8, zipSync } from "fflate";
import { createSlidesModel, fragmentText } from "../documents/slides/model.js";
import { buildTemplate } from "../documents/slides/templates.js";
import { exportPptx } from "../documents/slides/pptx-export.js";
import { pptxIntoModel, readPptx, parseXml } from "../documents/slides/pptx-import.js";
import { contentId } from "../documents/slides/media.js";

const fixture = () => new Uint8Array(readFileSync(new URL("./fixtures/slides-python-pptx.pptx", import.meta.url)));
function memStore() {
  const parts = new Map();
  return { parts, putMedia: async (b) => { const id = await contentId(b); parts.set(id, b); return id; }, bytes: async (id) => parts.get(id) };
}
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("PowerPoint in", () => {
  it("reads slides made by python-pptx, with placeholders where their layouts put them", async () => {
    const m = createSlidesModel(new Y.Doc());
    m.init();
    const st = memStore();
    const { notes, slides } = await pptxIntoModel(m, fixture(), { putMedia: st.putMedia });
    expect(slides).toBe(4);
    expect(m.slideIds()).toHaveLength(4);
    expect(m.size()).toEqual([1920, 1080]);
    const [s1, s2, s3, s4] = m.slideIds();
    // title slide: both placeholders, positioned from the layout (they have no position of their own)
    const t1 = m.items(s1).filter((i) => i.t === "text");
    expect(t1.map((i) => fragmentText(m.text(s1, i.id)))).toEqual(["Lake trip 2026", "Planning notes"]);
    expect(t1[0].x).toBeGreaterThan(50);
    expect(t1[0].y).toBeGreaterThan(100);
    expect(t1[0].w).toBeGreaterThan(1000);
    expect(fragmentText(m.notes(s1))).toBe("Welcome everyone");
    // bullets with a nested level, and the first run's formatting
    const body = m.items(s2).find((i) => fragmentText(m.text(s2, i.id)).includes("Tent"));
    const json = JSON.stringify(m.text(s2, body.id).toJSON()).toLowerCase();
    expect(json).toContain("bulletlist");
    expect(fragmentText(m.text(s2, body.id)).split("\n")).toEqual(["Tent", "Stakes", "Sleeping bags", "Snacks"]);
    // table, star, picture
    const table = m.items(s3).find((i) => i.t === "table");
    expect(table.rows).toBe(3);
    expect(table.cells["2.1"].text).toBe("300");
    const star = m.items(s3).find((i) => i.t === "shape");
    expect(star.shape).toBe("star5");
    expect(star.fill).toBe("#ffaa00");
    expect(Math.round(star.rot)).toBe(30);
    const pic = m.items(s3).find((i) => i.t === "image");
    expect(st.parts.has(pic.media)).toBe(true);
    expect(m.mediaInfo(pic.media)).toMatchObject({ kind: "image", mime: "image/png" });
    // chart, from the data saved in the file
    const chart = m.items(s4).find((i) => i.t === "chart");
    expect(chart.cache.spec).toMatchObject({ type: "column", title: "Spending" });
    expect(chart.cache.data.categories).toEqual(["Jan", "Feb", "Mar"]);
    expect(chart.cache.data.series[1]).toEqual({ name: "Gas", values: [80, 85, 90] });
    // a link in text
    const tb = m.items(s4).find((i) => i.t === "text");
    expect(JSON.stringify(m.text(s4, tb.id).toJSON())).toContain("https://example.com");
    expect(Array.isArray(notes)).toBe(true);
  });
  it("refuses something that isn't a PowerPoint file", async () => {
    const m = createSlidesModel(new Y.Doc());
    await expect(pptxIntoModel(m, new Uint8Array([1, 2, 3]), { putMedia: async () => null })).rejects.toThrow(/PowerPoint/);
  });
});

describe("PowerPoint in — hostile files", () => {
  it("won't unpack a small file into hundreds of megabytes", async () => {
    const real = unzipSync(new Uint8Array(readFileSync("test/fixtures/slides-python-pptx.pptx")));
    const pad = new Uint8Array(90 * 1024 * 1024);
    const files = { ...real };
    for (let i = 0; i < 5; i++) files[`ppt/junk${i}.bin`] = [pad, { level: 1 }];
    const bomb = zipSync(files);
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024);
    const model = createSlidesModel(new Y.Doc());
    model.init();
    // Every padded entry is over the per-entry cap, so they're skipped and the deck still opens.
    const r = await pptxIntoModel(model, bomb, { putMedia: async (b) => contentId(b) });
    expect(r.slides).toBeGreaterThan(0);
  }, 60000);
  it("refuses a file whose entries add up to more than 300 MB", async () => {
    const real = unzipSync(new Uint8Array(readFileSync("test/fixtures/slides-python-pptx.pptx")));
    const pad = new Uint8Array(70 * 1024 * 1024);
    const files = { ...real };
    for (let i = 0; i < 5; i++) files[`ppt/junk${i}.bin`] = [pad, { level: 1 }];
    const model = createSlidesModel(new Y.Doc());
    model.init();
    await expect(pptxIntoModel(model, zipSync(files), { putMedia: async (b) => contentId(b) })).rejects.toThrow(/300 MB/);
  }, 60000);
});

describe("PowerPoint out", () => {
  async function deck() {
    const m = createSlidesModel(new Y.Doc());
    buildTemplate(m, "pitch");
    const st = memStore();
    const pid = await st.putMedia(PNG);
    m.addMedia(pid, { kind: "image", mime: "image/png", size: PNG.length });
    const s = m.slideIds()[1];
    m.addItem(s, { t: "image", media: pid, x: 100, y: 100, w: 300, h: 300, alt: "a dot", crop: { l: 0.1, t: 0, r: 0, b: 0 } });
    m.addItem(s, { t: "shape", shape: "heart", x: 500, y: 500, w: 200, h: 200, fill: "#e91e63", rot: 15 });
    m.addItem(s, { t: "line", x: 10, y: 10, w: 400, h: 200, stroke: "#000000", sw: 4, a2: "arrow", kind: "elbow" });
    m.addItem(s, { t: "table", rows: 2, cols: 2, x: 900, y: 600, w: 600, h: 200, cells: { "0.0": { text: "A", bold: true }, "1.1": { text: "D", cs: 1 } } });
    m.setSlide(s, { transition: { kind: "fade", ms: 300 }, skip: true });
    return { m, st };
  }
  it("writes a well-formed package PowerPoint can read", async () => {
    const { m, st } = await deck();
    const bytes = await exportPptx(m, { media: st });
    const files = unzipSync(bytes);
    for (const [p, b] of Object.entries(files)) if (/\.(xml|rels)$/.test(p)) expect(() => parseXml(strFromU8(b)), p).not.toThrow();
    expect(Object.keys(files)).toEqual(expect.arrayContaining(["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/theme/theme1.xml", "ppt/notesSlides/notesSlide2.xml"]));
    const s2 = strFromU8(files["ppt/slides/slide2.xml"]);
    expect(s2).toContain('show="0"');
    expect(s2).toContain('prst="heart"');
    expect(s2).toContain("<p:fade/>");
    expect(s2).toContain('descr="a dot"');
    expect(strFromU8(files["[Content_Types].xml"])).toContain('Extension="png"');
    mkdirSync("test/.out", { recursive: true });
    writeFileSync("test/.out/slides-export.pptx", bytes);
  });
  it("round-trips through our own reader", async () => {
    const { m, st } = await deck();
    const bytes = await exportPptx(m, { media: st });
    const back = createSlidesModel(new Y.Doc());
    back.init();
    const st2 = memStore();
    await pptxIntoModel(back, bytes, { putMedia: st2.putMedia });
    expect(back.slideIds()).toHaveLength(m.slideIds().length);
    expect(back.theme().fonts).toEqual(m.theme().fonts);
    expect(back.theme().colors.a1).toBe(m.theme().colors.a1);
    const a = m.slideIds()[0], b = back.slideIds()[0];
    const title = (mm, sid) => mm.items(sid).filter((i) => i.t === "text").map((i) => fragmentText(mm.text(sid, i.id))).filter(Boolean);
    expect(title(back, b)).toEqual(title(m, a));
    const tA = m.items(a).find((i) => i.role === "title"), tB = back.items(b).find((i) => fragmentText(back.text(b, i.id)) === fragmentText(m.text(a, tA.id)));
    expect(Math.abs(tB.x - tA.x)).toBeLessThan(2);
    expect(Math.abs(tB.size - tA.size)).toBeLessThan(0.2);
    const s2 = back.slideIds()[1];
    expect(back.slide(s2).skip).toBe(true);
    expect(back.slide(s2).transition.kind).toBe("fade");
    const heart = back.items(s2).find((i) => i.shape === "heart");
    expect(heart).toMatchObject({ fill: "#e91e63", rot: 15 });
    const img = back.items(s2).find((i) => i.t === "image");
    expect(img.alt).toBe("a dot");
    expect(img.crop.l).toBeCloseTo(0.1);
    expect(st2.parts.get(img.media)).toEqual(PNG);
    const line = back.items(s2).find((i) => i.t === "line");
    expect(line).toMatchObject({ kind: "elbow", a2: "arrow" });
    const tbl = back.items(s2).find((i) => i.t === "table");
    expect(tbl.cells["0.0"]).toMatchObject({ text: "A", bold: true });
    // notes come back
    expect(fragmentText(back.notes(s2))).toBe(fragmentText(m.notes(m.slideIds()[1])));
  });
  it("reads the slide size and theme it wrote", async () => {
    const { m, st } = await deck();
    const data = readPptx(await exportPptx(m, { media: st }));
    expect(data.cx).toBe(9144000);
    expect(data.cy).toBe(5143500);
    expect(data.theme.fonts.heading).toBe(m.theme().fonts.heading);
  });
});
