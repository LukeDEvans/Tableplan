import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { handler, _setTestDeps } from "../netlify/functions/ics-proxy.mjs";

const ICS = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART:20260101T100000Z\r\nDTEND:20260101T110000Z\r\nSUMMARY:Hi\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

function fakeRes({ status = 200, type = "text/calendar", body = ICS, location } = {}) {
  const h = new Map([["content-type", type]]);
  if (location) h.set("location", location);
  return { status, headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null }, body: null, text: async () => body };
}
const ev = (url) => ({ headers: { authorization: "Bearer tok" }, queryStringParameters: { url } });

describe("ics-proxy uses the shared SSRF-guarded safeFetch (SRV-10 / CAL-5)", () => {
  let fetchImpl;
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sk";
    // session check goes through global fetch
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
    fetchImpl = vi.fn(async () => fakeRes());
    _setTestDeps({ fetchImpl, lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }] });
  });
  afterEach(() => { vi.unstubAllGlobals(); _setTestDeps({}); });

  it("parses a public calendar feed", async () => {
    const res = await handler(ev("https://cal.example.com/feed.ics"));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).events.length).toBe(1);
  });

  it("blocks a host that resolves to a private IP (DNS check, not just the literal name)", async () => {
    _setTestDeps({ fetchImpl, lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }] });
    const res = await handler(ev("https://innocent.example.com/feed.ics"));
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("blocks a redirect into a private address", async () => {
    fetchImpl.mockImplementationOnce(async () => fakeRes({ status: 302, location: "https://169.254.169.254/latest" }));
    const res = await handler(ev("https://cal.example.com/feed.ics"));
    expect(res.statusCode).toBe(400);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects non-https and unsupported content types", async () => {
    expect((await handler(ev("http://cal.example.com/x.ics"))).statusCode).toBe(400);
    fetchImpl.mockImplementationOnce(async () => fakeRes({ type: "image/png" }));
    expect((await handler(ev("https://cal.example.com/x.ics"))).statusCode).toBe(422);
  });

  it("accepts the ICS content types feeds actually send", async () => {
    for (const type of ["text/plain", "application/octet-stream", "application/ics", "text/x-vcalendar", "text/html"]) {
      fetchImpl.mockImplementationOnce(async () => fakeRes({ type }));
      expect((await handler(ev("https://cal.example.com/x.ics"))).statusCode, type).toBe(200);
    }
  });
});
