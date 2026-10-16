// _recipe-photo.js — pure: find a recipe page's own photo (RECIPE_PHOTOS_DESIGN.md §4.5).
//
// websitePhotoFromHtml(html, pageUrl) → an absolute https URL, or "".
//   1. the JSON-LD Recipe node's `image` (string, array, ImageObject, @graph);
//   2. otherwise the page's og:image / twitter:image.
// Only the URL is returned: the photo is hotlinked by the app, never copied.
//
// Shared by the import gateway (_recipe-extract.js, so imported recipes carry
// `photoUrl`) and recipe-website-photo.js (backfill + "remove my photo").
// Deliberately requires nothing from _recipe-extract.js (that file requires this
// one). The client keeps a twin of pickImageUrl in recipe-photos.js; both are
// tested against the same cases in test/recipe-photos.test.js.

function websitePhotoFromHtml(html, pageUrl = "") {
  const text = String(html || "");
  if (!text) return "";
  for (const block of jsonLdBlocks(text)) {
    for (const node of parseJson(block)) {
      const recipe = findRecipeNode(node);
      const url = recipe ? pickImageUrl(recipe.image, pageUrl) : "";
      if (url) return url;
    }
  }
  return metaImage(text, pageUrl);
}

// JSON-LD `image` can be: "url" | ["url", …] | {url} | {contentUrl} | [{url}, …].
function pickImageUrl(value, pageUrl = "") {
  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    const raw = typeof item === "string"
      ? item
      : (item && typeof item === "object" ? (item.url || item.contentUrl || item["@id"] || "") : "");
    const url = absoluteHttpsUrl(Array.isArray(raw) ? raw[0] : raw, pageUrl);
    if (url) return url;
  }
  return "";
}

function metaImage(html, pageUrl) {
  const head = html.slice(0, 200000); // og tags live in <head>
  const names = ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"];
  for (const name of names) {
    const esc = name.replace(/[.:]/g, (c) => "\\" + c);
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]*content=["']([^"']+)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${esc}["']`, "i");
    const m = head.match(re1) || head.match(re2);
    const url = m ? absoluteHttpsUrl(decodeEntities(m[1]), pageUrl) : "";
    if (url) return url;
  }
  return "";
}

// Resolve against the page, upgrade http → https (an http image on the https app
// would be blocked as mixed content), and refuse anything that isn't a web URL.
function absoluteHttpsUrl(raw, pageUrl = "") {
  const value = String(raw || "").trim();
  if (!value || value.length > 2000 || /^data:/i.test(value)) return "";
  let url;
  try { url = pageUrl ? new URL(value, pageUrl) : new URL(value); } catch { return ""; }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:") return "";
  return url.toString();
}

function jsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) blocks.push(match[1].trim());
  return blocks;
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    try {
      const parsed = JSON.parse(decodeEntities(text));
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch { return []; }
  }
}

function findRecipeNode(node) {
  if (!node || typeof node !== "object") return null;
  const types = (Array.isArray(node["@type"]) ? node["@type"] : [node["@type"]]).map((t) => String(t || "").toLowerCase());
  if (types.includes("recipe")) return node;
  if (Array.isArray(node["@graph"])) return node["@graph"].map(findRecipeNode).find(Boolean) || null;
  return null;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

module.exports = { websitePhotoFromHtml, pickImageUrl, absoluteHttpsUrl, metaImage };
