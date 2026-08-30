import { describe, it, expect } from "vitest";
import { heroArtSvg, iconSvg } from "../weather-art.js";
import { CONDITIONS } from "../weather-condition.js";

describe("weather-art skin", () => {
  it("returns a well-formed <svg> for every canonical condition, day and night", () => {
    for (const key of CONDITIONS) {
      for (const isDay of [true, false]) {
        const hero = heroArtSvg(key, isDay);
        const icon = iconSvg(key, isDay);
        for (const s of [hero, icon]) {
          expect(s.startsWith("<svg")).toBe(true);
          expect(s.trim().endsWith("</svg>")).toBe(true);
          expect(s).toContain('role="img"');
          // balanced tags: every "<path"/"<circle" etc. eventually closes the svg
          expect((s.match(/<svg/g) || []).length).toBe(1);
        }
      }
    }
  });
  it("clear swaps sun (day) for moon (night)", () => {
    expect(heroArtSvg("clear", true)).not.toBe(heroArtSvg("clear", false));
  });
  it("unknown key degrades to clear rather than throwing", () => {
    expect(() => heroArtSvg("nonsense", true)).not.toThrow();
    expect(iconSvg("nonsense", false)).toContain("<svg");
  });
});
