// dock-space.js: the room a window has ends at the bottom dock's top edge.
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { usableViewportBottom, dockInset } from "../dock-space.js";

function stubScreen({ innerHeight, dock }) {
  vi.stubGlobal("window", { innerHeight });
  vi.stubGlobal("document", {
    getElementById: (id) => (id === "bottomDock" && dock ? { getBoundingClientRect: () => dock } : null),
  });
}

describe("dock-space", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ends the usable screen at the dock's top edge", () => {
    stubScreen({ innerHeight: 844, dock: { top: 756, height: 88 } });
    expect(usableViewportBottom()).toBe(756);
    expect(dockInset()).toBe(88);
  });

  it("uses the whole screen when the dock is hidden (signed out)", () => {
    stubScreen({ innerHeight: 844, dock: { top: 0, height: 0 } });
    expect(usableViewportBottom()).toBe(844);
    expect(dockInset()).toBe(0);
  });

  it("uses the whole screen when there is no dock in the document", () => {
    stubScreen({ innerHeight: 640, dock: null });
    expect(usableViewportBottom()).toBe(640);
  });

  // The dock is permanent, so a menu clamped to window.innerHeight opens behind it.
  it("no UI module clamps against window.innerHeight", () => {
    const files = ["app.js", "contacts.js", "finance-ui.js", "groceries-ui.js", "inventory-ui.js", "mealplan-ui.js", "recipes-ui.js", "sortable.js", "news-ui.js", "weather-ui.js"];
    const offenders = files.filter((f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8").includes("window.innerHeight"));
    expect(offenders, "use usableViewportBottom() from dock-space.js").toEqual([]);
  });
});
