// Every page that switches its data row between views must be covered by the
// leak guards (Listen and Watch, 2026-10-27: Personal data was copied into the
// household rows). A section marked "toggle" in app.js's SECTION_SCOPE that
// views.js doesn't list would skip the mirror's scope stamp and the boot check.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { VIEW_TOGGLE_SECTIONS } from "../views.js";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function toggleSections() {
  const block = app.match(/const SECTION_SCOPE = \{([\s\S]*?)\n\};/);
  expect(block, "SECTION_SCOPE not found in app.js").toBeTruthy();
  return [...block[1].matchAll(/^\s*(\w+):\s*"toggle"/gm)].map((m) => m[1]).sort();
}

describe("views: every switchable section is guarded", () => {
  it("SECTION_SCOPE's toggle sections and VIEW_TOGGLE_SECTIONS agree", () => {
    expect(toggleSections()).toEqual([...VIEW_TOGGLE_SECTIONS].sort());
  });
  it("the local copy is stamped with every switchable section's scope", () => {
    expect(app).toMatch(/base\[MIRROR_SCOPES_FIELD\] = mirrorScopeStamp\(VIEW_TOGGLE_SECTIONS, sectionScope\)/);
  });
  it("boot takes the scopes from the local copy", () => {
    expect(app).toMatch(/resolveBootScopes\(saved, mirrorSectionScopes\)/);
  });
  it("a refresh or conflict merge checks its row is still on screen", () => {
    const guards = app.match(/sectionRowId\(stateId, section\) !== rowId/g) || [];
    expect(guards.length).toBeGreaterThanOrEqual(2);
  });
});
