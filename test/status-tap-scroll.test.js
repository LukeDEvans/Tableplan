import { describe, it, expect } from "vitest";
import { isVerticalScroller, scrolledAncestors, findScrollTargets, scrollToTop, probePoints } from "../status-tap-scroll.js";

// Minimal element stand-ins: the module only reads nodeType, parentElement,
// scrollTop/scrollHeight/clientHeight and computed overflowY.
function el({ parent = null, overflowY = "visible", scrollTop = 0, scrollHeight = 100, clientHeight = 100 } = {}) {
  const node = { nodeType: 1, parentElement: parent, overflowY, scrollTop, scrollHeight, clientHeight, calls: [] };
  node.scrollTo = (opts) => { node.calls.push(opts); node.scrollTop = 0; };
  return node;
}
const getStyle = (n) => ({ overflowY: n.overflowY });

function fakeWindow({ hits, reduced = false, scrollingElement = null }) {
  const doc = {
    documentElement: { clientWidth: 390, clientHeight: 844 },
    scrollingElement,
    elementFromPoint: (x, y) => hits(x, y),
  };
  const win = {
    innerWidth: 390,
    innerHeight: 844,
    document: doc,
    getComputedStyle: getStyle,
    matchMedia: () => ({ matches: reduced }),
  };
  return { doc, win };
}

describe("status-tap-scroll", () => {
  it("only counts elements that scroll vertically and have overflow", () => {
    expect(isVerticalScroller(el({ overflowY: "auto", scrollHeight: 500 }), getStyle)).toBe(true);
    expect(isVerticalScroller(el({ overflowY: "scroll", scrollHeight: 500 }), getStyle)).toBe(true);
    expect(isVerticalScroller(el({ overflowY: "hidden", scrollHeight: 500 }), getStyle)).toBe(false);
    expect(isVerticalScroller(el({ overflowY: "auto", scrollHeight: 100 }), getStyle)).toBe(false);
    expect(isVerticalScroller(null, getStyle)).toBe(false);
  });

  it("collects scrolled-down scrollers from the hit element upward, innermost first", () => {
    const page = el({ overflowY: "auto", scrollTop: 300, scrollHeight: 2000 });
    const plain = el({ parent: page });
    const list = el({ parent: plain, overflowY: "auto", scrollTop: 40, scrollHeight: 900 });
    const atTop = el({ parent: list, overflowY: "auto", scrollTop: 0, scrollHeight: 900 });
    const leaf = el({ parent: atTop });
    expect(scrolledAncestors(leaf, getStyle)).toEqual([list, page]);
  });

  it("scrolls the container in front (e.g. an open sheet), not the page behind it", () => {
    const page = el({ overflowY: "auto", scrollTop: 500, scrollHeight: 3000 });
    const sheet = el({ overflowY: "auto", scrollTop: 200, scrollHeight: 1500 });
    const sheetRow = el({ parent: sheet });
    const { doc, win } = fakeWindow({ hits: () => sheetRow });
    expect(findScrollTargets(doc, win)).toEqual([sheet]);
    expect(scrollToTop(doc, win)).toBe(1);
    expect(sheet.calls).toEqual([{ top: 0, behavior: "smooth" }]);
    expect(page.calls).toEqual([]);
  });

  it("tries other points when the middle of the screen has nothing scrolled", () => {
    const page = el({ overflowY: "auto", scrollTop: 120, scrollHeight: 3000 });
    const row = el({ parent: page });
    const gap = el();
    const [, second] = probePoints(390, 844);
    const { doc, win } = fakeWindow({ hits: (x, y) => (y === second[1] ? row : gap) });
    expect(findScrollTargets(doc, win)).toEqual([page]);
  });

  it("falls back to the document, and does nothing when everything is at the top", () => {
    const root = el({ overflowY: "visible", scrollTop: 80 });
    let { doc, win } = fakeWindow({ hits: () => null, scrollingElement: root });
    expect(findScrollTargets(doc, win)).toEqual([root]);
    ({ doc, win } = fakeWindow({ hits: () => el(), scrollingElement: el() }));
    expect(scrollToTop(doc, win)).toBe(0);
  });

  it("jumps instead of animating when reduced motion is on", () => {
    const page = el({ overflowY: "auto", scrollTop: 50, scrollHeight: 3000 });
    const { doc, win } = fakeWindow({ hits: () => page, reduced: true });
    scrollToTop(doc, win);
    expect(page.calls).toEqual([{ top: 0, behavior: "auto" }]);
  });
});
