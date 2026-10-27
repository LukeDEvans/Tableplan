// Every test file runs somewhere (ISSUES.md P3, 2026-09-30): vitest only runs the
// files its include list names, and the older node:test files run under
// `npm run test:node`. A file in neither list never runs, which is how
// dock-space, playback-speed and podcast-retention sat unrun.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

function globToRegExp(glob) {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`);
}

describe("test coverage of the test folder", () => {
  it("every test file is run by vitest or node --test", () => {
    const vitestIncludes = [...read("vitest.config.mjs").matchAll(/"(test\/[^"]+)"/g)].map((m) => globToRegExp(m[1]));
    const nodeScript = JSON.parse(read("package.json")).scripts["test:node"] || "";
    const nodeFiles = new Set(nodeScript.split(/\s+/).filter((t) => t.startsWith("test/")));
    const files = readdirSync(new URL("test/", root)).filter((f) => /\.test\.m?js$/.test(f)).map((f) => `test/${f}`);
    const unrun = files.filter((f) => !nodeFiles.has(f) && !vitestIncludes.some((re) => re.test(f)));
    expect(unrun).toEqual([]);
  });

  it("npm test runs both", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    expect(scripts.test).toContain("vitest run");
    expect(scripts.test).toContain("test:node");
  });
});
