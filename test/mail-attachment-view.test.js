import { describe, it, expect } from "vitest";
import {
  attachmentViewKind, attachmentBlobType, chooseAttachmentRoute, gmailThreadUrl,
  base64UrlToBytes, fetchAttachmentBytes, ATTACHMENT_MAX_BYTES, ATTACHMENT_LEGACY_MAX_BYTES, ATTACHMENT_ENDPOINT
} from "../mail-attachment-view.js";
import handler, { decodeGmailData, dispositionName, ATTACHMENT_STREAM_MAX } from "../netlify/functions/gmail-attachment.mjs";

describe("attachmentViewKind — what the web viewer may render", () => {
  it("shows PDFs, bitmap images and plain text", () => {
    expect(attachmentViewKind("application/pdf", "a.pdf")).toBe("pdf");
    expect(attachmentViewKind("image/jpeg", "a.jpg")).toBe("image");
    expect(attachmentViewKind("image/PNG", "a.png")).toBe("image");
    expect(attachmentViewKind("text/plain; charset=utf-8", "a.txt")).toBe("text");
    expect(attachmentViewKind("text/csv", "a.csv")).toBe("text");
  });
  it("uses the extension when the declared type is generic", () => {
    expect(attachmentViewKind("application/octet-stream", "Schedule.PDF")).toBe("pdf");
    expect(attachmentViewKind("", "photo.heic")).toBe("none");
    expect(attachmentViewKind("", "photo.webp")).toBe("image");
  });
  it("never renders active content, whatever the filename says", () => {
    expect(attachmentViewKind("text/html", "a.pdf")).toBe("none");
    expect(attachmentViewKind("image/svg+xml", "a.png")).toBe("none");
    expect(attachmentViewKind("application/xhtml+xml", "a.txt")).toBe("none");
    expect(attachmentViewKind("application/octet-stream", "page.html")).toBe("none");
    expect(attachmentViewKind("application/octet-stream", "logo.svg")).toBe("none");
  });
  it("leaves Office files to Download on the web", () => {
    expect(attachmentViewKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "a.docx")).toBe("none");
  });
});

describe("attachmentBlobType — never the sender's raw type", () => {
  it("normalizes per kind", () => {
    expect(attachmentBlobType("pdf", "application/octet-stream", "a.pdf")).toBe("application/pdf");
    expect(attachmentBlobType("image", "image/jpg", "a.jpg")).toBe("image/jpeg");
    expect(attachmentBlobType("image", "", "a.gif")).toBe("image/gif");
    expect(attachmentBlobType("text", "text/csv", "a.csv")).toBe("text/plain;charset=utf-8");
    expect(attachmentBlobType("none", "text/html", "a.html")).toBe("application/octet-stream");
  });
});

describe("chooseAttachmentRoute", () => {
  it("opens in the app up to the streamed limit, Gmail beyond", () => {
    expect(chooseAttachmentRoute({ size: 8_000_000, hasId: true })).toBe("app");
    expect(chooseAttachmentRoute({ size: ATTACHMENT_MAX_BYTES + 1, hasId: true })).toBe("gmail");
  });
  it("uses the legacy cap once the streamed endpoint isn't deployed", () => {
    expect(chooseAttachmentRoute({ size: 4_000_000, hasId: true, legacyOnly: true })).toBe("gmail");
    expect(chooseAttachmentRoute({ size: ATTACHMENT_LEGACY_MAX_BYTES, hasId: true, legacyOnly: true })).toBe("app");
  });
  it("sends attachments with no id to Gmail", () => {
    expect(chooseAttachmentRoute({ size: 10, hasId: false })).toBe("gmail");
  });
  it("keeps the client cap within the function's", () => {
    expect(ATTACHMENT_MAX_BYTES).toBeLessThanOrEqual(ATTACHMENT_STREAM_MAX);
  });
});

describe("helpers", () => {
  it("decodes Gmail base64url", () => {
    const raw = Buffer.from([0xfb, 0xff, 0x00, 0x41]);
    const url = raw.toString("base64url");
    expect(Array.from(base64UrlToBytes(url))).toEqual(Array.from(raw));
    expect(Array.from(decodeGmailData(url))).toEqual(Array.from(raw));
  });
  it("encodes the Gmail link", () => {
    expect(gmailThreadUrl("abc/1")).toBe("https://mail.google.com/mail/#all/abc%2F1");
  });
  it("makes a safe Content-Disposition", () => {
    const d = dispositionName('evil"\r\nX-Header: 1 résumé.pdf');
    expect(d).not.toMatch(/[\r\n]/);
    expect(d).toContain("filename*=UTF-8''");
    expect(d.startsWith("attachment;")).toBe(true);
  });
});

