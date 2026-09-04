import { describe, it, expect } from "vitest";
import { hasLocalTextDetection, detectText, linesToArticle } from "../local-text-detect.js";

describe("hasLocalTextDetection — capability probe", () => {
  it("true only when window.TextDetector is a constructor", () => {
    expect(hasLocalTextDetection({ TextDetector: function () {} })).toBe(true);
    expect(hasLocalTextDetection({})).toBe(false);
    expect(hasLocalTextDetection(undefined)).toBe(false);
    expect(hasLocalTextDetection({ TextDetector: "nope" })).toBe(false);
  });
});

describe("detectText — over an injected detector (no browser)", () => {
  const fakeDetector = (values) => () => ({ detect: async () => values.map((v) => ({ rawValue: v })) });

  it("returns joined text + lines from detected blocks", async () => {
    const res = await detectText({}, { detectorFactory: fakeDetector(["Headline", "First para", "Second para"]) });
    expect(res.ok).toBe(true);
    expect(res.lines).toEqual(["Headline", "First para", "Second para"]);
    expect(res.text).toBe("Headline\nFirst para\nSecond para");
  });

  it("unsupported (no factory, no window) → ok:false reason 'unsupported', never throws", async () => {
    const res = await detectText({}, { win: {} });
    expect(res).toMatchObject({ ok: false, reason: "unsupported", text: "" });
  });

  it("a throwing detector is caught → ok:false, never throws to the caller", async () => {
    const res = await detectText({}, { detectorFactory: () => ({ detect: async () => { throw new Error("boom"); } }) });
    expect(res).toMatchObject({ ok: false, reason: "boom" });
  });

  it("no text found → ok:false with empty text", async () => {
    const res = await detectText({}, { detectorFactory: fakeDetector(["", "  "]) });
    expect(res.ok).toBe(false);
    expect(res.text).toBe("");
  });
});

describe("linesToArticle — rough article from raw lines", () => {
  it("first line is the title, the rest are paragraphs", () => {
    expect(linesToArticle(["Big Title", "Para one", "Para two"])).toEqual({
      title: "Big Title", author: "", date: "", publication: "", paragraphs: ["Para one", "Para two"],
    });
  });
  it("empty/garbage safe", () => {
    expect(linesToArticle([])).toEqual({ title: "", author: "", date: "", publication: "", paragraphs: [] });
    expect(linesToArticle(null).title).toBe("");
  });
});
