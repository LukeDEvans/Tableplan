// STREAMING_HANDOFF_DESIGN.md — link-out.js, sports-watch.js,
// media-stream-links.js and the stream-links function.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { OUT_TARGETS, openOutLink, titleHandoff, targetHandoff, catalogSchemes, linkOutAttrs, linkOutFromElement } from "../link-out.js";
import { networkFor, inWatchWindow, watchOptionsForGame } from "../sports-watch.js";
import { nextEpisode, linksForProvider, createStreamLinksCache, STREAM_LINKS_STORAGE_KEY } from "../media-stream-links.js";
import { trimShow, handler } from "../netlify/functions/stream-links.mjs";
import { gameWatchHtml } from "../scores-ui.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

describe("link-out catalog", () => {
  it("every custom scheme is on the iPhone plugin's allow-list", () => {
    const swift = readFileSync(new URL("../ios/App/App/LinkOutPlugin.swift", import.meta.url), "utf8");
    const start = swift.indexOf("static let allowedSchemes");
    expect(start).toBeGreaterThan(0);
    const list = swift.slice(start, swift.indexOf("]", start));
    for (const scheme of catalogSchemes()) expect(list, scheme).toContain(`"${scheme}"`);
  });
  it("every target has a label, an app link and an https website", () => {
    for (const [id, t] of Object.entries(OUT_TARGETS)) {
      expect(t.label, id).toBeTruthy();
      expect(t.app.length, id).toBeGreaterThan(0);
      expect(t.web, id).toMatch(/^https:\/\//);
    }
  });
});

describe("titleHandoff fallback order", () => {
  it("exact episode, then title page, then the app's home; web = exact link", () => {
    const s = titleHandoff("netflix", { video: "https://www.netflix.com/watch/1", title: "https://www.netflix.com/title/9", search: "https://www.netflix.com/search?q=x" });
    expect(s.appUrls).toEqual(["https://www.netflix.com/watch/1", "https://www.netflix.com/title/9", "nflx://"]);
    expect(s.webUrl).toBe("https://www.netflix.com/watch/1");
    expect(s.exact).toBe(true);
  });
  it("no exact link: the app's home, then the search page on the web", () => {
    const s = titleHandoff("max", { search: "https://play.max.com/search?q=x" });
    expect(s.appUrls).toEqual(["hbomax://"]);
    expect(s.webUrl).toBe("https://play.max.com/search?q=x");
    expect(s.exact).toBe(false);
  });
  it("an unknown service keeps only the search page", () => {
    const s = titleHandoff("some-indie", { search: "https://example.com/s?q=x" });
    expect(s.appUrls).toEqual([]);
    expect(s.webUrl).toBe("https://example.com/s?q=x");
  });
});

describe("openOutLink", () => {
  it("web / older app: opens the website", async () => {
    const windowOpen = vi.fn();
    expect(await openOutLink({ appUrls: ["nflx://"], webUrl: "https://www.netflix.com/" }, { linkOut: null, windowOpen })).toBe("web");
    expect(windowOpen).toHaveBeenCalledWith("https://www.netflix.com/");
  });
  it("iPhone app with the plugin: hands everything to it", async () => {
    const linkOut = { open: vi.fn(async () => ({ opened: "app" })) };
    const windowOpen = vi.fn();
    expect(await openOutLink({ appUrls: ["nflx://"], webUrl: "https://www.netflix.com/" }, { linkOut, windowOpen })).toBe("app");
    expect(linkOut.open).toHaveBeenCalledWith({ appUrls: ["nflx://"], webUrl: "https://www.netflix.com/" });
    expect(windowOpen).not.toHaveBeenCalled();
  });
  it("plugin error: falls back to the website", async () => {
    const linkOut = { open: vi.fn(async () => { throw new Error("x"); }) };
    const windowOpen = vi.fn();
    expect(await openOutLink({ appUrls: [], webUrl: "https://a.test/" }, { linkOut, windowOpen })).toBe("web");
  });
  it("never opens a non-https website", async () => {
    const windowOpen = vi.fn();
    expect(await openOutLink({ appUrls: ["nflx://"], webUrl: "javascript:alert(1)" }, { windowOpen })).toBe("none");
    expect(windowOpen).not.toHaveBeenCalled();
  });
  it("attributes round-trip", () => {
    const html = `<button ${linkOutAttrs({ appUrls: ["a://", "https://b.test/x"], webUrl: "https://b.test/", label: "B", note: "hi" }, esc)}>`;
    const el = { dataset: {} };
    for (const [, k, v] of html.matchAll(/data-out-([a-z]+)="([^"]*)"/g)) el.dataset[`out${k[0].toUpperCase()}${k.slice(1)}`] = v;
    expect(linkOutFromElement(el)).toEqual({ appUrls: ["a://", "https://b.test/x"], webUrl: "https://b.test/", label: "B", note: "hi" });
  });
});

describe("sports-watch networks", () => {
  it.each([
    ["ESPN", "espn", true], ["ESPN2", "espn", true], ["ABC", "espn", true], ["ESPN+", "espn", false], ["ESPN Unlmtd", "espn", false],
    ["SEC Network", "espn", true], ["FOX", "foxone", true], ["FS1", "foxone", true], ["BTN", "foxone", true],
    ["NBC", "peacock", true], ["Peacock", "peacock", false], ["USA Net", "peacock", true],
    ["CBS", "paramount", true], ["Paramount+", "paramount", false], ["TNT", "max", true], ["truTV", "max", true],
    ["Prime Video", "prime", false], ["Apple TV", "appletv", false], ["Netflix", "netflix", false],
    ["NFL Net", "nfl", true], ["NBA TV", "nba", true], ["NHL Network", "nhl", true], ["MLB.TV", "mlb", false],
    ["FDSN North", "fanduel", true],
  ])("%s → %s", (name, app, cable) => {
    expect(networkFor(name)).toEqual({ name, app, cable });
  });
  it("unknown names don't map", () => {
    expect(networkFor("Some Local Radio")).toBe(null);
    expect(networkFor("")).toBe(null);
  });
});

describe("watch window", () => {
  const now = Date.parse("2026-10-26T18:00:00Z");
  it("live games and games within the hour", () => {
    expect(inWatchWindow({ state: "live" }, now)).toBe(true);
    expect(inWatchWindow({ state: "pre", start: "2026-10-26T18:45:00Z" }, now)).toBe(true);
    expect(inWatchWindow({ state: "pre", start: "2026-10-26T20:00:00Z" }, now)).toBe(false);
    expect(inWatchWindow({ state: "final", start: "2026-10-26T15:00:00Z" }, now)).toBe(false);
  });
});

describe("watch options for a game", () => {
  it("with Xfinity: a TV channel opens in Xfinity first, the network's app next", () => {
    const o = watchOptionsForGame({ broadcasts: ["FOX"] }, { services: ["xfinity"] });
    expect(o.map((x) => x.id)).toEqual(["xfinity", "foxone"]);
    expect(o[0].network).toBe("FOX");
    expect(o[0].mine).toBe(true);
  });
  it("streaming-only names never go through Xfinity", () => {
    const o = watchOptionsForGame({ broadcasts: ["Prime Video"] }, { services: ["xfinity"] });
    expect(o.map((x) => x.id)).toEqual(["prime"]);
  });
  it("without live TV: the scoreboard's order, services you have first", () => {
    expect(watchOptionsForGame({ broadcasts: ["ESPN", "Peacock"] }, { services: [] }).map((x) => x.id)).toEqual(["espn", "peacock"]);
    expect(watchOptionsForGame({ broadcasts: ["ESPN", "Peacock"] }, { services: ["peacock"] }).map((x) => x.id)).toEqual(["peacock", "espn"]);
  });
  it("dedupes, caps at three, ignores unknown names", () => {
    const o = watchOptionsForGame({ broadcasts: ["ESPN", "ESPN2", "ABC", "Mystery TV", "FOX", "NBC", "CBS"] }, { services: ["xfinity"] });
    expect(o.map((x) => x.id)).toEqual(["xfinity", "espn", "foxone"]);
  });
  it("the Scores markup appears only in the watch window", () => {
    const live = { state: "live", broadcasts: ["FOX"] };
    const html = gameWatchHtml(live, esc, ["xfinity"]);
    expect(html).toContain("Xfinity Stream");
    expect(html).toContain("data-link-out");
    expect(html).toContain("FOX is under Live TV");
    expect(gameWatchHtml({ state: "final", broadcasts: ["FOX"] }, esc, [])).toBe("");
    expect(gameWatchHtml({ state: "live", broadcasts: [] }, esc, [])).toBe("");
  });
});

describe("next episode", () => {
  const eps = { "0": { "1": "s0" }, "1": { "1": "a", "2": "b" }, "2": { "1": "c", "2": "d" } };
  it("nothing watched → S1 E1 (specials skipped)", () => {
    expect(nextEpisode(eps, {})).toEqual({ season: 1, episode: 1, url: "a" });
  });
  it("mid-season", () => {
    expect(nextEpisode(eps, { 1: { episodes: { 1: true } } })).toEqual({ season: 1, episode: 2, url: "b" });
  });
  it("a finished season moves on", () => {
    expect(nextEpisode(eps, { 1: { watched: true } })).toEqual({ season: 2, episode: 1, url: "c" });
  });
  it("finished show → null; the show's own link is used", () => {
    const sp = { 1: { watched: true }, 2: { watched: true } };
    expect(nextEpisode(eps, sp)).toBe(null);
    expect(linksForProvider({ max: { title: "T", video: "V", episodes: eps } }, "max", sp)).toEqual({ video: "V", title: "T" });
  });
  it("labels the episode", () => {
    expect(linksForProvider({ max: { title: "T", video: "", episodes: eps } }, "max", { 1: { watched: true } })).toEqual({ video: "c", title: "T", episode: "S2 E1" });
    expect(linksForProvider({}, "max", {})).toEqual({});
  });
});

describe("stream links device cache", () => {
  const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  it("asks once, answers from the cache after, re-asks when a week old", async () => {
    let t = 1000;
    const storage = memory();
    const fetchLinks = vi.fn(async () => ({ links: { netflix: { title: "x", video: "" } } }));
    const c = createStreamLinksCache({ storage, fetchLinks, now: () => t });
    expect(c.get("movie", "1")).toBe(undefined);
    expect(c.get("movie", "1")).toBe(undefined); // in flight: no second call
    await flush(); await flush();
    expect(fetchLinks).toHaveBeenCalledTimes(1);
    expect(c.get("movie", "1")).toEqual({ netflix: { title: "x", video: "" } });
    expect(JSON.parse(storage.getItem(STREAM_LINKS_STORAGE_KEY))["movie:1"].links.netflix.title).toBe("x");
    t += 8 * 24 * 3600 * 1000;
    c.get("movie", "1");
    await flush(); await flush();
    expect(fetchLinks).toHaveBeenCalledTimes(2);
  });
  it("an error answer isn't cached; at most two lookups run at once", async () => {
    let active = 0, peak = 0;
    const fetchLinks = vi.fn(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return { links: null, error: "upstream 429" }; });
    const c = createStreamLinksCache({ storage: memory(), fetchLinks });
    for (let i = 1; i <= 5; i++) c.get("tv", String(i));
    await new Promise((r) => setTimeout(r, 60));
    expect(peak).toBe(2);
    expect(fetchLinks).toHaveBeenCalledTimes(5);
    expect(c.get("tv", "1")).toBe(undefined);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchLinks).toHaveBeenCalledTimes(5); // failed lookups back off instead of re-asking at once
  });
  it("a missing function (throws) backs off for half an hour", async () => {
    let t = 0;
    const fetchLinks = vi.fn(async () => { throw new Error("stream-links 404"); });
    const c = createStreamLinksCache({ storage: memory(), fetchLinks, now: () => t });
    c.get("movie", "9"); await flush(); await flush();
    c.get("movie", "9"); await flush();
    expect(fetchLinks).toHaveBeenCalledTimes(1);
    t += 31 * 60 * 1000;
    c.get("movie", "9"); await flush();
    expect(fetchLinks).toHaveBeenCalledTimes(2);
  });
  it("ignores bad input", () => {
    const fetchLinks = vi.fn();
    const c = createStreamLinksCache({ storage: memory(), fetchLinks });
    expect(c.get("book", "1")).toBe(undefined);
    expect(c.get("movie", "")).toBe(undefined);
    expect(fetchLinks).not.toHaveBeenCalled();
  });
});

