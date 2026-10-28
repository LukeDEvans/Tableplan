// Newsletter → listenable briefing on Claude Haiku 5.5 (_news-articles.js via
// _claude.js): the request follows Haiku 5.5's rules (no prefill, no sampling
// parameters, effort set, text read by block type) and a refusal fails the
// conversion so the email is retried, not saved empty.
import { describe, it, expect, afterEach } from "vitest";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const A = require("../netlify/functions/_news-articles.js");
const C = require("../netlify/functions/_claude.js");

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const NEWSLETTER = `<html><body><h1>The Morning</h1>${"<p>A long paragraph of the day's reporting, with enough words to pass the length checks.</p>".repeat(20)}</body></html>`;
const ARTICLE = `<h2>Top story</h2>${"<p>Converted paragraph of the newsletter's editorial content.</p>".repeat(12)}`;

function mockAnthropic(reply) {
  const requests = [];
  globalThis.fetch = async (url, opts) => {
    requests.push(JSON.parse(opts.body));
    return { ok: true, json: async () => reply(requests.length) };
  };
  return requests;
}

describe("newsletter conversion on Haiku 5.5", () => {
  it("one request: claude-haiku-5-5, effort low, 16k cap, user turn last, no sampling params", async () => {
    const requests = mockAnthropic(() => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: ARTICLE }] }));
    const html = await A.convertNewsEmailToArticle("k", { name: "The Morning" }, { subject: "The Morning", date: "Tue", html: NEWSLETTER });
    expect(html).toBe(ARTICLE);
    expect(requests).toHaveLength(1);
    const r = requests[0];
    expect(r.model).toBe("claude-haiku-5-5");
    expect(A.NEWSLETTER_MODEL).toBe("claude-haiku-5-5");
    expect(r.output_config).toEqual({ effort: "low" });
    expect(r.max_tokens).toBe(16000);
    expect(r.messages.at(-1).role).toBe("user");
    expect(r.temperature).toBeUndefined();
    expect(r.top_p).toBeUndefined();
    expect(r.thinking).toBeUndefined();
  });
  it("never continues with a prefill, even when the output hit max_tokens", async () => {
    const requests = mockAnthropic(() => ({ stop_reason: "max_tokens", content: [{ type: "text", text: ARTICLE }] }));
    await C.claudeCallComplete("k", { system: "s", user: "u", model: "claude-haiku-5-5", maxRounds: 5 });
    expect(requests).toHaveLength(1);
    expect(requests[0].messages.every((m) => m.role === "user")).toBe(true);
  });
  it("older models still continue as before", async () => {
    const requests = mockAnthropic((n) => ({ stop_reason: n < 3 ? "max_tokens" : "end_turn", content: [{ type: "text", text: `part${n} ` }] }));
    const out = await C.claudeCallComplete("k", { system: "s", user: "u", model: "claude-haiku-4-5-20251001", maxRounds: 5 });
    expect(requests).toHaveLength(3);
    expect(requests[1].messages.at(-1)).toEqual({ role: "assistant", content: "part1" });
    expect(out).toBe("part1part2part3 "); // each prefill is trimmed, as before
  });
  it("a refusal fails the conversion (the sweep leaves the email for retry)", async () => {
    mockAnthropic(() => ({ stop_reason: "refusal", content: [] }));
    await expect(A.convertNewsEmailToArticle("k", { name: "The Morning" }, { subject: "s", date: "d", html: NEWSLETTER })).rejects.toThrow(/refusal/);
  });
});
