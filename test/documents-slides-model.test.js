// Slides' shared data (SLIDES_DESIGN.md §2): stacking keys, slides and items, layouts,
// and two devices editing at once.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { keyBetween, keysBetween, isKey, byZ } from "../documents/slides/zorder.js";
import { createSlidesModel, fragmentText, cleanItem, LOCAL } from "../documents/slides/model.js";
import { cleanTheme, resolveColor, themeById, LAYOUTS, backgroundCss } from "../documents/slides/themes.js";

function device(from = null) {
  const ydoc = new Y.Doc();
  if (from) Y.applyUpdate(ydoc, from);
  return { ydoc, m: createSlidesModel(ydoc) };
}
function sync(a, b) {
  const ua = Y.encodeStateAsUpdate(a.ydoc, Y.encodeStateVector(b.ydoc));
  const ub = Y.encodeStateAsUpdate(b.ydoc, Y.encodeStateVector(a.ydoc));
  Y.applyUpdate(b.ydoc, ua, "remote");
  Y.applyUpdate(a.ydoc, ub, "remote");
}
function two() {
  const a = device();
  a.m.init();
  const b = device(Y.encodeStateAsUpdate(a.ydoc));
  return { a, b };
}
const typeInto = (fr, s) => { const p = new Y.XmlElement("paragraph"); p.insert(0, [new Y.XmlText(s)]); fr.push([p]); };

describe("stacking keys", () => {
  it("makes keys between any two, in order", () => {
    let keys = [keyBetween(null, null)];
    for (let i = 0; i < 200; i++) keys.push(keyBetween(keys[keys.length - 1], null));
    for (let i = 0; i < 200; i++) keys.unshift(keyBetween(null, keys[0]));
    for (let i = 0; i < 100; i++) { const j = (i * 37) % (keys.length - 1); keys.splice(j + 1, 0, keyBetween(keys[j], keys[j + 1])); }
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(isKey)).toBe(true);
  });
  it("makes n keys at once", () => {
    const ks = keysBetween("a0", "a1", 10);
    expect(ks).toHaveLength(10);
    expect([...ks].sort()).toEqual(ks);
    expect(ks.every((k) => k > "a0" && k < "a1")).toBe(true);
  });
  it("breaks ties by id so every device agrees", () => {
    expect([{ id: "b", z: "a0" }, { id: "a", z: "a0" }].sort(byZ).map((x) => x.id)).toEqual(["a", "b"]);
  });
  it("rejects bad keys", () => {
    expect(() => keyBetween("a1", "a0")).toThrow();
    expect(isKey("")).toBe(false);
    expect(isKey("a00")).toBe(false);
  });
});

