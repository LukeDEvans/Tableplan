import { describe, it, expect } from "vitest";
import { createOperationTracker, OP_STATUS } from "../async-operation.js";

describe("createOperationTracker — async-operation status contract", () => {
  it("tracks an operation through its lifecycle", () => {
    const t = createOperationTracker();
    t.start("imp1", "Import recipe");
    expect(t.get("imp1").status).toBe(OP_STATUS.RUNNING);
    expect(t.active().map((o) => o.id)).toEqual(["imp1"]);
    t.update("imp1", { progress: 0.5 });
    expect(t.get("imp1").progress).toBe(0.5);
    t.succeed("imp1");
    expect(t.get("imp1").status).toBe(OP_STATUS.SUCCESS);
    expect(t.get("imp1").progress).toBe(1);
    expect(t.active()).toEqual([]); // no longer in-flight
  });

  it("records failures with a message", () => {
    const t = createOperationTracker();
    t.start("scan1", "Scan receipt");
    t.fail("scan1", new Error("network"));
    expect(t.get("scan1").status).toBe(OP_STATUS.ERROR);
    expect(t.get("scan1").error).toBe("network");
  });

  it("cancel moves to a terminal state", () => {
    const t = createOperationTracker();
    t.start("tts1", "Generate audio");
    t.cancel("tts1");
    expect(t.get("tts1").status).toBe(OP_STATUS.CANCELLED);
    expect(t.active()).toEqual([]);
  });

  it("restarting a known id resets it to running (idempotent start)", () => {
    const t = createOperationTracker();
    t.start("x", "op"); t.fail("x", "boom");
    t.start("x", "op");
    expect(t.get("x").status).toBe(OP_STATUS.RUNNING);
    expect(t.get("x").error).toBe(null);
    expect(t.list().filter((o) => o.id === "x").length).toBe(1); // not duplicated
  });

  it("update/succeed/fail on an unknown id are no-ops", () => {
    const t = createOperationTracker();
    expect(t.update("nope", { progress: 1 })).toBe(null);
    expect(t.succeed("nope")).toBe(null);
    expect(t.fail("nope", "e")).toBe(null);
  });

  it("caps history by dropping oldest TERMINAL ops, never a live one", () => {
    const t = createOperationTracker({ cap: 3 });
    t.start("live", "running"); // stays running
    for (let i = 0; i < 5; i++) { t.start(`d${i}`, "done"); t.succeed(`d${i}`); }
    const ids = t.list().map((o) => o.id);
    expect(ids).toContain("live");        // the live op survived the prune
    expect(t.list().length).toBeLessThanOrEqual(3);
  });
});
