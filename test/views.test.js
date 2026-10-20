import { describe, it, expect } from "vitest";
import {
  VIEW_ORDER, VIEW_PAGES, availableViews, startingView, stepView, swipeStep,
  viewHasPage, viewForPage, isFlatView, splitViewHash, viewHash, primaryView,
  cleanViewDisplayPrefs, displayPrefsForView,
} from "../views.js";
import { PAGE_GROUPS } from "../page-groups.js";

const ALL = ["household", "personal", "business"];
const MODES = ["light", "dark", "auto"];
const THEMES = ["classic", "household", "urbangreens", "halloween", "seasonal"];

describe("views: order and who has them", () => {
  it("reads Household | Personal | Business left to right", () => {
    expect(VIEW_ORDER).toEqual(ALL);
  });
  it("the admin has all three; everyone else Household only", () => {
    expect(availableViews({ isAdmin: true })).toEqual(ALL);
    expect(availableViews({ isAdmin: false })).toEqual(["household"]);
    expect(availableViews()).toEqual(["household"]);
  });
});

describe("views: starting view", () => {
  it("reopens in the last view used", () => {
    expect(startingView("business", ALL)).toBe("business");
  });
  it("first launch / unknown → Personal", () => {
    expect(startingView(undefined, ALL)).toBe("personal");
    expect(startingView("nonsense", ALL)).toBe("personal");
  });
  it("a last view no longer available falls back", () => {
    expect(startingView("personal", ["household"])).toBe("household");
    expect(startingView(undefined, [])).toBe("household");
  });
});

describe("views: cyclical swipe", () => {
  it("finger right (step -1) from Personal brings in Household", () => {
    expect(stepView("personal", -1, ALL)).toBe("household");
    expect(stepView("household", -1, ALL)).toBe("business");
    expect(stepView("business", -1, ALL)).toBe("personal");
  });
  it("finger left (step +1) goes the other way", () => {
    expect(stepView("personal", 1, ALL)).toBe("business");
    expect(stepView("business", 1, ALL)).toBe("household");
    expect(stepView("household", 1, ALL)).toBe("personal");
  });
  it("one view: nowhere to go", () => {
    expect(stepView("household", 1, ["household"])).toBe("household");
    expect(stepView("household", -1, ["household"])).toBe("household");
  });
  it("swipeStep: right swipe is -1, left is +1, short or vertical is 0", () => {
    expect(swipeStep(80, 5)).toBe(-1);
    expect(swipeStep(-80, 5)).toBe(1);
    expect(swipeStep(20, 0)).toBe(0);
    expect(swipeStep(60, 60)).toBe(0);
  });
});

describe("views: pages", () => {
  const menuPages = ["plan", "eat", "do", "news", "weather", "finance", "shop", "watch", "read", "mail", "explore", "play", "recreate", "scores"];
  it("Personal holds every page", () => {
    for (const p of menuPages) expect(viewHasPage("personal", p)).toBe(true);
  });
  it("Household holds Calendar, Meal Plan, Finance, Shop, Watch, Listen", () => {
    expect(menuPages.filter((p) => viewHasPage("household", p))).toEqual(["plan", "eat", "finance", "shop", "watch", "read"]);
  });
  it("Business holds the Calendar only", () => {
    expect(menuPages.filter((p) => viewHasPage("business", p))).toEqual(["plan"]);
  });
  it("Household and Business are flat; Personal keeps the groups", () => {
    expect(isFlatView("personal")).toBe(false);
    expect(isFlatView("household")).toBe(true);
    expect(isFlatView("business")).toBe(true);
  });
  it("every page a view lists exists in the page groups (or is a page key app.js uses)", () => {
    // PAGE_GROUPS uses menu names; map the two that differ from page keys.
    const known = new Set(["plan", "eat", "read", ...PAGE_GROUPS.flatMap((g) => g.pages)]);
    for (const pages of Object.values(VIEW_PAGES)) for (const p of pages || []) expect(known.has(p), p).toBe(true);
  });
  it("viewForPage: stays if the view has it, else Personal, else none", () => {
    expect(viewForPage("plan", "business", ALL)).toBe("business");
    expect(viewForPage("news", "household", ALL)).toBe("personal");
    expect(viewForPage("news", "household", ["household"])).toBe(null);
  });
});

describe("views: routes", () => {
  it("splits a view prefix off", () => {
    expect(splitViewHash("household/shop")).toEqual({ view: "household", rest: "shop" });
    expect(splitViewHash("Business/plan?x=1")).toEqual({ view: "business", rest: "plan?x=1" });
    expect(splitViewHash("personal")).toEqual({ view: "personal", rest: "" });
  });
  it("old routes without a view pass through", () => {
    expect(splitViewHash("calendar")).toEqual({ view: null, rest: "calendar" });
    expect(splitViewHash("mail?thread=a/b")).toEqual({ view: null, rest: "mail?thread=a/b" });
    expect(splitViewHash("")).toEqual({ view: null, rest: "" });
  });
  it("builds a prefixed route", () => {
    expect(viewHash("household", "shop")).toBe("household/shop");
    expect(viewHash("nope", "shop")).toBe("shop");
    expect(splitViewHash(viewHash("business", "plan"))).toEqual({ view: "business", rest: "plan" });
  });
});