describe("a presentation", () => {
  it("starts with a title slide and its placeholders", () => {
    const { m } = device();
    m.init();
    expect(m.slideIds()).toHaveLength(1);
    const s = m.slide(m.slideIds()[0]);
    expect(s.layout).toBe("title");
    expect(m.items(s.id).map((i) => i.role)).toEqual(["title", "subtitle"]);
    expect(m.text(s.id, m.items(s.id)[0].id)).toBeInstanceOf(Y.XmlFragment);
  });

  it("adds, duplicates, moves and deletes slides", () => {
    const { m } = device();
    m.init();
    const s1 = m.slideIds()[0];
    const s2 = m.addSlide({ layout: "title-body" });
    const s3 = m.addSlide({ layout: "blank", after: s1 });
    expect(m.slideIds()).toEqual([s1, s3, s2]);
    typeInto(m.text(s2, m.items(s2)[0].id), "Hello");
    const [d] = m.duplicateSlides([s2]);
    expect(m.slideIds()).toEqual([s1, s3, s2, d]);
    const copyTitle = m.items(d)[0];
    expect(copyTitle.id).not.toBe(m.items(s2)[0].id);
    expect(fragmentText(m.text(d, copyTitle.id))).toBe("Hello");
    m.moveSlides([d], 0);
    expect(m.slideIds()).toEqual([d, s1, s3, s2]);
    m.moveSlides([s1, s2], 1);
    expect(m.slideIds()).toEqual([d, s1, s2, s3]);
    m.deleteSlides([s1, s3]);
    expect(m.slideIds()).toEqual([d, s2]);
    expect(m.slides.has(s1)).toBe(false);
  });

  it("duplicating keeps groups and animations pointing at the copies", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    const a = m.addItem(s, { t: "shape", shape: "rect", x: 10, y: 10, w: 50, h: 50 });
    const b = m.addItem(s, { t: "shape", shape: "ellipse", x: 100, y: 10, w: 50, h: 50 });
    m.group(s, [a, b]);
    m.setAnims(s, [{ item: a, effect: "fade-in" }]);
    const [d] = m.duplicateSlides([s]);
    const shapes = m.items(d).filter((x) => x.t === "shape");
    expect(shapes).toHaveLength(2);
    expect(shapes[0].grp).toBe(shapes[1].grp);
    expect(shapes[0].grp).not.toBe(m.item(s, a).grp);
    expect(shapes.map((x) => x.id)).toContain(m.anims(d)[0].item);
  });

  it("changes a slide's layout by placeholder role", () => {
    const { m } = device();
    m.init();
    const s = m.addSlide({ layout: "title-body" });
    const [title, body] = m.items(s);
    typeInto(m.text(s, body.id), "Keep me");
    m.setLayout(s, "two-col");
    expect(m.items(s).map((i) => i.role).sort()).toEqual(["body", "body2", "title"]);
    expect(m.item(s, title.id).w).toBeGreaterThan(0);
    m.setLayout(s, "title-only");
    const after = m.items(s);
    expect(after.find((i) => i.role === "title")).toBeTruthy();
    expect(after.find((i) => i.role === "body2")).toBeFalsy(); // empty, removed
    const kept = after.find((i) => i.id === body.id);
    expect(kept).toBeTruthy(); // had text: kept as an ordinary box
    expect(kept.role).toBeUndefined();
  });

  it("restacks only the moved items", () => {
    const { m } = device();
    m.init();
    const s = m.addSlide({ layout: "blank" });
    const ids = [1, 2, 3, 4].map((n) => m.addItem(s, { t: "shape", name: `s${n}` }));
    const zBefore = Object.fromEntries(m.items(s).map((i) => [i.id, i.z]));
    m.restack(s, [ids[0]], "front");
    expect(m.items(s).map((i) => i.id)).toEqual([ids[1], ids[2], ids[3], ids[0]]);
    expect(m.item(s, ids[1]).z).toBe(zBefore[ids[1]]);
    m.restack(s, [ids[0]], "backward");
    expect(m.items(s).map((i) => i.id)).toEqual([ids[1], ids[2], ids[0], ids[3]]);
    m.restack(s, [ids[3]], "back");
    expect(m.items(s)[0].id).toBe(ids[3]);
    m.restack(s, [ids[3]], "forward");
    expect(m.items(s).map((i) => i.id).slice(0, 2)).toEqual([ids[1], ids[3]]);
  });

  it("copies and pastes items with their text", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    const t = m.items(s)[0].id;
    typeInto(m.text(s, t), "Copied");
    const clones = m.copyItems(s, [t]);
    expect(JSON.parse(JSON.stringify(clones))).toEqual(clones);
    const s2 = m.addSlide({ layout: "blank" });
    const [p] = m.pasteItems(s2, clones, { dx: 20 });
    expect(fragmentText(m.text(s2, p))).toBe("Copied");
    const [p2] = m.pasteItems(s2, clones);
    expect(fragmentText(m.text(s2, p2))).toBe("Copied");
    expect(m.item(s2, p).x).toBe(m.item(s, t).x + 20);
    expect(m.item(s2, p).role).toBeUndefined();
  });

  it("deleting an item drops its animations", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    const a = m.addItem(s, { t: "shape" });
    m.setAnims(s, [{ item: a, effect: "fly-in", dir: "left" }, { item: "other", effect: "appear" }]);
    m.deleteItems(s, [a]);
    expect(m.anims(s).map((x) => x.item)).toEqual(["other"]);
  });

  it("keeps items in place when the slide size changes", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    const a = m.addItem(s, { t: "shape", x: 960, y: 540, w: 192, h: 108 });
    m.setSize("4:3");
    expect(m.size()).toEqual([1440, 1080]);
    expect(m.item(s, a).x).toBe(720);
    expect(m.item(s, a).w).toBe(144);
  });

  it("only sends local edits with the LOCAL origin", () => {
    const { ydoc, m } = device();
    const origins = [];
    ydoc.on("update", (_, o) => origins.push(o));
    m.init();
    m.addSlide();
    expect(origins.every((o) => o === LOCAL)).toBe(true);
  });

  it("searches slide text and notes", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    typeInto(m.text(s, m.items(s)[0].id), "Trip to Duluth");
    typeInto(m.notes(s), "Mention the lake");
    expect(m.searchText()).toContain("Trip to Duluth");
    expect(m.searchText()).toContain("Mention the lake");
  });
});

