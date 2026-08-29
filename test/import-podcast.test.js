import { describe, it, expect } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { safeFetch } = require("../netlify/functions/_import-fetch.js");
const { FEED_CONTENT_TYPES, parseRSS } = require("../netlify/functions/fetch-podcast.js");

// fetch-podcast now fetches the user-supplied feed URL through safeFetch (SSRF +
// resource limits), so its SSRF behavior is covered by import-fetch.test.js. The
// podcast-specific risk is the content-type gate: a real feed served as
// application/rss+xml (or a mislabeled text/html) must pass, not be rejected.
function fakeRes({ status = 200, headers = {}, body = "" } = {}) {
  const h = new Map();
  for (const [k, v] of Object.entries({ "content-type": "text/html", ...headers })) h.set(k.toLowerCase(), v);
  return {
    status,
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    body: null,
    async text() { return body; },
  };
}
const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <title>Test Show</title><description>Hi</description>
  <item><title>Ep 1</title><enclosure url="https://cdn.example.com/1.mp3" type="audio/mpeg"/>
  <guid>ep-1</guid><itunes:duration>1:02:03</itunes:duration></item>
</channel></rss>`;

describe("fetch-podcast — feed content-type gate", () => {
  it.each([
    "application/rss+xml", "application/atom+xml", "application/xml",
    "text/xml", "text/html", "application/octet-stream",
  ])("accepts a feed served as %s (round-trips the XML)", async (ct) => {
    const fetchImpl = async () => fakeRes({ headers: { "content-type": ct }, body: RSS });
    const res = await safeFetch("https://feeds.example.com/show.xml", {
      fetchImpl, lookupImpl: publicLookup,
      allowedContentTypes: FEED_CONTENT_TYPES,
      accept: "application/rss+xml, */*",
    });
    expect(res.ok).toBe(true);
    expect(res.body).toContain("<title>Test Show</title>");
  });

  it("still rejects a genuinely wrong binary type", async () => {
    const fetchImpl = async () => fakeRes({ headers: { "content-type": "image/png" }, body: "\x89PNG" });
    await expect(safeFetch("https://feeds.example.com/x", {
      fetchImpl, lookupImpl: publicLookup, allowedContentTypes: FEED_CONTENT_TYPES,
    })).rejects.toMatchObject({ code: "bad-content-type" });
  });
});

describe("fetch-podcast — parseRSS", () => {
  it("parses title + one episode with duration seconds", () => {
    const parsed = parseRSS(RSS);
    expect(parsed.title).toBe("Test Show");
    expect(parsed.episodes).toHaveLength(1);
    expect(parsed.episodes[0]).toMatchObject({
      id: "ep-1", title: "Ep 1", audioUrl: "https://cdn.example.com/1.mp3", duration: 3723,
    });
  });
});
