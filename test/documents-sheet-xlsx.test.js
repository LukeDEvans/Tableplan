// Excel in and out (SPREADSHEET_DESIGN.md §7): our .xlsx writer and reader, round trip,
// plus the details Excel and Google rely on (cached values, _xlfn., shared formulas).

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { zipSync, strToU8, unzipSync, strFromU8 } from "fflate";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { toXlsx, excelFormula } from "../documents/sheet/xlsx-export.js";
import { readXlsx, xlsxIntoModel, fromExcelFormula } from "../documents/sheet/xlsx-import.js";
import { rangeFromA1 } from "../documents/sheet/rules.js";

function book() {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  const engine = createEngine({ functions: functionCatalog() });
  connectEngine(model, engine);
  return { ydoc, model, engine };
}
function sample() {
  const b = book();
  b.model.init({ tabName: "Budget" });
  const t = b.model.tabIds()[0];
  const put = (r, c, x) => b.model.setInput(t, r, c, x);
  [["Item", "Cost", "Paid"], ["Rent", "1200", "TRUE"], ["Food", "450.5", "FALSE"], ["007", "", ""]].forEach((row, r) => row.forEach((x, c) => x && put(r, c, c === 0 && r === 3 ? "'007" : x)));
  put(5, 1, "=SUM(B2:B3)");
  put(6, 1, "=SEQUENCE(2)");
  put(0, 4, "=XLOOKUP(\"Food\",A2:A3,B2:B3)");
  put(9, 0, "Café ☕ <&> \"quoted\"");
  b.model.setStyle(t, 0, 0, 0, 2, { bold: true, fill: "#ffe599", borderBottom: { style: "medium", color: "#000000" } });
  b.model.setStyle(t, 1, 1, 3, 1, { format: "$#,##0.00", halign: "right" });
  b.model.setColMeta(t, 0, 0, { size: 180 });
  b.model.setRowMeta(t, 0, 0, { size: 32 });
  b.model.setColMeta(t, 3, 3, { hidden: true });
  b.model.mergeRange(t, 9, 0, 9, 2);
  b.model.setTabProps(t, { frozenRows: 1, color: "#4472c4" });
  b.model.setName("Costs", "B2:B3", t);
  b.model.setRule(t, null, { kind: "valid", type: "list", ranges: [rangeFromA1(b.model, t, "C2:C4")], items: ["TRUE", "FALSE"], reject: true });
  const t2 = b.model.addTab({ name: "Other tab" });
  b.model.setInput(t2, 0, 0, "='Budget'!B6*2");
  return { ...b, t, t2 };
}

describe("writing .xlsx", () => {
  it("prefixes newer functions, leaves quoted text alone", () => {
    expect(excelFormula('=XLOOKUP(1,A:A,B:B)+SUM(1)&"FILTER(x)"')).toBe('_xlfn.XLOOKUP(1,A:A,B:B)+SUM(1)&"FILTER(x)"');
    expect(excelFormula("='My SORT(tab)'!A1+sort(B1:B3)")).toBe("'My SORT(tab)'!A1+_xlfn.SORT(B1:B3)");
    expect(fromExcelFormula("_xlfn.XLOOKUP(1,_xlfn.SEQUENCE(3),A1:A3)")).toBe("=XLOOKUP(1,SEQUENCE(3),A1:A3)");
  });
  it("writes cached values, array formulas over their block, and the parts Excel needs", () => {
    const s = sample();
    const z = unzipSync(toXlsx(s.model, s.engine));
    for (const p of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/sharedStrings.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) expect(z[p], p).toBeTruthy();
    const sh = strFromU8(z["xl/worksheets/sheet1.xml"]);
    expect(sh).toContain('<c r="B6"><f>SUM(B2:B3)</f><v>1650.5</v></c>');
    expect(sh).toContain('<f t="array" ref="B7:B8">_xlfn.SEQUENCE(2)</f><v>1</v>');
    expect(sh).toContain('<c r="B8"><v>2</v></c>');
    expect(sh).toContain("<pane ySplit=\"1\"");
    expect(sh).toContain('<mergeCell ref="A10:C10"/>');
    expect(sh).toContain('<dataValidation type="list"');
    expect(strFromU8(z["xl/sharedStrings.xml"])).toContain("Café ☕ &lt;&amp;&gt; &quot;quoted&quot;");
  });
});

