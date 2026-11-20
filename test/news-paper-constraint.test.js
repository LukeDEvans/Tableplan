// Every paper the feed job stores must be allowed by news_articles_paper_check.
// A new paper without a migration made every hourly run fail (2026-11-18).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const allowed = (() => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let last = null;
  for (const f of files) {
    const sql = readFileSync(new URL(f, dir), "utf8");
    const m = [...sql.matchAll(/news_articles_paper_check[\s\S]*?array\[([^\]]+)\]/gi)].pop()
      || (/create table[^;]*news_articles[\s\S]*?paper[^,]*?in \(([^)]+)\)/i.exec(sql));
    if (m) last = m[1];
  }
  return new Set((last || "").match(/'([a-z]+)'/g).map((s) => s.replace(/'/g, "")));
})();

describe("news_articles paper rule", () => {
  it("allows every paper the feed job stores", () => {
    const src = readFileSync(new URL("../netlify/functions/_news-feeds.js", import.meta.url), "utf8");
    const papers = new Set([...src.matchAll(/paper: "([a-z]+)"/g)].map((m) => m[1]));
    expect(papers.size).toBeGreaterThan(3);
    for (const p of papers) expect(allowed, `add "${p}" to news_articles_paper_check in a migration`).toContain(p);
  });
});
