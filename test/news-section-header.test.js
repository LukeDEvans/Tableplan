// News section header (Luke, 2026-11-20): the swipe order, stepping, and what
// counts as a swipe. news-ui.js headerViews / stepView / swipeStep / viewLabel.
import { describe, it, expect } from "vitest";
import { headerViews, stepView, swipeStep, viewLabel, NEWS_SECTIONS } from "../news-ui.js";

const name = (v) => (v ? `${v.kind}${v.key ? `:${v.key}` : ""}` : null);

describe("headerViews", () => {
  it("Front page, then Sports, then every other section once", () => {
    const list = headerViews().map(name);
    expect(list.slice(0, 2)).toEqual(["front", "section:sports"]);
    expect(list).toHaveLength(1 + NEWS_SECTIONS.length);
    expect(new Set(list).size).toBe(list.length);
  });
  it("For you, when the server offers it, sits one swipe right of the Front page", () => {
    expect(headerViews({ forYou: true }).slice(0, 3).map(name)).toEqual(["foryou", "front", "section:sports"]);
  });
});

describe("stepView", () => {
  const list = headerViews({ forYou: true });
  it("a swipe left from the Front page goes to Sports; right goes to For you", () => {
    expect(name(stepView(list, { kind: "front" }, 1))).toBe("section:sports");
    expect(name(stepView(list, { kind: "front" }, -1))).toBe("foryou");
  });
  it("stops at either end (no wrap-around)", () => {
    expect(stepView(list, { kind: "foryou" }, -1)).toBeNull();
    expect(stepView(list, list[list.length - 1], 1)).toBeNull();
  });
  it("a paper (not in the header's order) steps from the Front page", () => {
    expect(name(stepView(list, { kind: "paper", key: "nyt" }, 1))).toBe("section:sports");
  });
});

describe("swipeStep", () => {
  it("a mostly sideways drag of 40px or more steps; left = next", () => {
    expect(swipeStep(-60, 5)).toBe(1);
    expect(swipeStep(70, -10)).toBe(-1);
  });
  it("short or mostly vertical drags (scrolling) don't", () => {
    expect(swipeStep(-30, 0)).toBe(0);
    expect(swipeStep(-60, 50)).toBe(0);
  });
});

describe("viewLabel", () => {
  it("names each kind of view", () => {
    expect(viewLabel({ kind: "front" })).toBe("Front page");
    expect(viewLabel({ kind: "foryou" })).toBe("For you");
    expect(viewLabel({ kind: "section", key: "sports" })).toBe("Sports");
    expect(viewLabel({ kind: "paper", key: "nyt" })).toBe("New York Times");
  });
});
