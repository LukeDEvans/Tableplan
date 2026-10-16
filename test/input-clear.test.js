import { describe, it, expect } from "vitest";
import { isClearableField, shouldShowClear, MIN_FIELD_WIDTH, paddingNeeded, BUTTON_SIZE } from "../input-clear.js";

function field({ tag = "INPUT", type = "text", value = "", disabled = false, readOnly = false, optOut = false, connected = true } = {}) {
  return {
    nodeType: 1, tagName: tag, type, value, disabled, readOnly, isConnected: connected,
    getAttribute: (k) => (k === "type" ? type : null),
    closest: (sel) => (sel === "[data-no-clear]" && optOut ? {} : null),
  };
}

describe("isClearableField", () => {
  it("covers single-line text boxes", () => {
    for (const type of ["text", "search", "email", "url", "tel"]) expect(isClearableField(field({ type }))).toBe(true);
  });
  it("skips textareas, passwords, numbers, dates and toggles", () => {
    expect(isClearableField(field({ tag: "TEXTAREA" }))).toBe(false);
    for (const type of ["password", "number", "date", "time", "checkbox", "range", "file", "hidden"]) {
      expect(isClearableField(field({ type }))).toBe(false);
    }
  });
  it("skips read-only, disabled and opted-out fields", () => {
    expect(isClearableField(field({ readOnly: true }))).toBe(false);
    expect(isClearableField(field({ disabled: true }))).toBe(false);
    expect(isClearableField(field({ optOut: true }))).toBe(false);
  });
  it("ignores non-elements", () => {
    expect(isClearableField(null)).toBe(false);
    expect(isClearableField({ nodeType: 3 })).toBe(false);
  });
});

describe("shouldShowClear", () => {
  const wide = MIN_FIELD_WIDTH + 100;
  it("shows only once the user has typed and there is text", () => {
    expect(shouldShowClear(field({ value: "eggs" }), { typed: true, width: wide })).toBe(true);
    expect(shouldShowClear(field({ value: "eggs" }), { typed: false, width: wide })).toBe(false);
    expect(shouldShowClear(field({ value: "" }), { typed: true, width: wide })).toBe(false);
  });
  it("hides on boxes too narrow for it and on detached boxes", () => {
    expect(shouldShowClear(field({ value: "x" }), { typed: true, width: MIN_FIELD_WIDTH - 1 })).toBe(false);
    expect(shouldShowClear(field({ value: "x", connected: false }), { typed: true, width: wide })).toBe(false);
  });
  it("leaves room for the button in the padding", () => {
    expect(paddingNeeded()).toBeGreaterThan(BUTTON_SIZE);
  });
});
