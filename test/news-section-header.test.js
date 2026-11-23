// News section header (Luke, 2026-11-20): the swipe order, stepping, and what
// counts as a swipe. news-ui.js headerViews / stepView / swipeStep / viewLabel.
import { describe, it, expect } from "vitest";
import { headerViews, stepView, swipeStep, viewLabel, NEWS_SECTIONS } from "../news-ui.js";

const name = (v) => (v ? `${v.kind}${v.key ? `:${v.key}` : ""}` : null);

describe("headerViews", () => {
  it("Front page, then every section once in its usual order (Sports after Culture)", () => {
    const list = headerViews().map(name);
    expect(list[0]).toBe("front");
    expect(list.slice(1)).toEqual(NEWS_SECTIONS.map((x) => `section:${x.key}`));
    expect(list.indexOf("section:sports")).toBe(list.indexOf("section:culture") + 1);
    expect(new Set(list).size).toBe(list.length);
  });
  it("Scores, its own section, sits one swipe right of the Front page (Luke, 2026-11-20)", () => {
    expect(headerViews({ scores: true }).slice(0, 3).map(name)).toEqual(["scores", "front", "section:world"]);
  });
  it("For you, while it is its own view, sits left of Scores so Scores stays next to the Front page", () => {
    expect(headerViews({ forYou: true, scores: true }).slice(0, 3).map(name)).toEqual(["foryou", "scores", "front"]);
    expect(headerViews({ forYou: true }).slice(0, 2).map(name)).toEqual(["foryou", "front"]);
  });
});

describe("stepView", () => {
  const list = headerViews({ forYou: true, scores: true });
  it("a swipe left from the Front page goes to World; right goes to Scores", () => {
    expect(name(stepView(list, { kind: "front" }, 1))).toBe("section:world");
    expect(name(stepView(list, { kind: "front" }, -1))).toBe("scores");
    expect(name(stepView(list, { kind: "scores" }, -1))).toBe("foryou");
  });
  it("stops at either end (no wrap-around)", () => {
    expect(stepView(list, { kind: "foryou" }, -1)).toBeNull();
    expect(stepView(list, list[list.length - 1], 1)).toBeNull();
  });
  it("a paper (not in the header's order) steps from the Front page", () => {
    expect(name(stepView(list, { kind: "paper", key: "nyt" }, 1))).toBe("section:world");
  });
  it("Scores is labelled Scores", () => {
    expect(viewLabel({ kind: "scores" })).toBe("Scores");
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
