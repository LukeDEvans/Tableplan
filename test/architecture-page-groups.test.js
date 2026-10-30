// The landing links and the page-title menu are both built from page-groups.js's
// list (Luke, 2026-10-17). The buttons are static markup in index.html — other code
// and the QA scripts find them by id — so this checks the markup still matches the
// list: same groups, same pages, same order, in both menus, and that app.js wires
// every button.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PAGE_GROUPS, groupForArea } from "../page-groups.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(`${root}/index.html`, "utf8");
const app = readFileSync(`${root}/app.js`, "utf8");

const PAGE_LABEL = {
  calendar: "Calendar", "meal-plan": "Meal Plan", tasks: "Tasks", news: "News", weather: "Weather",
  finance: "Finance", shop: "Shop", watch: "Watch", listen: "Listen", mail: "Message",
  explore: "Explore", exercise: "Exercise", leisure: "Leisure", scores: "Scores",
};

// The groups inside one menu, as [{ key, head, pages: [{ id, label }] }].
function menuGroups(containerId) {
  const start = html.indexOf(`id="${containerId}"`);
  expect(start).toBeGreaterThan(0);
  const tag = html.lastIndexOf("<", start);
  const close = html.slice(tag, tag + 6) === "<nav c" ? "</nav>" : null;
  const body = html.slice(start, close ? html.indexOf(close, start) : html.indexOf("\n              </div>\n", start));
  const groups = [];
  const re = /data-page-group="([^"]+)">\s*<button[^>]*class="page-group-head"[^>]*><span>([^<]+)<\/span>[\s\S]*?<div class="page-group-pages"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(body))) {
    const pages = [...m[3].matchAll(/<button type="button" id="([^"]+)">([^<]+)<\/button>/g)].map((p) => ({ id: p[1], label: p[2] }));
    groups.push({ key: m[1], head: m[2], pages });
  }
  return groups;
}

describe("page groups", () => {
  it("has the six groups Luke set, in order", () => {
    expect(PAGE_GROUPS.map((g) => g.label)).toEqual(["Plan", "Inform", "Resource", "Media", "Message", "Recreate"]);
    // Tasks (inside the Calendar), Weather (the dock) and Scores (News → Sports)
    // have no menu entry since 2026-10-20.
    expect(PAGE_GROUPS.find((g) => g.key === "recreate").pages).toEqual(["explore", "exercise", "leisure"]);
    expect(PAGE_GROUPS.flatMap((g) => g.pages)).not.toContain("tasks");
    expect(PAGE_GROUPS.flatMap((g) => g.pages)).not.toContain("weather");
    expect(PAGE_GROUPS.find((g) => g.key === "media").pages).toEqual(["watch", "listen"]);
  });

  for (const menu of ["homePageGroups", "pageTitleMenu"]) {
    it(`${menu} matches the list`, () => {
      const groups = menuGroups(menu);
      expect(groups.map((g) => g.key)).toEqual(PAGE_GROUPS.map((g) => g.key));
      groups.forEach((g, i) => {
        expect(g.head).toBe(PAGE_GROUPS[i].label);
        expect(g.pages.map((p) => p.label)).toEqual(PAGE_GROUPS[i].pages.map((k) => PAGE_LABEL[k]));
      });
    });
  }

  it("app.js wires every menu button (pageNavButtons)", () => {
    const ids = [...menuGroups("homePageGroups"), ...menuGroups("pageTitleMenu")].flatMap((g) => g.pages.map((p) => p.id));
    expect(ids.length).toBe(22);
    for (const id of ids) expect(app).toContain(`"${id}"`);
  });

  it("knows which group each page's area is in", () => {
    expect(groupForArea("eat")).toBe("plan");
    expect(groupForArea("inventory")).toBe("resource");
    expect(groupForArea("contacts")).toBe("message");
    expect(groupForArea("media")).toBe("media");
    expect(groupForArea("scores")).toBe("recreate");
    expect(groupForArea("home")).toBeNull();
  });
});
