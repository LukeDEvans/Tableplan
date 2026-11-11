// The spreadsheet engine (SPREADSHEET_DESIGN.md §3): parsing, values, recalculation,
// references by identity, spills, cycles.

import { describe, it, expect } from "vitest";
import { parse, print, ParseError } from "../documents/sheet/engine/parser.js";
import { numberToText, textToNumber, textToDateSerial, parseTyped, serialFromYMD } from "../documents/sheet/engine/values.js";
import { book, show } from "./documents-sheet-helpers.js";

describe("parser", () => {
  const round = (s) => print(parse(s));
  it("reads and writes back every grammar piece", () => {
    for (const s of [
      "=1+2*3", "=(1+2)*3", "=-2^2", "=2^-1", "=10%", "=A1", "=$A$1", "=A$1:$B2", "=A:A", "=B:D", "=1:1", "=3:5", "=A2:A",
      "=Sheet2!A1", "='My tab'!B2:C9", "='It''s'!A1", "=SUM(A1:B2,3)", '="a""b"&"c"', "=TRUE", "=FALSE()", "=#N/A",
      "={1,2;3,4}", "=IF(A1,,2)", "=A1<>B1", "=A1<=B1", "=1E+20", "=LOG10(100)", "=tax_rate*2", "=SUM()",
    ]) expect(round(s)).toBe(s);
  });
  it("normalizes case and spaces", () => {
    expect(round("= sum( a1:b2 ) ")).toBe("=SUM(A1:B2)");
    expect(round("=b3:a1")).toBe("=A1:B3");
  });
  it("precedence: comparison < & < + < * < ^ < %, unary highest", () => {
    expect(print(parse("=1+2&3"))).toBe("=1+2&3");
    expect(parse("=1+2&3").op).toBe("&");
    expect(parse("=-2^2").op).toBe("^");
    expect(parse("=2^3^2").b.op).toBe("^"); // right-associative, as Sheets (512)
  });
  it("refuses bad formulas with a position", () => {
    for (const s of ["=", "=1+", "=SUM(1", '="abc', "={1,2;3}", "=1 2", "=#FOO"]) expect(() => parse(s)).toThrow(ParseError);
  });
  it("tells references from names and functions", () => {
    expect(parse("=LOG10(1)").t).toBe("fn");
    expect(parse("=ABC").t).toBe("name");
    expect(parse("=XFD1").t).toBe("ref");
    expect(parse("=A1B").t).toBe("name");
  });
});

describe("values", () => {
  it("numbers become text as Sheets shows them", () => {
    expect(numberToText(0.1 + 0.2)).toBe("0.3");
    expect(numberToText(1 / 3)).toBe("0.333333333333333");
    expect(numberToText(1e20)).toBe("1E+20");
    expect(numberToText(-12.5)).toBe("-12.5");
  });
  it("text numbers", () => {
    expect(textToNumber(" 1,234.5 ")).toBe(1234.5);
    expect(textToNumber("12%")).toBe(0.12);
    expect(textToNumber("$4")).toBe(4);
    expect(textToNumber("(5)")).toBe(-5);
    expect(textToNumber("1,23")).toBe(null);
    expect(textToNumber("abc")).toBe(null);
  });
  it("dates", () => {
    expect(serialFromYMD(1899, 12, 31)).toBe(1);
    expect(serialFromYMD(2026, 11, 9)).toBe(46335);
    expect(textToDateSerial("11/9/2026")).toBe(46335);
    expect(textToDateSerial("2026-11-09")).toBe(46335);
    expect(textToDateSerial("Nov 9, 2026")).toBe(46335);
    expect(textToDateSerial("2/30/2026")).toBe(null);
    expect(textToDateSerial("12:30")).toBe(0.5208333333333334);
  });
  it("typing", () => {
    expect(parseTyped("12%")).toEqual({ value: 0.12, format: "percent" });
    expect(parseTyped("'12").value).toBe("12");
    expect(parseTyped("true").value).toBe(true);
    expect(parseTyped("11/9/2026")).toEqual({ value: 46335, format: "date" });
  });
});