describe("two people at once", () => {
  it("reordering slides while the other types on one keeps both", () => {
    const { a, b } = two();
    const s1 = a.m.slideIds()[0];
    const s2 = a.m.addSlide();
    const s3 = a.m.addSlide();
    sync(a, b);
    a.m.moveSlides([s3], 0);
    typeInto(b.m.text(s2, b.m.items(s2)[0].id), "Marijane's words");
    sync(a, b);
    expect(a.m.slideIds()).toEqual(b.m.slideIds());
    expect(a.m.slideIds()).toEqual([s3, s1, s2]);
    expect(fragmentText(a.m.text(s2, a.m.items(s2)[0].id))).toBe("Marijane's words");
  });

  it("both moving the same slide leaves it once, after tidy", () => {
    const { a, b } = two();
    const s2 = a.m.addSlide(); a.m.addSlide();
    sync(a, b);
    a.m.moveSlides([s2], 0);
    b.m.moveSlides([s2], 3);
    sync(a, b);
    a.m.tidy(); b.m.tidy(); sync(a, b);
    expect(a.m.order.toArray().filter((x) => x === s2)).toHaveLength(1);
    expect(a.m.slideIds()).toEqual(b.m.slideIds());
    expect(a.m.slideIds()).toHaveLength(3);
  });

  it("one deletes a slide while the other moves it", () => {
    const { a, b } = two();
    const s2 = a.m.addSlide(); a.m.addSlide();
    sync(a, b);
    a.m.deleteSlides([s2]);
    b.m.moveSlides([s2], 0);
    sync(a, b);
    a.m.tidy(); b.m.tidy(); sync(a, b);
    expect(a.m.slideIds()).toEqual(b.m.slideIds());
    expect(a.m.slideIds()).not.toContain(s2);
  });

  it("both bringing different items to the front merges cleanly", () => {
    const { a, b } = two();
    const s = a.m.addSlide({ layout: "blank" });
    const ids = [1, 2, 3].map(() => a.m.addItem(s, { t: "shape" }));
    sync(a, b);
    a.m.restack(s, [ids[0]], "front");
    b.m.restack(s, [ids[1]], "front");
    sync(a, b);
    expect(a.m.items(s).map((i) => i.id)).toEqual(b.m.items(s).map((i) => i.id));
    expect(a.m.items(s)[0].id).toBe(ids[2]);
  });

  it("moving and recolouring the same shape keeps both changes", () => {
    const { a, b } = two();
    const s = a.m.slideIds()[0];
    const id = a.m.addItem(s, { t: "shape", x: 0, fill: "#000000" });
    sync(a, b);
    a.m.updateItems(s, [id], { x: 300 });
    b.m.updateItems(s, [id], { fill: "#ff0000" });
    sync(a, b);
    expect(a.m.item(s, id)).toMatchObject({ x: 300, fill: "#ff0000" });
  });

  it("offline on both sides, then merged", () => {
    const { a, b } = two();
    const s = a.m.slideIds()[0];
    a.m.addSlide({ layout: "section" });
    b.m.addSlide({ layout: "big-number" });
    b.m.setSlide(s, { transition: { kind: "fade", ms: 400 } });
    sync(a, b);
    expect(a.m.slideIds()).toEqual(b.m.slideIds());
    expect(a.m.slideIds()).toHaveLength(3);
    expect(a.m.slide(s).transition).toEqual({ kind: "fade", dir: "right", ms: 400 });
  });
});

