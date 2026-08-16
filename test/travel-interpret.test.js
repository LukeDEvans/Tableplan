import { describe, it, expect, vi, afterEach } from "vitest";
import { buildThreadText, parseEntities, interpretTravelThread } from "../travel-interpret.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("buildThreadText", () => {
  it("orders messages chronologically and includes headers", () => {
    const text = buildThreadText([
      { subject: "Modified", from: "airbnb@x", date: "2026-05-10T10:00:00Z", text: "New dates 18-22" },
      { subject: "Confirmed", from: "airbnb@x", date: "2026-05-01T10:00:00Z", text: "Dates 18-21" },
    ]);
    expect(text.indexOf("Dates 18-21")).toBeLessThan(text.indexOf("New dates 18-22")); // earliest first
    expect(text).toMatch(/Message 1 · Date: 2026-05-01/);
  });
  it("handles empty input", () => {
    expect(buildThreadText(null)).toBe("");
  });
});

describe("parseEntities", () => {
  it("extracts the entities array and filters 'none'", () => {
    const out = parseEntities('prose {"entities":[{"kind":"lodging"},{"kind":"none"}]} tail');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("lodging");
  });
  it("coerces unknown kinds to other and tolerates junk", () => {
    expect(parseEntities('{"entities":[{"kind":"spaceship"}]}')[0].kind).toBe("other");
    expect(parseEntities("no json here")).toEqual([]);
  });
});

describe("interpretTravelThread", () => {
  it("returns [] for an empty thread without calling the API", async () => {
    const spy = vi.spyOn(global, "fetch");
    const out = await interpretTravelThread([], { apiKey: "k" });
    expect(out.entities).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("calls Claude and parses the entities from the response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: "text", text: '{"entities":[{"kind":"lodging","title":"Villa","confirmation":"HZ7K29"}]}' }] }),
    });
    const out = await interpretTravelThread([{ subject: "Airbnb", from: "a@b", date: "2026-05-01", text: "Villa in Cappadocia HZ7K29" }], { apiKey: "k" });
    expect(out.entities[0]).toMatchObject({ kind: "lodging", confirmation: "HZ7K29" });
  });

  it("throws a clear error on API failure", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue({ ok: false, json: async () => ({ error: { message: "rate limited" } }) });
    await expect(interpretTravelThread([{ text: "x", date: "2026-05-01" }], { apiKey: "k" })).rejects.toThrow(/rate limited/);
  });

  it("requires an API key", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    await expect(interpretTravelThread([{ text: "x", date: "2026-05-01" }], {})).rejects.toThrow(/ANTHROPIC_API_KEY/);
    if (saved) process.env.ANTHROPIC_API_KEY = saved;
  });
});
