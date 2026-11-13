// Bringing Google Docs into Document (WORD_PROCESSOR_DESIGN.md §9). Reads only:
// uses the caller's own Google connection (the Calendar one, with read-only Drive and
// Docs added by gcal-auth ?docs=1) and returns what the device needs to convert
// (documents/editor/gdocs-import.js). Nothing is stored here or in Supabase.
//
//   POST { action: "list", folderId?, pageToken? } → { items: [{ id, name, kind: "doc" | "folder", modified }], nextPageToken }
//   POST { action: "get", fileId } → { doc (Docs API), comments (Drive API), images: { objectId: true } }
//   POST { action: "image", fileId, objectId } → { mime, data (base64) }   (one at a time, ≤ 5 MB)
//   409 { error: "consent" } when the connection doesn't have the Docs scopes yet.
const g = require("./_gcal");

const ID_RE = /^[A-Za-z0-9_-]{10,200}$/;
const OBJ_RE = /^[A-Za-z0-9_.-]{1,200}$/;
const MAX_IMAGE = 5 * 1024 * 1024;

async function google(token, url) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const err = new Error(data?.error?.message || `Google ${res.status}`);
    err.status = res.status;
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
      const q = `'${folder}' in parents and trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.folder')`;
      const params = new URLSearchParams({ q, fields: "nextPageToken, files(id, name, mimeType, modifiedTime)", pageSize: "200", orderBy: "folder,name", supportsAllDrives: "false" });
      if (body.pageToken && /^[A-Za-z0-9_\-~.]{1,500}$/.test(body.pageToken)) params.set("pageToken", body.pageToken);
      const data = await (await google(token, `https://www.googleapis.com/drive/v3/files?${params}`)).json();
      return g.json(200, {
        items: (data.files || []).map((f) => ({ id: f.id, name: f.name, kind: f.mimeType.endsWith("folder") ? "folder" : "doc", modified: f.modifiedTime })),
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
    return g.json(400, { error: "action" });
  } catch (e) {
    if (e.status === 403 || e.status === 401) return g.json(409, { error: "consent", reason: e.message });
    if (e.status === 404) return g.json(404, { error: "That document isn't available." });
    return g.json(502, { error: e.message || "Google didn't answer." });
  }
};