describe("checking what comes in", () => {
  it("drops unknown or unsafe item fields", () => {
    const it2 = cleanItem({ t: "evil", x: "12", w: 1e9, fill: "#fff", onclick: "x", opacity: 4, rot: -30, z: "<" });
    expect(it2.t).toBe("shape");
    expect(it2.x).toBe(12);
    expect(it2.w).toBe(20000);
    expect(it2.opacity).toBe(1);
    expect(it2.rot).toBe(330);
    expect(it2.onclick).toBeUndefined();
    expect(it2.z).toBe("a0");
  });
  it("checks themes and resolves colours", () => {
    const th = cleanTheme({ id: "plain", colors: { a1: "red; background:url(x)", dk1: "#123456" }, fonts: { heading: "Arial;}" } });
    expect(th.colors.a1).toBe(themeById("plain").colors.a1);
    expect(th.colors.dk1).toBe("#123456");
    expect(th.fonts.heading).toBe("Arial");
    expect(resolveColor("@dk1", th)).toBe("#123456");
    expect(resolveColor("javascript:1", th)).toBeNull();
    expect(backgroundCss({ kind: "gradient", from: "lt1", to: "a1", angle: 90 }, th)).toMatch(/^linear-gradient\(90deg, #/);
  });
  it("every layout's boxes fit the slide", () => {
    for (const L of LAYOUTS) for (const p of L.ph) {
      const [x, y, w, h] = p.box;
      expect(x >= 0 && y >= 0 && x + w <= 1 && y + h <= 1).toBe(true);
    }
  });
});

describe("slides as JSON", () => {
  it("exports and imports whole slides into another presentation", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    typeInto(m.text(s, m.items(s)[0].id), "Moved over");
    typeInto(m.notes(s), "Say hello");
    const a = m.addItem(s, { t: "shape", shape: "star5" });
    m.setAnims(s, [{ item: a, effect: "spin" }]);
    m.setSlide(s, { transition: { kind: "cube" } });
    const json = JSON.parse(JSON.stringify(m.exportSlides([s])));
    const other = device();
    other.m.init();
    const [n] = other.m.importSlides(json, 0);
    expect(other.m.slideIds()[0]).toBe(n);
    expect(fragmentText(other.m.text(n, other.m.items(n).find((i) => i.role === "title").id))).toBe("Moved over");
    expect(fragmentText(other.m.notes(n))).toBe("Say hello");
    const star = other.m.items(n).find((i) => i.shape === "star5");
    expect(other.m.anims(n)[0].item).toBe(star.id);
    expect(other.m.slide(n).transition.kind).toBe("cube");
  });
});

describe("tables", () => {
  it("adds rows and types in cells at once on two devices", () => {
    const { a, b } = two();
    const s = a.m.slideIds()[0];
    const t = a.m.addItem(s, { t: "table", rows: 2, cols: 2, h: 140 });
    sync(a, b);
    a.m.tableInsert(s, t, "row", 0);
    b.m.tableCell(s, t, 1, 1, { text: "B2" });
    sync(a, b);
    const ta = a.m.item(s, t), tb2 = b.m.item(s, t);
    expect(ta.rows).toBe(3);
    expect(ta.cells["2.1"].text).toBe("B2"); // moved down with its row
    expect(tb2.cells).toEqual(ta.cells);
  });
  it("deletes a column with its cells, and copies whole tables", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    const t = m.addItem(s, { t: "table", rows: 2, cols: 3, cells: { "0.0": { text: "a" }, "0.2": { text: "c", bold: true } } });
    m.tableDelete(s, t, "col", 1);
    expect(m.item(s, t).cols).toBe(2);
    expect(m.item(s, t).cells["0.1"]).toEqual({ text: "c", bold: true });
    const [p] = m.pasteItems(s, m.copyItems(s, [t]));
    expect(m.item(s, p).cells).toEqual(m.item(s, t).cells);
    m.tableCell(s, p, 0, 0, { text: "changed" });
    expect(m.item(s, t).cells["0.0"].text).toBe("a");
  });
});

describe("fixes from review", () => {
  it("a font is a plain name or a theme role, never CSS", () => {
    expect(cleanItem({ t: "text", font: 'x" onmouseover="alert(1)' }).font).toBeUndefined();
    expect(cleanItem({ t: "text", font: "x onmouseover=alert(1) y" }).font).toBeUndefined();
    expect(cleanItem({ t: "text", font: "Open Sans" }).font).toBe("Open Sans");
    expect(cleanItem({ t: "text", font: "@heading" }).font).toBe("@heading");
  });
  it("restoring keeps slide and item ids (comments still find them)", () => {
    const { m } = device();
    m.init();
    const s = m.slideIds()[0];
    const it = m.items(s)[0].id;
    const data = JSON.parse(JSON.stringify(m.exportSlides(m.slideIds())));
    m.transact(() => { m.deleteSlides(m.slideIds()); m.importSlides(data, 0, { keepIds: true }); });
    expect(m.slideIds()).toEqual([s]);
    expect(m.item(s, it)).toBeTruthy();
  });
});
