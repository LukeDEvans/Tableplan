// Presigned URLs for any S3-compatible store (DOCUMENTS_DESIGN.md §5): Cloudflare R2
// today, a home server (Garage / MinIO) later. AWS Signature Version 4, query-string
// form, on WebCrypto — so the same file runs in the Supabase Edge Function (Deno),
// in Node for tests, and nowhere needs a vendor SDK.
//
// Checked against the AWS documentation's worked example (test/documents-storage.test.js).
// Only the server holds the secret; devices get short-lived URLs for one object each.

const te = new TextEncoder();
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", te.encode(s)));
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? te.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, te.encode(data)));
}

// RFC 3986 encoding as SigV4 wants it; "/" kept in paths.
const enc = (s, keepSlash = false) => encodeURIComponent(s)
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  .replace(keepSlash ? /%2F/g : /$^/, "/");

const amzDate = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

// endpoint: "https://<account>.r2.cloudflarestorage.com" (path-style: /<bucket>/<key>)
//           or a virtual-host style origin when bucket is omitted.
// headers: extra headers the request MUST send with these exact values (e.g.
//          { "content-length": "1234" } to pin an upload's size); they're signed.
export async function presignS3({ method, endpoint, bucket, key, region = "auto", accessKeyId, secretAccessKey, expires = 600, now = new Date(), headers = {} }) {
  if (!/^(GET|PUT|DELETE|HEAD)$/.test(method)) throw new Error("presign: bad method");
  if (!Number.isInteger(expires) || expires < 1 || expires > 7 * 24 * 3600) throw new Error("presign: bad expiry");
  const url = new URL(endpoint);
  const path = `${url.pathname.replace(/\/$/, "")}${bucket ? `/${enc(bucket)}` : ""}/${enc(key, true)}`;
  const datetime = amzDate(now);
  const date = datetime.slice(0, 8);
  const scope = `${date}/${region}/s3/aws4_request`;
  const hdrs = { host: url.host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const signedHeaders = Object.keys(hdrs).sort().join(";");
  const query = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": datetime,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const canonicalHeaders = Object.keys(hdrs).sort().map((k) => `${k}:${hdrs[k]}\n`).join("");
  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", datetime, scope, await sha256Hex(canonicalRequest)].join("\n");
  let k = await hmac(`AWS4${secretAccessKey}`, date);
  k = await hmac(k, region);
  k = await hmac(k, "s3");
  k = await hmac(k, "aws4_request");
  const signature = hex(await hmac(k, stringToSign));
  return `${url.origin}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