describe("views: display per view", () => {
  const base = { mode: "dark", theme: "halloween", icon: true };
  it("primary view: Personal for the admin, Household for one-view people", () => {
    expect(primaryView(ALL)).toBe("personal");
    expect(primaryView(["household"])).toBe("household");
  });
  it("the primary view uses the person's own prefs unchanged", () => {
    expect(displayPrefsForView("personal", { base, available: ALL })).toEqual(base);
    expect(displayPrefsForView("household", { base, available: ["household"] })).toEqual(base);
  });
  it("other views default to their own theme and the person's mode, never the icon", () => {
    expect(displayPrefsForView("household", { base, available: ALL })).toEqual({ mode: "dark", theme: "household", icon: false });
    expect(displayPrefsForView("business", { base, available: ALL })).toEqual({ mode: "dark", theme: "urbangreens", icon: false });
  });
  it("a view's own choice wins", () => {
    const viewPrefs = { business: { mode: "light", theme: "classic" } };
    expect(displayPrefsForView("business", { base, viewPrefs, available: ALL })).toEqual({ mode: "light", theme: "classic", icon: false });
  });
  it("cleanViewDisplayPrefs keeps only valid choices for secondary views", () => {
    const out = cleanViewDisplayPrefs({
      household: { mode: "auto", theme: "bogus" },
      business: { mode: "x" },
      personal: { mode: "dark" },
      junk: 1,
    }, { modes: MODES, themes: THEMES });
    expect(out).toEqual({ household: { mode: "auto" } });
    expect(cleanViewDisplayPrefs(null, { modes: MODES, themes: THEMES })).toEqual({});
  });
});

import { VIEW_TOGGLE_SECTIONS, scopeForView, scopesForSection, rowIdForScope, upgradeShadowStore, layerViewsFor } from "../views.js";

describe("views: which row each view reads", () => {
  it("Household reads the household row for every Household page", () => {
    for (const s of VIEW_TOGGLE_SECTIONS.filter((x) => x !== "travel")) expect(scopeForView("household", s, { hasBusiness: true })).toBe("household");
  });
  it("Explore's trips always stay on the person's own row (not a Household page)", () => {
    for (const v of ["household", "personal", "business"]) expect(scopeForView(v, "travel", { hasBusiness: true })).toBe("personal");
  });
  it("Personal reads personal rows, but Shop stays the household list", () => {
    expect(scopeForView("personal", "plan")).toBe("personal");
    expect(scopeForView("personal", "media")).toBe("personal");
    expect(scopeForView("personal", "grocery")).toBe("household");
  });
  it("Business reads the business row for the Calendar once the space is known", () => {
    expect(scopeForView("business", "plan", { hasBusiness: true })).toBe("business");
    expect(scopeForView("business", "plan", { hasBusiness: false })).toBe("personal");
    expect(scopeForView("business", "media", { hasBusiness: true })).toBe("personal");
    expect(scopeForView("business", "grocery", { hasBusiness: true })).toBe("household");
  });
  it("only the Calendar has a business scope", () => {
    expect(scopesForSection("plan", { hasBusiness: true })).toEqual(["personal", "household", "business"]);
    expect(scopesForSection("plan", { hasBusiness: false })).toEqual(["personal", "household"]);
    expect(scopesForSection("media", { hasBusiness: true })).toEqual(["personal", "household"]);
    expect(scopesForSection("eat", { toggle: false })).toEqual([]);
  });
  it("row ids per scope", () => {
    const ids = { stateId: "g1", userId: "u9", businessId: "b5" };
    expect(rowIdForScope(ids, "plan", "household")).toBe("g1:plan");
    expect(rowIdForScope(ids, "plan", "personal")).toBe("u-u9:plan");
    expect(rowIdForScope(ids, "plan", "business")).toBe("b5:plan");
    expect(rowIdForScope({ stateId: "g1" }, "plan", "business")).toBe(null);
    expect(rowIdForScope({ stateId: "g1" }, "plan", "personal")).toBe(null);
  });
  it("an old shadow copy files under the scope that isn't showing", () => {
    const v1 = { plan: { planEvents: [1] }, media: { podcasts: [2] }, junk: null };
    const scope = (s) => (s === "plan" ? "personal" : "household");
    expect(upgradeShadowStore(v1, scope)).toEqual({ plan: { household: { planEvents: [1] } }, media: { personal: { podcasts: [2] } } });
    expect(upgradeShadowStore(null, scope)).toEqual({});
  });
  it("layers: only in Personal, only what the person turned on", () => {
    expect(layerViewsFor("personal", { household: true, business: true }, { hasBusiness: true })).toEqual(["household", "business"]);
    expect(layerViewsFor("personal", { business: true }, { hasBusiness: false })).toEqual([]);
    expect(layerViewsFor("household", { household: true, business: true }, { hasBusiness: true })).toEqual([]);
    expect(layerViewsFor("personal", null)).toEqual([]);
  });
});
