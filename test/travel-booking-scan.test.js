import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { scanBookingFromEmailText } = require("../booking-scan.js");
const { DEFAULT_SCAN_MODEL } = require("../document-scan.js");

afterEach(() => { vi.unstubAllGlobals(); });

function stubClaude(text) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }] }) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("scanBookingFromEmailText (TRV-2)", () => {
  it("no longer throws ReferenceError and uses DEFAULT_SCAN_MODEL", async () => {
    const fetchMock = stubClaude('{"type":"hotel","title":"Marriott Tokyo","startDate":"2026-10-01","endDate":"2026-10-04","cost":"420.50"}');
    const out = await scanBookingFromEmailText("Your reservation is confirmed", { apiKey: "k" });
    expect(out.type).toBe("hotel");
    expect(out.title).toBe("Marriott Tokyo");
    expect(out.cost).toBe(420.5);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.model).toBe(DEFAULT_SCAN_MODEL);
  });

  it("returns null for non-booking emails", async () => {
    stubClaude('{"type": "none"}');
    expect(await scanBookingFromEmailText("50% off sale!", { apiKey: "k" })).toBeNull();
  });
});
