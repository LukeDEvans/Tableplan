import { describe, it, expect } from "vitest";
import qrcode from "qrcode-generator";
import { CODE128_PATTERNS, code128Values, code128Widths, code128Svg, qrSvg } from "../barcode.js";
import { normalizeCard, normalizeCards, sortCards, suggestFormat, walletApps } from "../wallet-model.js";
import * as clock from "../clock-model.js";
import { normalizeSong, addToHistory, createSongRecognizer, shazamKitAdapter } from "../song-recognizer.js";
import { suggestDestination, scanDocumentName, recognizedText } from "../scan-route.js";
import { searchParts, searchResultsHtml } from "../liv-search.js";
import { visibleUtilityItems, UTILITY_ITEMS } from "../utilities-ui.js";

const sum = (p) => p.split("").reduce((a, b) => a + Number(b), 0);

describe("barcode (Code 128)", () => {
  it("has 107 well-formed, distinct patterns", () => {
    expect(CODE128_PATTERNS.length).toBe(107);
    CODE128_PATTERNS.slice(0, 106).forEach((p) => { expect(p.length).toBe(6); expect(sum(p)).toBe(11); });
    expect(sum(CODE128_PATTERNS[106])).toBe(13);
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });
  it("matches the known checksum for 'Wikipedia'", () => {
    const v = code128Values("Wikipedia");
    expect(v[0]).toBe(104);
    expect(v.at(-2)).toBe(88);
    expect(v.at(-1)).toBe(106);
  });
  it("uses set C for even-length digits", () => {
    expect(code128Values("123456")).toEqual([105, 12, 34, 56, (105 + 12 + 34 * 2 + 56 * 3) % 103, 106]);
    expect(code128Values("123")[0]).toBe(104);
  });
  it("starts and ends with a bar, rejects bad input", () => {
    const w = code128Widths("ABC");
    expect(w.length % 2).toBe(1);
    expect(() => code128Values("")).toThrow();
    expect(() => code128Values("é")).toThrow();
    expect(code128Svg("ABC")).toMatch(/^<svg[\s\S]*<rect/);
  });
  it("draws a QR", () => {
    expect(qrSvg("https://example.com", qrcode)).toMatch(/^<svg/);
  });
});

describe("wallet model", () => {
  it("normalizes and picks formats", () => {
    expect(suggestFormat("")).toBe("none");
    expect(suggestFormat("1234567890")).toBe("code128");
    expect(suggestFormat("https://x.y/z")).toBe("qr");
    const c = normalizeCard({ name: "  Costco ", number: "1111", color: "nope", kind: "x" }, { newId: () => "w1" });
    expect(c).toMatchObject({ id: "w1", name: "Costco", format: "code128", kind: "card", color: "#1f4e79" });
    expect(normalizeCards([{ name: "no id" }, null, { id: "a", name: "A" }]).map((x) => x.id)).toEqual(["a"]);
  });
  it("sorts cards by name, then tickets soonest first and past last", () => {
    const cards = [
      { kind: "ticket", name: "Old", date: "2026-01-01" },
      { kind: "card", name: "Target" },
      { kind: "ticket", name: "Soon", date: "2026-12-01" },
      { kind: "card", name: "Costco" },
    ];
    expect(sortCards(cards, "2026-11-19").map((c) => c.name)).toEqual(["Costco", "Target", "Soon", "Old"]);
  });
  it("links to the platform wallet", () => {
    expect(walletApps("ios")[0].id).toBe("apple");
    expect(walletApps("web")[0].id).toBe("google");
  });
});

describe("clock model", () => {
  it("formats", () => {
    expect(clock.formatDuration(65_000)).toMatch(/1:05/);
    expect(clock.formatAlarmTime(0, 5)).toMatch(/12:05/);
    expect(clock.timerSeconds({ minutes: 2, seconds: 5 })).toBe(125);
  });
  it("runs a stopwatch and a timer", () => {
    let sw = clock.stopwatchStart(clock.createStopwatch(), 1000);
    expect(clock.stopwatchElapsed(sw, 1500)).toBe(500);
    sw = clock.stopwatchStop(sw, 2000);
    expect(clock.stopwatchElapsed(sw, 9999)).toBe(1000);
    let t = clock.startTimer(60, { now: 0, id: "t" });
    expect(clock.timerRemaining(t, 10_000)).toBe(50_000);
    t = clock.pauseTimer(t, 10_000);
    expect(clock.timerRemaining(t, 99_999)).toBe(50_000);
    t = clock.resumeTimer(t, 100_000);
    expect(clock.timerDone(t, 149_999)).toBe(false);
    expect(clock.timerDone(t, 150_000)).toBe(true);
  });
});

