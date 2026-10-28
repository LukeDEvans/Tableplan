// APP_LINKS_DESIGN.md — out-catalog.js (banks, stores, billers, papers, travel,
// maps, phone links) and where the app renders them.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  PLACES, normalizeName, matchPlace, placeHandoff, banksForAccounts, billerForBill,
  storeFor, storeSearchHandoff, paperHandoff, mapsHandoffs, airlineFor, travelPlaceFor,
  phoneLinks, placeSchemes,
} from "../out-catalog.js";
import { googleEventLinks, googleEventToCacheEntries } from "../calendar/google.js";

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

describe("catalog", () => {
  it("every place has a kind, label, pattern and an https website; app links are https or allowed schemes", () => {
    const swift = read("ios/App/App/LinkOutPlugin.swift");
    const list = swift.slice(swift.indexOf("static let allowedSchemes"), swift.indexOf("]", swift.indexOf("static let allowedSchemes")));
    for (const [id, p] of Object.entries(PLACES)) {
      expect(["bank", "store", "biller", "airline", "hotel", "car"], id).toContain(p.kind);
      expect(p.label, id).toBeTruthy();
      expect(p.match, id).toBeInstanceOf(RegExp);
      expect(p.web, id).toMatch(/^https:\/\//);
      for (const u of p.app) expect(u, id).toMatch(/^(https:\/\/|[a-z][a-z0-9+.-]*:\/\/)/);
      if (p.search) expect(p.search, id).toMatch(/^https:\/\//);
    }
    for (const scheme of placeSchemes()) expect(list, scheme).toContain(`"${scheme}"`);
  });
  it("normalises names", () => {
    expect(normalizeName("Trader Joe’s")).toBe("trader joes");
    expect(normalizeName("U.S. Bank")).toBe("u s bank");
    expect(normalizeName("AT&T")).toBe("at t");
  });
});

describe("Finance", () => {
  // The institutions and account names on Luke's Finance page (2026-10-27).
  const accounts = [
    { org: "Fidelity Investments", name: "Fidelity — HSA" },
    { org: "Citibank", name: "Costco/Citi Credit Card" },
    { org: "Target Credit Card", name: "Target — Credit" },
    { org: "Bank of America", name: "BofA — Credit" },
    { org: "U.S. Bank", name: "US Bank" },
    { org: "Apple Card (Updated Monthly)", name: "Apple — Credit" },
    { org: "Chase Bank", name: "Chase — Checking" },
    { org: "", name: "Chase — Credit" },
    { org: "SoFi", name: "SoFi — Savings" },
    { org: "", name: "Sure 401(k)" },
    { org: "", name: "NelNet — Student Loans" },
  ];
  it("one button per bank, in account order; unknown institutions get none", () => {
    expect(banksForAccounts(accounts).map((b) => b.id)).toEqual(["fidelity", "citi", "targetcard", "bofa", "usbank", "applecard", "chase", "sofi", "nelnet"]);
  });
  it("a Costco card is Citi, not the store; a Target card is the card, not the store", () => {
    expect(matchPlace("Costco/Citi Credit Card", "bank").id).toBe("citi");
    expect(matchPlace("Target — Credit", "bank").id).toBe("targetcard");
    expect(matchPlace("Target", "bank")).toBeNull();
  });
  it("bills: billers first, then banks; plain shops and rent get no Pay button", () => {
    const cases = {
      "APPLE.COM/BILL 866-712-7753 CA": "applesubs",
      "Electronic Withdrawal Verizon Wireless": "verizon",
      "Electronic Withdrawal Firstmark": "firstmark",
      "NYTIMES DISC*": "nytimes",
      "CHASE CREDIT CRD AUTOPAY": "chase",
      "ALDI INC MINNEAPOLIS MN": null,
      "Web Authorized Pmt Kula Property Ma": null,
      "Minneapolis Gymnastics 161-2440233 MN": null,
      "ISHARES TRUST": null,
      "PURCHASE AUTHORIZED": null,
    };
    for (const [name, id] of Object.entries(cases)) expect(billerForBill(name)?.id ?? null, name).toBe(id);
  });
});

describe("Shop", () => {
  it("recognises the household's stores", () => {
    expect(storeFor("Target")?.id).toBe("target");
    expect(storeFor("Costco Wholesale")?.id).toBe("costco");
    expect(storeFor("ALDI")?.id).toBe("aldi");
    expect(storeFor("Trader Joe's")?.id).toBe("traderjoes");
    expect(storeFor("Cub Foods")?.id).toBe("cub");
    expect(storeFor("Kowalski's")).toBeNull();
  });
  it("searches a store for an item; a store without a search gives none", () => {
    const s = storeSearchHandoff("target", "oat milk");
    expect(s.webUrl).toBe("https://www.target.com/s?searchTerm=oat+milk");
    expect(s.appUrls[0]).toBe(s.webUrl);
    expect(s.appUrls).toContain("target://");
    expect(storeSearchHandoff("costco", "eggs & bacon").webUrl).toBe("https://www.costco.com/s?keyword=eggs+%26+bacon");
    expect(storeSearchHandoff("cub", "milk")).toBeNull();
    expect(storeSearchHandoff("target", "  ")).toBeNull();
    expect(storeSearchHandoff("sofi", "milk")).toBeNull();
  });
});

describe("News", () => {
  it("opens a story on its paper's own domain only", () => {
    expect(paperHandoff("nyt", "https://www.nytimes.com/2026/10/27/us/x.html")).toMatchObject({ label: "NYT", webUrl: "https://www.nytimes.com/2026/10/27/us/x.html" });
    expect(paperHandoff("athletic", "https://www.nytimes.com/athletic/6789/2026/10/27/vikings/").label).toBe("The Athletic");
    expect(paperHandoff("economist", "https://www.economist.com/briefing/2026/10/27/x").label).toBe("The Economist");
    expect(paperHandoff("startribune", "https://www.startribune.com/x/601")?.label).toBe("Star Tribune");
    expect(paperHandoff("nyt", "https://nl.nytimes.com/f/a/xyz")).toBeNull();
    expect(paperHandoff("nyt", "https://evil.example/nytimes.com")).toBeNull();
    expect(paperHandoff("nyt", "http://www.nytimes.com/x")).toBeNull();
    expect(paperHandoff("nyt", "not a url")).toBeNull();
    expect(paperHandoff("other", "https://www.nytimes.com/x")).toBeNull();
  });
});

describe("Maps, travel, contacts", () => {
  it("Apple Maps then Google Maps, search or directions", () => {
    const [apple, google] = mapsHandoffs("Minnehaha Falls, Minneapolis", { directions: true });
    expect(apple.webUrl).toBe("https://maps.apple.com/?daddr=Minnehaha%20Falls%2C%20Minneapolis");
    expect(google.appUrls[0]).toBe("comgooglemaps://?daddr=Minnehaha%20Falls%2C%20Minneapolis");
    expect(google.webUrl).toContain("google.com/maps/dir/");
    expect(mapsHandoffs("Paris")[0].webUrl).toBe("https://maps.apple.com/?q=Paris");
    expect(mapsHandoffs("  ")).toEqual([]);
  });
  it("airlines by flight number, then by name", () => {
    expect(airlineFor("DL 1234").id).toBe("delta");
    expect(airlineFor("sy123").id).toBe("suncountry");
    expect(airlineFor("", "United Airlines").id).toBe("united");
    expect(airlineFor("ZZ 1")).toBeNull();
  });
  it("the app for a trip item", () => {
    expect(travelPlaceFor("travel", { mode: "airplane", flightNumber: "UA 88" }).id).toBe("united");
    expect(travelPlaceFor("travel", { mode: "train", flightNumber: "UA 88" })).toBeNull();
    expect(travelPlaceFor("lodging", { name: "Hampton Inn Duluth" }).id).toBe("hilton");
    expect(travelPlaceFor("lodging", { name: "Lake cabin", lodgingType: "airbnb" }).id).toBe("airbnb");
    expect(travelPlaceFor("lodging", { name: "Grandma's" })).toBeNull();
    expect(travelPlaceFor("carBooking", { title: "Enterprise rental" }).id).toBe("enterprise");
    expect(travelPlaceFor("food", { name: "Delta Diner" })).toBeNull();
  });
  it("phone links", () => {
    expect(phoneLinks("(612) 555-0100")).toEqual({ call: "tel:6125550100", text: "sms:6125550100", facetime: "facetime:6125550100" });
    expect(phoneLinks("+31 6 1234 5678").call).toBe("tel:+31612345678");
    expect(phoneLinks("ext")).toBeNull();
  });
  it("every hand-off has a label and an https website", () => {
    for (const id of Object.keys(PLACES)) {
      const s = placeHandoff(id);
      expect(s.label).toBeTruthy();
      expect(s.webUrl).toMatch(/^https:\/\//);
    }
    expect(placeHandoff("nope")).toBeNull();
  });
});

describe("Google events carry their place, page and meeting", () => {
  it("keeps https Google Calendar pages and video links only", () => {
    expect(googleEventLinks({
      location: "Target Field, Minneapolis",
      htmlLink: "https://www.google.com/calendar/event?eid=abc",
      conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://us02web.zoom.us/j/123" }] },
      hangoutLink: "https://meet.google.com/aaa-bbbb-ccc",
    })).toEqual({ location: "Target Field, Minneapolis", htmlLink: "https://www.google.com/calendar/event?eid=abc", meetUrl: "https://us02web.zoom.us/j/123" });
    expect(googleEventLinks({ hangoutLink: "https://meet.google.com/x" }).meetUrl).toBe("https://meet.google.com/x");
    expect(googleEventLinks({ htmlLink: "https://evil.example/calendar/x", hangoutLink: "javascript:alert(1)" })).toEqual({});
  });
  it("cache entries include them", () => {
    const [e] = googleEventToCacheEntries({ id: "g1", summary: "Game", start: { dateTime: "2026-10-28T19:10:00-05:00" }, end: { dateTime: "2026-10-28T22:00:00-05:00" }, location: "Target Field" }, { id: "c1", name: "Fun" });
    expect(e.location).toBe("Target Field");
  });
  it("the server asks Google for them", () => {
    expect(read("netlify/functions/_gcal.js")).toMatch(/LIVE_FIELDS = "items\([^"]*location,htmlLink,hangoutLink,conferenceData/);
  });
});

describe("wired into the pages", () => {
  it("each page renders its links", () => {
    expect(read("finance-ui.js")).toContain("financeBankLinksHtml(liveById)");
    expect(read("finance-ui.js")).toContain("financeBillPayHtml(b.name)");
    expect(read("groceries-ui.js")).toContain("storeAppBtn(store, name)");
    expect(read("groceries-ui.js")).toContain("data-find-at-store");
    expect(read("news-ui.js")).toContain('data-news-act="app"');
    expect(read("contacts.js")).toContain("phoneLinks(p.value)");
    const app = read("app.js");
    expect(app).toContain("planEventOutLinksHtml(ev, locText)");
    expect(app).toContain("travelPlaceFor(type, item)");
    expect(app).toContain("handOff: (...a) => handOff(...a)");
  });
});
