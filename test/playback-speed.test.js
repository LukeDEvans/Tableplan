import { describe, it, expect } from "vitest";
import { snapPlaybackSpeed, stepPlaybackSpeed, formatSpeedLabel, speedStepperHtml, SPEED_MIN, SPEED_MAX } from "../playback-speed.js";

describe("playback speed: − / + in steps of 0.25", () => {
  it("steps by exactly 0.25 in each direction", () => {
    expect(stepPlaybackSpeed(1, 1)).toBe(1.25);
    expect(stepPlaybackSpeed(1.25, 1)).toBe(1.5);
    expect(stepPlaybackSpeed(1, -1)).toBe(0.75);
  });
  it("every reachable speed is a multiple of 0.25", () => {
    let v = SPEED_MIN; const seen = [v];
    for (let i = 0; i < 40; i++) { v = stepPlaybackSpeed(v, 1); seen.push(v); }
    expect(new Set(seen)).toEqual(new Set([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]));
  });
  it("stops at the ends", () => {
    expect(stepPlaybackSpeed(SPEED_MAX, 1)).toBe(SPEED_MAX);
    expect(stepPlaybackSpeed(SPEED_MIN, -1)).toBe(SPEED_MIN);
  });
  it("a speed saved by the old slider (0.05 steps) snaps to the nearest 0.25", () => {
    expect(snapPlaybackSpeed(1.35)).toBe(1.25);
    expect(snapPlaybackSpeed("1.4")).toBe(1.5);
    expect(stepPlaybackSpeed(1.35, 1)).toBe(1.5);
  });
  it("junk or nothing stored is normal speed", () => {
    for (const v of [null, undefined, "", "abc", NaN, 0, -2]) expect(snapPlaybackSpeed(v)).toBe(1);
  });
  it("labels trim trailing zeros", () => {
    expect(formatSpeedLabel(1)).toBe("1×");
    expect(formatSpeedLabel(1.25)).toBe("1.25×");
    expect(formatSpeedLabel(2.5)).toBe("2.5×");
  });
  it("the control disables the button that can't go further", () => {
    expect(speedStepperHtml(SPEED_MAX)).toMatch(/data-speed-step="1"[^>]*disabled/);
    expect(speedStepperHtml(SPEED_MIN)).toMatch(/data-speed-step="-1"[^>]*disabled/);
    expect(speedStepperHtml(1)).not.toMatch(/disabled/);
  });
});
