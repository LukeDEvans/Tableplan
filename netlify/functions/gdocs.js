// Bringing Google Docs into Document (WORD_PROCESSOR_DESIGN.md §9). Reads only:
// uses the caller's own Google connection (the Calendar one, with read-only Drive and
// Docs added by gcal-auth ?docs=1) and returns what the device needs to convert
// (documents/editor/gdocs-import.js). Nothing is stored here or in Supabase.
//
//   POST { action: "list", folderId?, pageToken? } → { items: [{ id, name, kind: "doc" | "folder", modified }], nextPageToken }
//   POST { action: "get", fileId } → { doc (Docs API), comments (Drive API), images: { objectId: true } }
//   POST { action: "image", fileId, objectId } → { mime, data (base64) }   (one at a time, ≤ 5 MB)
//   POST { action: "list", kind: "slides", … } → the same, listing Google Slides presentations and folders
//   POST { action: "slidesPptx", fileId, offset } → { size, hash (sha-256 of the whole file), data (base64, up to 3 MB from offset), next | null }
//        Google Slides brought over as the PowerPoint file Drive exports (read-only Drive
//        scope, already part of the Docs connection; SLIDES_DESIGN.md §10). Drive exports up
//        to 10 MB; the file comes back in pieces to stay under the function's reply limit.
//   409 { error: "consent" } when the connection doesn't have the Docs scopes yet.
const g = require("./_gcal");

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const OBJ_RE = /^[A-Za-z0-9_.-]{1,200}$/;
const MAX_IMAGE = 5 * 1024 * 1024;
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const PPTX_CHUNK = 3 * 1024 * 1024;

async function google(token, url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data?.error?.message || `Google ${res.status}`);
    err.status = res.status;
    err.reason = data?.error?.errors?.[0]?.reason || "";
    throw err;
  }
  return res;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return g.json(405, { error: "Method not allowed" });
  const userId = await g.userIdFromRequest(event);
  if (!userId) return g.json(401, { error: "Not authenticated." });
  let body;
  try { body = JSON.parse(event.body || "{}"); } catch { return g.json(400, { error: "Bad JSON" }); }
  const account = await g.loadAccount(userId).catch(() => null);
  if (!account) return g.json(409, { error: "consent", reason: "not connected" });
  const scopes = String(account.scopes || "").split(/\s+/);
  if (!g.DOCS_SCOPES.every((s) => scopes.includes(s))) return g.json(409, { error: "consent" });
  const tok = await g.getAccessToken(account);
  if (!tok.token) return g.json(409, { error: "consent", reason: tok.invalidGrant ? "expired" : tok.error });
  const token = tok.token;

  try {
    if (body.action === "list") {
      const folder = body.folderId && ID_RE.test(body.folderId) ? body.folderId : "root";
      const want = body.kind === "slides" ? "application/vnd.google-apps.presentation" : "application/vnd.google-apps.document";
      const q = `'${folder}' in parents and trashed = false and (mimeType = '${want}' or mimeType = 'application/vnd.google-apps.folder')`;
      const params = new URLSearchParams({ q, fields: "nextPageToken, files(id, name, mimeType, modifiedTime)", pageSize: "200", orderBy: "folder,name", supportsAllDrives: "false" });
      if (body.pageToken && /^[A-Za-z0-9_\-~.]{1,500}$/.test(body.pageToken)) params.set("pageToken", body.pageToken);
      const data = await (await google(token, `https://www.googleapis.com/drive/v3/files?${params}`)).json();
      return g.json(200, {
        items: (data.files || []).map((f) => ({ id: f.id, name: f.name, kind: f.mimeType.endsWith("folder") ? "folder" : body.kind === "slides" ? "slides" : "doc", modified: f.modifiedTime })),
        nextPageToken: data.nextPageToken || null,
      });
    }
    if (body.action === "get") {
      if (!ID_RE.test(body.fileId || "")) return g.json(400, { error: "fileId" });
      const doc = await (await google(token, `https://docs.googleapis.com/v1/documents/${body.fileId}?includeTabsContent=false`)).json();
      let comments = [];
      try {
        const params = new URLSearchParams({ fields: "comments(content, quotedFileContent, author(displayName), createdTime, resolved, deleted, replies(content, author(displayName), createdTime, deleted))", pageSize: "100", includeDeleted: "false" });
        comments = (await (await google(token, `https://www.googleapis.com/drive/v3/files/${body.fileId}/comments?${params}`)).json()).comments || [];
      } catch { /* comments are a bonus */ }
      // Images are fetched one by one (action "image"); drop their short-lived URLs here.
      const images = {};
      for (const [id, o] of Object.entries(doc.inlineObjects || {})) {
        const ip = o?.inlineObjectProperties?.embeddedObject?.imageProperties;
        if (ip?.contentUri) { images[id] = true; delete ip.contentUri; }
      }
      return g.json(200, { doc, comments, images });
    }
    if (body.action === "image") {
      if (!ID_RE.test(body.fileId || "") || !OBJ_RE.test(body.objectId || "")) return g.json(400, { error: "ids" });
      const doc = await (await google(token, `https://docs.googleapis.com/v1/documents/${body.fileId}?fields=inlineObjects`)).json();
      const uri = doc.inlineObjects?.[body.objectId]?.inlineObjectProperties?.embeddedObject?.imageProperties?.contentUri;
      if (!uri || !/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(uri)) return g.json(404, { error: "image" });
      const res = await fetch(uri, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return g.json(502, { error: `image ${res.status}` });
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_IMAGE) return g.json(413, { error: "image too large" });
      return g.json(200, { mime: res.headers.get("content-type") || "image/png", data: buf.toString("base64") });
    }
    if (body.action === "slidesPptx") {
      if (!ID_RE.test(body.fileId || "")) return g.json(400, { error: "fileId" });
      const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${body.fileId}/export?mimeType=${encodeURIComponent(PPTX_MIME)}`, { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const reason = data?.error?.errors?.[0]?.reason || "";
        if (reason === "exportSizeLimitExceeded") return g.json(413, { error: "That presentation is too large for Google to hand over (over 10 MB). Download it from Google Slides as PowerPoint and open that file here instead." });
        const err = new Error(data?.error?.message || `Google ${res.status}`);
        err.status = res.status;
        err.reason = reason;
        throw err;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const part = buf.subarray(offset, offset + PPTX_CHUNK);
      // Each piece is a fresh export, so the piece carries the whole file's hash; the
      // page checks every piece came from the same bytes.
      const hash = require("crypto").createHash("sha256").update(buf).digest("hex");
      return g.json(200, { size: buf.length, hash, data: part.toString("base64"), next: offset + PPTX_CHUNK < buf.length ? offset + PPTX_CHUNK : null });
    }
    return g.json(400, { error: "action" });
  } catch (e) {
    // Not every 403 is a missing permission: busy limits and files whose owner turned off
    // downloading say so plainly instead of asking to reconnect.
    if (/rateLimitExceeded|userRateLimitExceeded|quotaExceeded/.test(e.reason || "")) return g.json(429, { error: "Google is busy right now. Try again in a minute." });
    if (/cannotDownloadFile|cannotExportFile|cannotCopyFile/.test(e.reason || "")) return g.json(403, { error: "The owner of this file has turned off downloading, so it can't be brought over." });
    if (e.status === 403 || e.status === 401) return g.json(409, { error: "consent", reason: e.message });
    if (e.status === 404) return g.json(404, { error: "That document isn't available." });
    return g.json(502, { error: e.message || "Google didn't answer." });
  }
};