describe("reading .xlsx", () => {
  it("round-trips our own file", () => {
    const s = sample();
    const back = book();
    const { notes } = xlsxIntoModel(back.model, toXlsx(s.model, s.engine));
    expect(notes).toEqual([]);
    const [t, t2] = back.model.tabIds();
    expect(back.model.tabIds().map((id) => back.model.tabInfo(id).name)).toEqual(["Budget", "Other tab"]);
    const v = (r, c, tab = t) => back.engine.valueAt(tab, r, c);
    expect([v(0, 0), v(1, 1), v(1, 2), v(3, 0), v(5, 1), v(6, 1), v(7, 1), v(0, 4), v(9, 0)]).toEqual(["Item", 1200, true, "007", 1650.5, 1, 2, 450.5, "Café ☕ <&> \"quoted\""]);
    expect(back.model.inputText(t, 5, 1)).toBe("=SUM(B2:B3)");
    expect(back.model.inputText(t, 0, 4)).toBe('=XLOOKUP("Food",A2:A3,B2:B3)');
    expect(v(0, 0, t2)).toBe(3301);
    const st = back.model.style(back.model.cellAt(t, 0, 0).s);
    expect(st).toMatchObject({ bold: true, fill: "#ffe599", borderBottom: { style: "medium", color: "#000000" } });
    expect(back.model.style(back.model.cellAt(t, 1, 1).s)).toMatchObject({ format: "$#,##0.00", halign: "right" });
    expect(back.model.colMeta(t, back.model.colIds(t)[0]).w).toBe(180);
    expect(back.model.colMeta(t, back.model.colIds(t)[3]).hidden).toBe(true);
    expect(back.model.rowMeta(t, back.model.rowIds(t)[0]).h).toBe(32);
    expect(back.model.mergesOf(t)).toEqual([{ r1: 9, c1: 0, r2: 9, c2: 2 }]);
    expect(back.model.tabInfo(t)).toMatchObject({ frozenRows: 1, color: "#4472c4" });
    expect(back.model.nameList().map((n) => n.name)).toEqual(["Costs"]);
    expect(back.model.rulesOf(t).map((r) => [r.type, r.items, r.reject])).toEqual([["list", ["TRUE", "FALSE"], true]]);
  });
  it("expands shared formulas and reads inline strings, booleans and errors", () => {
    const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
      <row r="1"><c r="A1"><v>1</v></c><c r="B1"><f t="shared" ref="B1:B3" si="0">A1*2</f><v>2</v></c><c r="C1" t="inlineStr"><is><t>hi</t></is></c></row>
      <row r="2"><c r="A2"><v>2</v></c><c r="B2"><f t="shared" si="0"/><v>4</v></c><c r="C2" t="b"><v>1</v></c></row>
      <row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" si="0"/><v>6</v></c><c r="C3" t="e"><v>#N/A</v></c></row>
      </sheetData></worksheet>`;
    const files = {
      "xl/workbook.xml": strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`),
      "xl/worksheets/sheet1.xml": strToU8(sheet),
    };
    const wb = readXlsx(zipSync(files));
    expect(wb.sheets[0].cells.filter((c) => c.c === 1).map((c) => c.formula)).toEqual(["=A1*2", "=A2*2", "=A3*2"]);
    const b = book();
    xlsxIntoModel(b.model, zipSync(files));
    const t = b.model.tabIds()[0];
    expect([0, 1, 2].map((r) => b.engine.valueAt(t, r, 1))).toEqual([2, 4, 6]);
    expect([b.engine.valueAt(t, 0, 2), b.engine.valueAt(t, 1, 2), b.engine.valueAt(t, 2, 2).code]).toEqual(["hi", true, "#N/A"]);
  });
  it("refuses something that isn't a spreadsheet", () => {
    expect(() => readXlsx(new Uint8Array([1, 2, 3]))).toThrow(/isn't an Excel/);
  });
  it("reads a file written the way Google Sheets writes .xlsx", () => {
    // the quirks seen in Google's own export (2026-11-10): single-cell formulas as array
    // formulas, t="str" formula answers, decimal pane splits, a height on every row and a
    // width on every column (default ones included), theme font colours, lightGray fill
    const W = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    const sheet = `${W}<sheetPr><tabColor rgb="FF4472C4"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="1.0" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <sheetFormatPr customHeight="1" defaultColWidth="12.63" defaultRowHeight="15.0"/><cols><col customWidth="1" min="1" max="1" width="25.0"/><col customWidth="1" min="2" max="26" width="13.63"/></cols>
      <sheetData><row r="1" ht="24.0" customHeight="1"><c r="A1" s="2" t="s"><v>0</v></c><c r="B1" s="2" t="s"><v>1</v></c><c r="E1" s="3"><f t="array" ref="E1">_xlfn.XLOOKUP(&quot;Food&quot;,A2:A3,B2:B3)</f><v>450.5</v></c></row>
      <row r="2" ht="15.75" customHeight="1"><c r="A2" s="1" t="s"><v>2</v></c><c r="B2" s="4"><v>1200.0</v></c><c r="E2" s="1" t="str"><f>B2/0</f><v>#DIV/0!</v></c><c r="F2" s="1"/></row>
      <row r="3" ht="15.75" customHeight="1"><c r="A3" s="1" t="s"><v>3</v></c><c r="B3" s="4"><v>450.5</v></c></row>
      <row r="4" ht="15.75" customHeight="1"><c r="B4" s="1"><f t="array" ref="B4:B5">SEQUENCE(2,1)</f><v>1</v></c></row><row r="5" ht="15.75" customHeight="1"><c r="B5" s="1"><v>2.0</v></c></row>
      <row r="6" ht="15.75" customHeight="1"/></sheetData><dataValidations><dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="F2:F4"><formula1>&quot;Yes,No&quot;</formula1></dataValidation></dataValidations></worksheet>`;
    const styles = `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="$#,##0.00"/></numFmts>
      <fonts count="4"><font><sz val="10.0"/><color rgb="FF000000"/><name val="Arial"/></font><font><color theme="1"/><name val="Arial"/></font><font><b/><sz val="10.0"/><color theme="1"/><name val="Arial"/></font><font><sz val="10.0"/><color theme="1"/><name val="Arial"/></font></fonts>
      <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="lightGray"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE599"/><bgColor rgb="FFFFE599"/></patternFill></fill></fills>
      <borders count="2"><border/><border><left/><right/><top/><bottom style="medium"><color rgb="FF000000"/></bottom></border></borders>
      <cellXfs count="5"><xf borderId="0" fillId="0" fontId="0" numFmtId="0"><alignment vertical="bottom" wrapText="0"/></xf><xf borderId="0" fillId="0" fontId="1" numFmtId="0"/><xf borderId="1" fillId="2" fontId="2" numFmtId="0"/><xf borderId="0" fillId="0" fontId="1" numFmtId="164"/><xf borderId="0" fillId="0" fontId="3" numFmtId="164"><alignment horizontal="right"/></xf></cellXfs></styleSheet>`;
    const files = {
      "xl/workbook.xml": strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet state="visible" name="Budget" sheetId="1" r:id="rId5"/></sheets><definedNames><definedName name="Costs">Budget!$B$2:$B$3</definedName></definedNames><calcPr/></workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Target="worksheets/sheet1.xml" Type="x"/></Relationships>`),
      "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/styles.xml": strToU8(styles),
      "xl/sharedStrings.xml": strToU8(`<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Item</t></si><si><t>Cost</t></si><si><t>Rent</t></si><si><t>Food</t></si></sst>`),
    };
    const b = book();
    expect(xlsxIntoModel(b.model, zipSync(files)).notes).toEqual([]);
    const t = b.model.tabIds()[0];
    const v = (r, c) => b.engine.valueAt(t, r, c);
    expect([v(0, 4), v(1, 4).code, v(3, 1), v(4, 1)]).toEqual([450.5, "#DIV/0!", 1, 2]);
    expect(b.model.tabInfo(t)).toMatchObject({ frozenRows: 1, color: "#4472c4" });
    expect(b.model.style(b.model.cellAt(t, 0, 0).s)).toEqual({ bold: true, fill: "#ffe599", borderBottom: { style: "medium", color: "#000000" } });
    expect(b.model.style(b.model.cellAt(t, 1, 1).s)).toEqual({ format: "$#,##0.00", halign: "right" });
    expect(b.model.colMeta(t, b.model.colIds(t)[0]).w).toBe(180);
    expect(b.model.colMeta(t, b.model.colIds(t)[1])?.w).toBeUndefined(); // Google's "custom" default width isn't kept
    expect(b.model.rowMeta(t, b.model.rowIds(t)[0]).h).toBe(32);
    expect(b.model.rowMeta(t, b.model.rowIds(t)[2])?.h).toBeUndefined(); // nor its default heights
    expect(b.model.nameList().map((n) => n.name)).toEqual(["Costs"]);
    expect(b.model.rulesOf(t).map((r) => r.items)).toEqual([["Yes", "No"]]);
  });
});