describe("stream-links function", () => {
  const show = {
    streamingOptions: { us: [
      { service: { id: "netflix" }, type: "subscription", link: "https://www.netflix.com/title/1", videoLink: "https://www.netflix.com/watch/1" },
      { service: { id: "hbo" }, type: "buy", link: "https://play.hbomax.com/x" },
      { service: { id: "prime" }, type: "addon", addon: { id: "hbo" }, link: "https://www.amazon.com/addon" },
      { service: { id: "apple" }, type: "rent", link: "javascript:bad" },
    ] },
    seasons: [{ episodes: [
      { streamingOptions: { us: [{ service: { id: "netflix" }, type: "subscription", link: "https://www.netflix.com/title/1", videoLink: "https://www.netflix.com/watch/11" }] } },
      { streamingOptions: { us: [{ service: { id: "netflix" }, type: "subscription", link: "https://www.netflix.com/title/1", videoLink: "https://www.netflix.com/watch/12" }] } },
    ] }],
  };
  it("trims to links per service and episode, dropping add-ons and non-https", () => {
    expect(trimShow(show)).toEqual({
      netflix: { title: "https://www.netflix.com/title/1", video: "https://www.netflix.com/watch/1", episodes: { "1": { "1": "https://www.netflix.com/watch/11", "2": "https://www.netflix.com/watch/12" } } },
      max: { title: "https://play.hbomax.com/x", video: "" },
    });
    expect(trimShow({})).toBe(null);
  });
  const ev = (q, origin = "capacitor://localhost") => ({ httpMethod: "GET", headers: { origin }, queryStringParameters: q });
  it("off without a key, and with the kill switch", async () => {
    const r = await handler(ev({ type: "tv", id: "1396" }), {}, { env: {} });
    expect(JSON.parse(r.body)).toEqual({ links: null, off: true });
    const k = await handler(ev({ type: "tv", id: "1396" }), {}, { env: { STREAMING_AVAILABILITY_KEY: "k", STREAM_LINKS_DISABLED: "1" }, fetch: vi.fn() });
    expect(JSON.parse(k.body).off).toBe(true);
  });
  it("validates input and origin", async () => {
    expect((await handler(ev({ type: "tv", id: "abc" }), {}, { env: {} })).statusCode).toBe(400);
    expect((await handler(ev({ type: "book", id: "1" }), {}, { env: {} })).statusCode).toBe(400);
    expect((await handler(ev({ type: "tv", id: "1" }, "https://evil.example"), {}, { env: {} })).statusCode).toBe(403);
  });
  it("success is CDN-cached a week; a 429 isn't cached", async () => {
    const env = { STREAMING_AVAILABILITY_KEY: "k" };
    const ok = await handler(ev({ type: "tv", id: "1" }), {}, { env, fetch: vi.fn(async (url, opts) => {
      expect(url).toBe("https://streaming-availability.p.rapidapi.com/shows/tv/1?country=us&series_granularity=episode&output_language=en");
      expect(opts.headers["x-rapidapi-key"]).toBe("k");
      return { ok: true, status: 200, json: async () => show };
    }) });
    expect(JSON.parse(ok.body).links.netflix.title).toBe("https://www.netflix.com/title/1");
    expect(ok.headers["netlify-cdn-cache-control"]).toContain("max-age=604800");
    const busy = await handler(ev({ type: "tv", id: "1" }), {}, { env, fetch: vi.fn(async () => ({ ok: false, status: 429 })) });
    expect(JSON.parse(busy.body)).toEqual({ links: null, error: "upstream 429" });
    expect(busy.headers["cache-control"]).toBe("no-store");
  });
});