describe("fetchAttachmentBytes", () => {
  const ok = (bytes) => async () => new Response(bytes, { status: 200 });
  it("returns bytes, posting ids with the bearer", async () => {
    let seen;
    const fetchImpl = async (url, init) => { seen = { url, init }; return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); };
    const r = await fetchAttachmentBytes({ messageId: "m", attachmentId: "a", filename: "f.pdf", token: "T", fetchImpl });
    expect(r.ok).toBe(true);
    expect(Array.from(r.bytes)).toEqual([1, 2, 3]);
    expect(seen.url).toBe(ATTACHMENT_ENDPOINT);
    expect(seen.init.headers.authorization).toBe("Bearer T");
    expect(JSON.parse(seen.init.body)).toEqual({ messageId: "m", attachmentId: "a", filename: "f.pdf" });
    expect((await fetchAttachmentBytes({ token: "T", fetchImpl: ok(new Uint8Array()) })).ok).toBe(true);
  });
  it("maps 404 / 413 / errors", async () => {
    const st = (status, body = "{}") => async () => new Response(body, { status });
    expect((await fetchAttachmentBytes({ token: "T", fetchImpl: st(404) })).reason).toBe("notDeployed");
    expect((await fetchAttachmentBytes({ token: "T", fetchImpl: st(413) })).reason).toBe("tooLarge");
    const e = await fetchAttachmentBytes({ token: "T", fetchImpl: st(502, '{"error":"Attachment fetch failed."}') });
    expect(e).toEqual({ ok: false, reason: "error", error: "Attachment fetch failed." });
    const n = await fetchAttachmentBytes({ token: "T", fetchImpl: async () => { throw new Error("offline"); } });
    expect(n.reason).toBe("error");
  });
});

describe("gmail-attachment function", () => {
  const env = { SUPABASE_SERVICE_ROLE_KEY: "svc" };
  const helpers = (gmailBody, overrides = {}) => ({
    getUserId: async (t) => (t === "good" ? "user-1" : null),
    loadUserGmailTokens: async () => ({ refreshToken: "r" }),
    getValidAccessToken: async () => ({ token: "g" }),
    gFetch: async (_tok, path) => { helpers.lastPath = path; return new Response(JSON.stringify(gmailBody), { status: 200 }); },
    ...overrides
  });
  const req = (body, token = "good", origin) => new Request("https://x/.netlify/functions/gmail-attachment", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(origin ? { origin } : {}) },
    body: JSON.stringify(body)
  });

  it("streams the raw bytes as an inert download", async () => {
    const raw = Buffer.from("%PDF-1.7 hello");
    const h = helpers({ data: raw.toString("base64url"), size: raw.length });
    const res = await handler(req({ messageId: "m/1", attachmentId: "a", filename: "doc.pdf" }), {}, { env, helpers: h });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain('filename="doc.pdf"');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("%PDF-1.7 hello");
    expect(res.body).toBeInstanceOf(ReadableStream);
  });
  it("encodes ids into the Gmail path", async () => {
    const seen = [];
    const h = helpers({ data: "" }, { gFetch: async (_t, path) => { seen.push(path); return new Response('{"data":""}'); } });
    await handler(req({ messageId: "m/../x", attachmentId: "a?b" }), {}, { env, helpers: h });
    expect(seen[0]).toBe("/messages/m%2F..%2Fx/attachments/a%3Fb");
  });
  it("refuses files over the streamed cap with tooLarge", async () => {
    const h = helpers({ data: "", size: ATTACHMENT_STREAM_MAX + 1 });
    const res = await handler(req({ messageId: "m", attachmentId: "a" }), {}, { env, helpers: h });
    expect(res.status).toBe(413);
    expect((await res.json()).tooLarge).toBe(true);
  });
  it("requires a session, ids and a connected Gmail", async () => {
    expect((await handler(req({ messageId: "m", attachmentId: "a" }, "bad"), {}, { env, helpers: helpers({}) })).status).toBe(401);
    expect((await handler(req({ messageId: "m" }), {}, { env, helpers: helpers({}) })).status).toBe(400);
    const noGmail = helpers({}, { loadUserGmailTokens: async () => null });
    expect((await handler(req({ messageId: "m", attachmentId: "a" }), {}, { env, helpers: noGmail })).status).toBe(400);
    const expired = helpers({}, { getValidAccessToken: async () => ({ invalidGrant: true }) });
    expect((await handler(req({ messageId: "m", attachmentId: "a" }), {}, { env, helpers: expired })).status).toBe(401);
    const getReq = new Request("https://x/", { method: "GET" });
    expect((await handler(getReq, {}, { env, helpers: helpers({}) })).status).toBe(405);
  });
  it("only echoes known origins for CORS", async () => {
    const h = helpers({ data: "" });
    const good = await handler(req({ messageId: "m", attachmentId: "a" }, "good", "capacitor://localhost"), {}, { env, helpers: h });
    expect(good.headers.get("access-control-allow-origin")).toBe("capacitor://localhost");
    const bad = await handler(req({ messageId: "m", attachmentId: "a" }, "good", "https://evil.example"), {}, { env, helpers: h });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});
