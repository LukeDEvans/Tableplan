import { describe, it, expect } from "vitest";
import { evaluate, formatNumber, createCalculator, press } from "../calculator.js";

const run = (keys) => keys.reduce((s, k) => press(s, k), createCalculator());

describe("evaluate", () => {
  it("does precedence, parentheses and unary minus", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("-3*-2")).toBe(6);
    expect(evaluate("10/4")).toBe(2.5);
  });
  it("does phone-style percent", () => {
    expect(evaluate("50%")).toBe(0.5);
    expect(evaluate("200+10%")).toBe(220);
    expect(evaluate("200-25%")).toBe(150);
    expect(evaluate("50*10%")).toBe(5);
  });
  it("refuses division by zero and junk", () => {
    expect(() => evaluate("1/0")).toThrow(/divide/);
    expect(() => evaluate("2+")).toThrow();
    expect(() => evaluate("alert(1)")).toThrow();
  });
});

describe("formatNumber", () => {
  it("hides float noise and groups thousands", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(1234567.5)).toBe("1,234,567.5");
    expect(formatNumber(-1234)).toBe("-1,234");
  });
});

describe("press", () => {
  it("builds and evaluates, adding to the tape", () => {
    const s = run(["1", "2", "+", "3", "*", "2", "="]);
    expect(s.display).toBe("18");
    expect(s.history[0]).toEqual({ expr: "12+3×2", result: "18" });
  });
  it("replaces a repeated operator and starts fresh after =", () => {
    expect(run(["5", "+", "*", "2", "="]).display).toBe("10");
    expect(run(["2", "=", "7"]).display).toBe("7");
    expect(run(["2", "=", "+", "1", "="]).display).toBe("3");
  });
  it("one decimal point per number, no leading zeros", () => {
    expect(run([".", "5", ".", "5"]).display).toBe("0.55");
    expect(run(["0", "0", "7"]).display).toBe("7");
  });
  it("± flips the number being typed", () => {
    expect(run(["5", "±"]).display).toBe("-5");
    expect(run(["5", "*", "3", "±", "="]).display).toBe("-15");
  });
  it("shows an error for 1/0 and clears with C", () => {
    const s = run(["1", "/", "0", "="]);
    expect(s.display).toBe("Can't divide by 0");
    expect(press(s, "C").display).toBe("0");
  });
});

describe("iPhone-style display and scientific keys", () => {
  it("shows the whole expression while typing, then moves it above the result", () => {
    const typing = run(["1", "2", "0", "0", "+", "3", "*", "2"]);
    expect(typing.display).toBe("1,200+3×2");
    const done = press(typing, "=");
    expect(done.display).toBe("1,206");
    expect(done.shown).toBe("1,200+3×2");
    expect(press(done, "7").shown).toBe("");
  });
  it("applies x², √, 1/x to the number being typed or the result", () => {
    expect(press(run(["1", "2", "+", "3", "x²"]), "=").display).toBe("21");
    expect(run(["9", "√"]).display).toBe("3");
    expect(run(["4", "1/x"]).display).toBe("0.25");
    expect(run(["3", "=", "x³"]).display).toBe("27");
    expect(run(["0", "1/x"]).display).toBe("Can't divide by 0");
  });
  it("π replaces the number being typed and follows an operator", () => {
    expect(run(["2", "*", "π"]).display).toBe("2×3.14159265359");
    expect(press(run(["2", "*", "π"]), "=").display).toBe("6.283185307");
  });
});