describe("song recognizer", () => {
  it("normalizes and dedupes history within 10 minutes", () => {
    const a = normalizeSong({ title: "Song", artist: "X", isrc: "us-abc-1", artworkUrl: "http://insecure", at: "2026-11-19T10:00:00Z" });
    expect(a.isrc).toBe("USABC1");
    expect(a.artworkUrl).toBe("");
    const b = normalizeSong({ title: "Song", artist: "X", isrc: "USABC1", at: "2026-11-19T10:05:00Z" });
    const c = normalizeSong({ title: "Song", artist: "X", isrc: "USABC1", at: "2026-11-19T10:30:00Z" });
    let h = addToHistory([], a);
    h = addToHistory(h, b);
    expect(h.length).toBe(1);
    h = addToHistory(h, c);
    expect(h.length).toBe(2);
  });
  it("goes through the first available adapter", async () => {
    const plugin = { recognize: async () => ({ status: "match", song: { title: "T", artist: "A" } }), cancel() {} };
    const r = createSongRecognizer({ adapters: [{ id: "off", available: () => false }, shazamKitAdapter(plugin)] });
    expect(r.adapterId()).toBe("shazamkit");
    expect((await r.recognize()).song.title).toBe("T");
    const none = createSongRecognizer({ adapters: [] });
    expect((await none.recognize()).status).toBe("error");
    const throws = createSongRecognizer({ adapters: [shazamKitAdapter({ recognize: async () => { throw new Error("boom"); } })] });
    expect(await throws.recognize()).toEqual({ status: "error", error: "boom" });
  });
});

describe("scan route", () => {
  it("suggests a destination", () => {
    expect(suggestDestination("").id).toBe("receipt");
    expect(suggestDestination("TARGET\nMilk 3.49\nBread 2.99\nEggs 4.19\nSUBTOTAL 10.67\nTAX 0.80\nTOTAL 11.47\nVISA").id).toBe("receipt");
    expect(suggestDestination("Ingredients\n2 cups flour\n1 tsp salt\nDirections\nPreheat oven, whisk and bake. Serves 4").id).toBe("recipe");
    expect(suggestDestination("Dear Luke,\nYour insurance policy statement and member id are enclosed. Sincerely").id).toBe("document");
  });
  it("names documents and flattens recognized text", () => {
    expect(scanDocumentName("  \nBlue Cross statement\nmore")).toBe("Blue Cross statement");
    expect(scanDocumentName("", new Date("2026-11-19T12:00:00"))).toMatch(/^Scan Nov 19, 2026/);
    expect(recognizedText([[{ text: "a" }, { text: "b" }], ["c"]])).toBe("a\nb\n\nc");
  });
});

describe("liv search", () => {
  it("gathers each view's rows once", () => {
    const sources = [{ section: "plan", keys: ["planEvents"] }, { section: "eat", keys: ["recipes"] }];
    const rows = { "plan:personal": { planEvents: [1] }, "plan:household": { planEvents: [2] }, "eat:household": { recipes: [3] } };
    const parts = searchParts({ views: ["personal", "household"], sources, scopeData: (s, sc) => rows[`${s}:${sc}`] || null });
    const byView = Object.fromEntries(parts.map((p) => [p.view, p.data]));
    expect(byView.household.recipes).toEqual([3]);
    expect(byView.household.planEvents).toEqual([2]);
    expect(byView.personal.recipes).toBeUndefined();
  });
  it("puts Ask Liv first and escapes", () => {
    const html = searchResultsHtml("<b>", []);
    expect(html.startsWith('<button type="button" class="liv-result liv-result-ask"')).toBe(true);
    expect(html).toContain("&lt;b&gt;");
    expect(searchResultsHtml("  ", [])).toBe("");
  });
});

describe("utilities menu", () => {
  it("keeps the agreed order and hides phone-only tools on a laptop", () => {
    expect(UTILITY_ITEMS.map((i) => i.label)).toEqual(["Talk to Liv", "Chat with Liv", "Scan", "Camera", "Shazam", "Calculator", "Clock", "Wallet"]);
    expect(visibleUtilityItems({}).map((i) => i.id)).toEqual(["talk", "chat", "scan", "calculator", "clock", "wallet"]);
    expect(visibleUtilityItems({ camera: true, shazam: true }).length).toBe(8);
  });
});