describe("recalculation", () => {
  it("follows chains and recomputes only after edits", () => {
    const b = book().fill({ A1: "2", A2: "=A1*10", A3: "=A2+A1" });
    expect(b.get("A3")).toBe(22);
    b.set("A1", "3");
    expect(b.get("A3")).toBe(33);
  });
  it("ranges see edits inside them", () => {
    const b = book().fill({ A1: "1", A2: "2", B1: "=SUM(A1:A5)", B2: "=SUM(A:A)" });
    expect(b.get("B1")).toBe(3);
    b.set("A5", "10");
    expect(b.get("B1")).toBe(13);
    expect(b.get("B2")).toBe(13);
  });
  it("a long chain down a column (no stack overflow)", () => {
    const b = book({ rows: 5000, cols: 2 });
    b.set("A1", "1");
    for (let i = 2; i <= 5000; i++) b.set(`A${i}`, `=A${i - 1}+1`);
    expect(b.get("A5000")).toBe(5000);
  });
  it("a long chain running upward (deferred evaluation)", () => {
    const b = book({ rows: 4000, cols: 2 });
    b.set("A4000", "1");
    for (let i = 3999; i >= 1; i--) b.set(`A${i}`, `=A${i + 1}+1`);
    expect(b.get("A1")).toBe(4000);
  });
  it("cycles are #REF! and recover when broken", () => {
    const b = book().fill({ A1: "=B1+1", B1: "=A1+1" });
    expect(show(b.get("A1"))).toBe("#REF!");
    expect(show(b.get("B1"))).toBe("#REF!");
    b.set("B1", "5");
    expect(b.get("A1")).toBe(6);
  });
  it("errors flow and are caught", () => {
    const b = book().fill({ A1: "=1/0", A2: "=A1+1", A3: "=IFERROR(A2,\"x\")" });
    expect(show(b.get("A2"))).toBe("#DIV/0!");
    expect(b.get("A3")).toBe("x");
  });
  it("unknown functions and names", () => {
    const b = book();
    expect(show(b.calc("=NOSUCH(1)"))).toBe("#NAME?");
    expect(show(b.calc("=nosuchname"))).toBe("#NAME?");
  });
});

describe("references by identity", () => {
  it("inserting rows above keeps formulas pointing at the same cells", () => {
    const b = book().fill({ A2: "5", A3: "7", B1: "=A2*2", B9: "=SUM(A2:A3)" });
    expect(b.get("B1")).toBe(10);
    b.insertRows(1, 2); // two rows before row 2
    expect(b.get("B1")).toBe(10);
    expect(b.text("B1")).toBe("=A4*2");
    expect(b.get("B11")).toBe(12);
    expect(b.text("B11")).toBe("=SUM(A4:A5)");
  });
  it("a range grows when rows are inserted inside it", () => {
    const b = book().fill({ A1: "1", A2: "2", A3: "3", B1: "=SUM(A1:A3)" });
    b.insertRows(1, 1);
    b.set("A2", "10");
    expect(b.get("B1")).toBe(16);
    expect(b.text("B1")).toBe("=SUM(A1:A4)");
  });
  it("a deleted row makes #REF!", () => {
    const b = book().fill({ A3: "4", B1: "=A3+1" });
    b.deleteRows(2, 1);
    expect(show(b.get("B1"))).toBe("#REF!");
    expect(b.text("B1")).toBe("=#REF!+1");
  });
  it("tabs by name", () => {
    const b = book({ tabs: ["Sheet1", "Data set"] });
    b.set("A1", "9", "Data set");
    b.set("A1", "='Data set'!A1*2");
    expect(b.get("A1")).toBe(18);
  });
});

describe("arrays that spill", () => {
  it("fills neighbours and feeds other formulas", () => {
    const b = book().fill({ A1: "=SEQUENCE(3,2)", D1: "=SUM(B1:B3)" });
    expect(b.grid("A1:B3")).toEqual([[1, 2], [3, 4], [5, 6]]);
    expect(b.get("D1")).toBe(12);
  });
  it("a blocked spill is #REF! and recovers when cleared", () => {
    const b = book().fill({ A1: "=SEQUENCE(3)", A3: "x" });
    expect(show(b.get("A1"))).toBe("#REF!");
    expect(b.get("A2")).toBe(null);
    b.set("A3", "");
    expect(b.get("A3")).toBe(3);
  });
  it("shrinking a spill clears the cells it left", () => {
    const b = book().fill({ B1: "3", A1: "=SEQUENCE(B1)" });
    expect(b.get("A3")).toBe(3);
    b.set("B1", "1");
    expect(b.get("A1")).toBe(1);
    expect(b.get("A3")).toBe(null);
  });
  it("a plain range spills; arithmetic on a range needs ARRAYFORMULA (as Sheets)", () => {
    const b = book().fill({ A1: "1", A2: "2", C1: "=A1:A2", D1: "=ARRAYFORMULA(A1:A2*10)", E1: "=A1:A2*10" });
    expect(b.grid("C1:D2")).toEqual([[1, 10], [2, 20]]);
    expect(show(b.get("E1"))).toBe("#VALUE!");
  });
});

describe("LET and LAMBDA", () => {
  it("LET names and LAMBDA helpers", () => {
    const b = book();
    expect(b.calc("=LET(x,2,y,x*3,x+y)")).toBe(8);
    expect(b.calc("=REDUCE(0,SEQUENCE(4),LAMBDA(a,v,a+v))")).toBe(10);
    expect(b.calc("=LET(sq,LAMBDA(n,n*n),sq(5))")).toBe(25);
  });
});
