import { describe, it, expect } from "vitest";
import { gameCardHtml } from "../scores-ui.js";
import { cleanGame } from "../sports-model.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const team = (name, abbr) => ({ name, short: name, abbr, refs: { espn: abbr } });

describe("ticker game card (Household / Business)", () => {
  const game = cleanGame({
    id: "g1", league: "nfl", start: "2026-10-20T00:20:00Z", state: "live", detail: "3rd 5:32",
    venue: "U.S. Bank Stadium", broadcasts: ["NBC"],
    home: { team: team("Minnesota Vikings", "MIN"), score: 21 },
    away: { team: team("Green Bay <Packers>", "GB"), score: 17 },
  });
  it("shows league, status, both teams with scores, and the extras", () => {
    const html = gameCardHtml(game, esc);
    expect(html).toMatch(/NFL/);
    expect(html).toMatch(/3rd 5:32/);
    expect(html).toMatch(/is-live/);
    expect(html).toMatch(/Minnesota Vikings/);
    expect(html).toMatch(/>21</);
    expect(html).toMatch(/U\.S\. Bank Stadium · NBC/);
  });
  it("escapes team names", () => {
    expect(gameCardHtml(game, esc)).toMatch(/Green Bay &lt;Packers&gt;/);
    expect(gameCardHtml(game, esc)).not.toMatch(/<Packers>/);
  });
  it("away is listed above home", () => {
    const html = gameCardHtml(game, esc);
    expect(html.indexOf("Green Bay")).toBeLessThan(html.indexOf("Minnesota"));
  });
  it("a game that's gone from the board says so", () => {
    expect(gameCardHtml(null, esc)).toMatch(/isn't on the board/);
  });
});
