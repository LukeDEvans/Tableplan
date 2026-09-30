import { describe, it, expect } from "vitest";
import { ingredientOptionListHtml } from "../recipes-ui.js";

// REC-4: ingredient editor selects must not drop values that aren't in the option list.
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const selectedValues = (html) => [...html.matchAll(/<option value="([^"]*)" selected>/g)].map((m) => m[1]);

describe("ingredientOptionListHtml (REC-4)", () => {
  const opts = ["", "1/2", "1", "1 1/2", "2"];
  it("selects an in-list value without adding extras", () => {
    const html = ingredientOptionListHtml(opts, "1 1/2", esc);
    expect(selectedValues(html)).toEqual(["1 1/2"]);
    expect(html.match(/<option/g)).toHaveLength(5);
  });
  it.each(["400", "1.5", "stick"])("appends out-of-list value %s as selected", (v) => {
    const html = ingredientOptionListHtml(opts, v, esc);
    expect(selectedValues(html)).toEqual([v]);
    expect(html.match(/<option/g)).toHaveLength(6);
  });
  it("escapes the appended value", () => {
    const html = ingredientOptionListHtml(opts, '"><script>', esc);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
  });
  it("adds nothing for empty / missing values", () => {
    expect(ingredientOptionListHtml(opts, "", esc).match(/<option/g)).toHaveLength(5);
    expect(ingredientOptionListHtml(opts, undefined, esc).match(/<option/g)).toHaveLength(5);
  });
});
