import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// A view switch swaps ONE section's data (setSectionScope). applyStoredState
// clears lastWrittenSections (it's meant for whole-state replacements), so the
// next save used to re-send every section row — ~15 writes, Household rows
// included, after a single tick (WATCH_AUDIT.md D2, 2026-10-31 edge logs).
// setSectionScope must put the written-record back right after the swap.

const root = fileURLToPath(new URL("..", import.meta.url));
const src = readFileSync(root + "app.js", "utf8");

function fnBody(name) {
  const start = src.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`${name} not found`);
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end);
}

describe("a view switch doesn't re-send every section (D2)", () => {
  const body = fnBody("setSectionScope");

  it("keeps the written-record across applyStoredState", () => {
    const keep = body.indexOf("const writtenBeforeSwap = lastWrittenSections;");
    const apply = body.indexOf("applyStoredState(draft);");
    const restore = body.indexOf("if (writtenBeforeSwap) lastWrittenSections = writtenBeforeSwap;");
    expect(keep).toBeGreaterThan(-1);
    expect(apply).toBeGreaterThan(keep);
    expect(restore).toBeGreaterThan(apply);
    // Nothing between the swap and the restore may save.
    expect(body.slice(apply, restore)).not.toMatch(/persist\(|saveStateToSharedStorage\(|writeSectionWithMerge\(/);
  });

  it("applyStoredState still clears it for whole-state replacements", () => {
    const start = src.indexOf("function applyStoredState(storedState) {");
    const end = src.indexOf("\n}\n", start);
    expect(src.slice(start, end)).toContain("lastWrittenSections = null;");
  });
});
