import { describe, it, expect } from "vitest";
import { makeReaderOrigin, readerReturnTarget, captureScroll, restoreScroll } from "../reader-return.js";

describe("makeReaderOrigin", () => {
  it("needs an area", () => {
    expect(makeReaderOrigin({})).toBe(null);
    expect(makeReaderOrigin()).toBe(null);
  });
  it("keeps only real, scrolled positions", () => {
    const o = makeReaderOrigin({
      area: "news",
      scroll: [{ id: "newsContent", top: 412.6 }, { id: "x", top: 0 }, { top: 50 }, null, { id: "y", top: NaN }],
      windowY: -3,
    });
    expect(o).toEqual({ area: "news", tab: null, scroll: [{ id: "newsContent", top: 413 }], windowY: 0 });
  });
});

describe("readerReturnTarget", () => {
  const news = makeReaderOrigin({ area: "news" });
  const queue = makeReaderOrigin({ area: "media", tab: "queue" });

  it("returns to another page", () => {
    expect(readerReturnTarget(news, { hostArea: "media", hostTab: "all" })).toBe(news);
  });
  it("returns to another tab of the host page", () => {
    expect(readerReturnTarget(queue, { hostArea: "media", hostTab: "all" })).toBe(queue);
  });
  it("just closes when opened from where it shows", () => {
    expect(readerReturnTarget(queue, { hostArea: "media", hostTab: "queue" })).toBe(null);
    expect(readerReturnTarget(makeReaderOrigin({ area: "news" }), { hostArea: "news" })).toBe(null);
  });
  it("just closes with no origin", () => {
    expect(readerReturnTarget(null, { hostArea: "media" })).toBe(null);
  });
});

describe("scroll capture / restore", () => {
  function fakeEl(id, scrollTop, children = []) {
    return { id, scrollTop, querySelectorAll: () => children };
  }
  it("captures scrolled elements with ids, root included", () => {
    const list = fakeEl("newsContent", 300);
    const flat = fakeEl("other", 0);
    const root = fakeEl("newsMainPage", 10, [list, flat]);
    expect(captureScroll(root)).toEqual([{ id: "newsMainPage", top: 10 }, { id: "newsContent", top: 300 }]);
    expect(captureScroll(null)).toEqual([]);
  });
  it("restores by id and skips what's gone", () => {
    const el = { scrollTop: 0 };
    const doc = { getElementById: (id) => (id === "newsContent" ? el : null) };
    const calls = [];
    const win = { scrollTo: (o) => calls.push(o) };
    restoreScroll({ scroll: [{ id: "newsContent", top: 300 }, { id: "gone", top: 5 }], windowY: 80 }, doc, win);
    expect(el.scrollTop).toBe(300);
    expect(calls).toEqual([{ top: 80, behavior: "instant" }]);
    expect(() => restoreScroll(null, doc, win)).not.toThrow();
  });
});
