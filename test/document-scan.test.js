import { describe, it, expect, vi, afterEach } from "vitest";
import { scanDocument, parseDataUrl, buildContentBlock, validateAndBuildBlocks, parseJsonFromText, outputText } from "../document-scan.js";

const IMG = "data:image/jpeg;base64,QUJD";
const PDF = "data:application/pdf;base64,QUJD";

describe("document-scan — pure helpers", () => {
  it("parseDataUrl splits media type + data; rejects junk", () => {
    expect(parseDataUrl(IMG)).toEqual({ media_type: "image/jpeg", data: "QUJD" });
    expect(() => parseDataUrl("nope")).toThrow();
  });
  it("buildContentBlock: image always, PDF only when allowed", () => {
    expect(buildContentBlock(IMG).type).toBe("image");
    expect(() => buildContentBlock(PDF)).toThrow(/PNG/);
    expect(buildContentBlock(PDF, { allowPdf: true }).type).toBe("document");
  });
  it("validateAndBuildBlocks enforces presence + count", () => {
    expect(validateAndBuildBlocks([IMG]).length).toBe(1);
    expect(() => validateAndBuildBlocks([])).toThrow(/at least one/i);
    expect(() => validateAndBuildBlocks([IMG, IMG], { max: 1 })).toThrow(/up to 1/i);
  });
  it("parseJsonFromText handles bare + wrapped JSON; empty throws", () => {
    expect(parseJsonFromText('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonFromText('prefix {"a":2} suffix')).toEqual({ a: 2 });
    expect(() => parseJsonFromText("")).toThrow();
  });
  it("outputText joins only text blocks", () => {
    expect(outputText({ content: [{ type: "text", text: "a" }, { type: "image" }, { type: "text", text: "b" }] })).toBe("a\nb");
  });
});

describe("scanDocument — the shared vision call", () => {
  const orig = globalThis.fetch;
  afterEach(() => { globalThis.fetch = orig; });

  it("posts model/temperature/prompt+image blocks and returns { rawText, model }", async () => {
    let captured;
    globalThis.fetch = vi.fn(async (url, opts) => {
      captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
      return { ok: true, json: async () => ({ content: [{ type: "text", text: '{"ok":1}' }] }) };
    });
    const res = await scanDocument({ items: [IMG], prompt: "PROMPT", options: { apiKey: "k", model: "m1" } });
    expect(res).toEqual({ rawText: '{"ok":1}', model: "m1" });
    expect(captured.url).toContain("anthropic.com");
    expect(captured.body.model).toBe("m1");
    expect(captured.body.temperature).toBe(0);
    expect(captured.body.messages[0].content[0]).toEqual({ type: "text", text: "PROMPT" });
    expect(captured.body.messages[0].content[1].type).toBe("image");
    expect(captured.headers["x-api-key"]).toBe("k");
    expect(captured.headers["anthropic-beta"]).toBeUndefined();
  });

  it("adds the PDF beta header when allowPdf + betaHeader", async () => {
    let headers;
    globalThis.fetch = vi.fn(async (url, opts) => { headers = opts.headers; return { ok: true, json: async () => ({ content: [{ type: "text", text: "{}" }] }) }; });
    await scanDocument({ items: [PDF], prompt: "P", options: { apiKey: "k", allowPdf: true, betaHeader: "pdfs-2024-09-25" } });
    expect(headers["anthropic-beta"]).toBe("pdfs-2024-09-25");
  });

  it("throws a labeled error on non-ok, and a keyed error with no API key", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, json: async () => ({ error: { message: "boom" } }) }));
    await expect(scanDocument({ items: [IMG], prompt: "P", options: { apiKey: "k" } })).rejects.toThrow("boom");
    await expect(scanDocument({ items: [IMG], prompt: "P", options: { apiKey: "", missingKeyMessage: "needs ANTHROPIC_API_KEY" } })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
