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

describe("fetch-podcast — oversized feeds are truncated, not rejected", () => {
  const { closeTruncatedFeed } = require("../netlify/functions/fetch-podcast.js");
  const item = (n) => `<item><title>Ep ${n}</title><guid>ep-${n}</guid>` +
    `<enclosure url="https://cdn.example.com/${n}.mp3" type="audio/mpeg"/>` +
    `<description>${"show notes ".repeat(800)}</description></item>`;
  // ~9 KB per episode, like White Coat Investor's libsyn feed.
  const bigFeed = `<?xml version="1.0"?><rss version="2.0"><channel><title>Big Show</title>` +
    Array.from({ length: 800 }, (_, i) => item(800 - i)).join("") + `</channel></rss>`;

  function streamRes(body, headers = {}) {
    const buf = Buffer.from(body);
    let off = 0;
    const h = new Map(Object.entries({ "content-type": "application/rss+xml", "content-length": String(buf.length), ...headers }));
    return {
      status: 200,
      headers: { get: (k) => h.get(String(k).toLowerCase()) ?? null },
      body: {
        getReader: () => ({
          async read() {
            if (off >= buf.length) return { done: true };
            const chunk = buf.subarray(off, off + 65536); off += chunk.length;
            return { done: false, value: new Uint8Array(chunk) };
          },
          async cancel() {},
        }),
      },
    };
  }

  it("is bigger than the cap (sanity)", () => {
    expect(Buffer.byteLength(bigFeed)).toBeGreaterThan(5_000_000);
  });

  it("still throws too-large without truncate (other importers unchanged)", async () => {
    await expect(safeFetch("https://feeds.example.com/big.xml", {
      fetchImpl: async () => streamRes(bigFeed), lookupImpl: publicLookup,
      allowedContentTypes: FEED_CONTENT_TYPES, maxBytes: 2_000_000,
    })).rejects.toMatchObject({ code: "too-large" });
  });

  it("with truncate, returns the first maxBytes and flags it", async () => {
    const res = await safeFetch("https://feeds.example.com/big.xml", {
      fetchImpl: async () => streamRes(bigFeed), lookupImpl: publicLookup,
      allowedContentTypes: FEED_CONTENT_TYPES, maxBytes: 2_000_000, truncate: true,
    });
    expect(res.ok).toBe(true);
    expect(res.truncated).toBe(true);
    expect(Buffer.byteLength(res.body)).toBeLessThanOrEqual(2_000_000);
  });

  it("parses the newest 50 episodes from a truncated feed", async () => {
    const res = await safeFetch("https://feeds.example.com/big.xml", {
      fetchImpl: async () => streamRes(bigFeed), lookupImpl: publicLookup,
      allowedContentTypes: FEED_CONTENT_TYPES, maxBytes: 2_000_000, truncate: true,
    });
    const parsed = parseRSS(closeTruncatedFeed(res.body));
    expect(parsed.title).toBe("Big Show");
    expect(parsed.episodes).toHaveLength(50);
    expect(parsed.episodes[0]).toMatchObject({ id: "ep-800", title: "Ep 800" });
    expect(parsed.episodes.every((e) => e.audioUrl.startsWith("https://cdn.example.com/"))).toBe(true);
  });

  it("closeTruncatedFeed drops a half-written trailing item", () => {
    const cut = `<rss><channel><title>T</title>${item(2)}<item><title>Ep 1</title><enclosure url="https://x/1.mp3"`;
    const parsed = parseRSS(closeTruncatedFeed(cut));
    expect(parsed.episodes.map((e) => e.id)).toEqual(["ep-2"]);
  });

  it("handles a feed without streaming body (text() path)", async () => {
    const res = await safeFetch("https://feeds.example.com/big.xml", {
      fetchImpl: async () => fakeRes({ headers: { "content-type": "application/rss+xml" }, body: bigFeed }),
      lookupImpl: publicLookup, allowedContentTypes: FEED_CONTENT_TYPES, maxBytes: 2_000_000, truncate: true,
    });
    expect(res.truncated).toBe(true);
    expect(parseRSS(closeTruncatedFeed(res.body)).episodes).toHaveLength(50);
  });
});
