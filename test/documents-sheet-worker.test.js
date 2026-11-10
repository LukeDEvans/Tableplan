// The calculation worker (SPREADSHEET_DESIGN.md §3): the page's copy of the answers
// must match the engine run directly, and the page must keep working when the worker
// can't start or dies.

import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { createSheetModel } from "../documents/sheet/model.js";
import { connectEngine } from "../documents/sheet/bridge.js";
import { createWorkerEngine } from "../documents/sheet/worker-client.js";
import { createEngineHost } from "../documents/sheet/engine/host.js";
import { createEngine } from "../documents/sheet/engine/engine.js";
import { functionCatalog } from "../documents/sheet/engine/functions/index.js";
import { isErr } from "../documents/sheet/engine/values.js";

// A stand-in Worker: messages are structured-cloned and answered on a later tick, like the real one.
function fakeWorker({ dieAfter = Infinity } = {}) {
  const host = createEngineHost();
  let n = 0;
  const w = {
    onmessage: null, onerror: null, terminated: false,
    postMessage(msg) {
      const copy = structuredClone(msg);
      setTimeout(() => {
        if (w.terminated) return;
        if (++n > dieAfter) { w.onerror?.({ preventDefault() {} }); return; }
        w.onmessage?.({ data: structuredClone(host.handle(copy)) });
      }, 0);
    },
    terminate() { w.terminated = true; },
  };
  return w;
}

function setup(makeWorker) {
  const ydoc = new Y.Doc();
  const model = createSheetModel(ydoc);
  model.init({ rows: 30, cols: 8 });
  let notified = 0;
  const eng = createWorkerEngine({ makeWorker, onChange: () => notified++ });
  connectEngine(model, eng);
  const tab = () => model.tabIds()[0];
  const val = (r, c) => { const v = eng.valueAt(tab(), r, c); return isErr(v) ? v.code : v; };
  return { ydoc, model, eng, tab, val, notified: () => notified };
}

describe("the calculation worker", () => {
  it("computes formulas off the page and sends the answers back", async () => {
    const s = setup(() => fakeWorker());
    expect(s.eng.inWorker).toBe(true);
    s.model.setInput(s.tab(), 0, 0, "2");
    s.model.setInput(s.tab(), 1, 0, "=A1*21");
    expect(s.val(0, 0)).toBe(2); // a typed constant shows at once
    await s.eng.whenIdle();
    expect(s.val(1, 0)).toBe(42);
    expect(s.notified()).toBeGreaterThan(0);
    s.model.setInput(s.tab(), 0, 0, "3");
    expect(s.val(1, 0)).toBe(42); // the old answer until the new one comes
    await s.eng.whenIdle();
    expect(s.val(1, 0)).toBe(63);
  });

  it("carries spills, errors and formula info across", async () => {
    const s = setup(() => fakeWorker());
    s.model.setInput(s.tab(), 0, 0, "=SEQUENCE(3)");
    s.model.setInput(s.tab(), 0, 1, "=1/0");
    s.model.setInput(s.tab(), 0, 2, "#N/A");
    await s.eng.whenIdle();
    expect([s.val(0, 0), s.val(1, 0), s.val(2, 0)]).toEqual([1, 2, 3]);
    const t = s.tab(), rows = s.model.rowIds(t), cols = s.model.colIds(t);
    expect(s.eng.spillAnchorOf(t, rows[2], cols[0])).toEqual({ row: rows[0], col: cols[0] });
    expect(s.eng.formulaInfo(t, rows[0], cols[0]).spill).toEqual({ h: 3, w: 1 });
    expect(s.val(0, 1)).toBe("#DIV/0!");
    expect(s.eng.formulaInfo(t, rows[0], cols[1]).error.code).toBe("#DIV/0!");
    expect(s.val(0, 2)).toBe("#N/A");
    // blocking the spill
    s.model.setInput(t, 1, 0, "x");
    await s.eng.whenIdle();
    expect(s.val(0, 0)).toBe("#REF!");
    expect(s.eng.spillAnchorOf(t, rows[2], cols[0])).toBe(null);
  });

  it("gives the same answers as the engine run directly", async () => {
    const s = setup(() => fakeWorker());
    const direct = createEngine({ functions: functionCatalog() });
    connectEngine(s.model, direct);
    const t = s.tab();
    const inputs = ["5", "=A1+1", "=SUM(A1:A2)", "=TEXT(A3,\"0.00\")", "=FILTER(A1:A3,A1:A3>5)", "=IFERROR(VLOOKUP(9,A1:B3,2,0),\"none\")", "hello", "=LEN(A7)", "=A1:A3", "=XLOOKUP(6,A1:A3,A1:A3)"];
    inputs.forEach((x, i) => s.model.setInput(t, i, 0, x));
    s.model.setInput(t, 0, 3, "=ROWS(A:A)");
    await s.eng.whenIdle();
    for (let r = 0; r < 14; r++) for (let c = 0; c < 4; c++) {
      const a = s.eng.valueAt(t, r, c), b = direct.valueAt(t, r, c);
      expect(isErr(a) ? a.code : a, `r${r} c${c}`).toEqual(isErr(b) ? b.code : b);
    }
  });

  it("follows inserted rows and new tabs", async () => {
    const s = setup(() => fakeWorker());
    const t = s.tab();
    s.model.setInput(t, 0, 0, "1");
    s.model.setInput(t, 1, 0, "=A1+1");
    s.model.insertRows(t, 0, 2);
    await s.eng.whenIdle();
    expect(s.val(3, 0)).toBe(2);
    const t2 = s.model.addTab({ name: "Two", rows: 5, cols: 3 });
    s.model.setInput(t2, 0, 0, "=Sheet1!A3*10");
    await s.eng.whenIdle();
    const v = s.eng.valueAt(t2, 0, 0);
    expect(v).toBe(10);
  });

  it("runs on the page when the worker can't start", async () => {
    const s = setup(() => { throw new Error("no workers here"); });
    expect(s.eng.inWorker).toBe(false);
    s.model.setInput(s.tab(), 0, 0, "4");
    s.model.setInput(s.tab(), 1, 0, "=A1^2");
    await s.eng.whenIdle();
    expect(s.val(1, 0)).toBe(16);
  });

  it("moves to the page, with everything so far, when the worker dies", async () => {
    const s = setup(() => fakeWorker({ dieAfter: 2 }));
    const t = s.tab();
    s.model.setInput(t, 0, 0, "4");
    await s.eng.whenIdle();
    s.model.setInput(t, 1, 0, "=A1*2");
    await s.eng.whenIdle();
    s.model.setInput(t, 2, 0, "=A2+A1"); // the worker dies on this one
    await s.eng.whenIdle();
    expect(s.eng.inWorker).toBe(false);
    expect([s.val(0, 0), s.val(1, 0), s.val(2, 0)]).toEqual([4, 8, 12]);
    s.model.setInput(t, 0, 0, "5");
    await s.eng.whenIdle();
    expect(s.val(2, 0)).toBe(15);
  });
});
