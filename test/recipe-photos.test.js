// Recipe photos — RECIPE_PHOTOS_DESIGN.md. Pure helpers (client + server twins),
// the website-photo lookup function, and the service worker's photo cache.
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "module";
import { readFileSync } from "fs";
import vm from "vm";
import {
  recipePhotoKind, recipePhotoStoragePath, recipePhotoThumbPath, recipePhotoPublicUrl,
  recipePhotoDisplayUrl, isRecipePhotoPublicUrl, pickImageUrl as clientPickImageUrl,
  recipesNeedingWebsitePhoto, applyWebsitePhotos, chunk
} from "../recipe-photos.js";

const require = createRequire(import.meta.url);
const serverPhoto = require("../netlify/functions/_recipe-photo.js");
const { extractRecipeFromHtml } = require("../netlify/functions/_recipe-extract.js");
const lookupFn = require("../netlify/functions/recipe-website-photo.js");

const SB = "https://noyocjcltrenwdovqrql.supabase.co";
const PATH = "user-1/recipe-abc/cook-1787522405866.jpg";

describe("photo kinds and storage paths", () => {
  it("reads a plain storage path as your own photo", () => {
    expect(recipePhotoKind(PATH)).toBe("own");
    expect(recipePhotoStoragePath(PATH)).toBe(PATH);
  });
  it("reads legacy full public and signed Supabase URLs as the same path", () => {
    expect(recipePhotoStoragePath(`${SB}/storage/v1/object/public/recipe-photos/${PATH}`)).toBe(PATH);
    expect(recipePhotoStoragePath(`${SB}/storage/v1/object/sign/recipe-photos/${PATH}?token=abc`)).toBe(PATH);
    expect(recipePhotoKind(`${SB}/storage/v1/object/public/recipe-photos/${PATH}`)).toBe("own");
  });
  it("treats any other https URL as a website photo", () => {
    expect(recipePhotoKind("https://cooking.example.com/img/soup.jpg")).toBe("web");
    expect(recipePhotoStoragePath("https://cooking.example.com/img/soup.jpg")).toBe("");
  });
  it("treats empty and non-web values as no photo", () => {
    expect(recipePhotoKind("")).toBe("none");
    expect(recipePhotoKind(null)).toBe("none");
    expect(recipePhotoKind("data:image/png;base64,AAAA")).toBe("none");
    expect(recipePhotoKind("blob:https://x/123")).toBe("none");
  });
  it("derives the thumbnail path beside the photo", () => {
    expect(recipePhotoThumbPath(PATH)).toBe("user-1/recipe-abc/cook-1787522405866-thumb.jpg");
    expect(recipePhotoThumbPath("a.b/c")).toBe("a.b/c-thumb");
  });
});

describe("display URLs", () => {
  it("serves your own photo from its stable public URL, with no token", () => {
    const url = recipePhotoDisplayUrl(PATH, { supabaseUrl: SB + "/" });
    expect(url).toBe(`${SB}/storage/v1/object/public/recipe-photos/${PATH}`);
    expect(url).not.toMatch(/token|netlify/);
    expect(isRecipePhotoPublicUrl(url)).toBe(true);
  });
  it("is the same URL every time (cacheable)", () => {
    const a = recipePhotoDisplayUrl(PATH, { supabaseUrl: SB });
    const b = recipePhotoDisplayUrl(`${SB}/storage/v1/object/sign/recipe-photos/${PATH}?token=zzz`, { supabaseUrl: SB });
    expect(a).toBe(b);
  });
  it("asks for the thumbnail when told to", () => {
    expect(recipePhotoDisplayUrl(PATH, { supabaseUrl: SB, thumb: true })).toMatch(/-thumb\.jpg$/);
  });
  it("hotlinks website photos as stored, never as a thumbnail", () => {
    const web = "https://cooking.example.com/img/soup.jpg";
    expect(recipePhotoDisplayUrl(web, { supabaseUrl: SB, thumb: true })).toBe(web);
    expect(isRecipePhotoPublicUrl(web)).toBe(false);
  });
  it("encodes odd characters in path segments", () => {
    expect(recipePhotoPublicUrl("a b/c#d.jpg", SB)).toBe(`${SB}/storage/v1/object/public/recipe-photos/a%20b/c%23d.jpg`);
  });
});

describe("JSON-LD image picking (client and server twins agree)", () => {
  const page = "https://site.example.com/recipes/soup";
  const cases = [
    ["a string", "https://cdn.example.com/soup.jpg", "https://cdn.example.com/soup.jpg"],
    ["an array of strings", ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"], "https://cdn.example.com/1.jpg"],
    ["an ImageObject", { "@type": "ImageObject", url: "https://cdn.example.com/obj.jpg" }, "https://cdn.example.com/obj.jpg"],
    ["an array of ImageObjects", [{ url: "https://cdn.example.com/a.jpg" }], "https://cdn.example.com/a.jpg"],
    ["contentUrl", { contentUrl: "https://cdn.example.com/c.jpg" }, "https://cdn.example.com/c.jpg"],
    ["a relative URL", "/img/soup.jpg", "https://site.example.com/img/soup.jpg"],
    ["http (upgraded)", "http://cdn.example.com/soup.jpg", "https://cdn.example.com/soup.jpg"],
    ["a data URL (refused)", "data:image/png;base64,AAAA", ""],
    ["nothing", undefined, ""],
    ["junk", { width: 400 }, ""],
  ];
  for (const [label, value, expected] of cases) {
    it(label, () => {
      expect(clientPickImageUrl(value, page)).toBe(expected);
      expect(serverPhoto.pickImageUrl(value, page)).toBe(expected);
    });
  }
});

describe("websitePhotoFromHtml", () => {
  const page = "https://site.example.com/recipes/soup";
  const ld = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;

  it("takes the Recipe node's image", () => {
    const html = `<html><head><meta property="og:image" content="https://site.example.com/og.jpg">${ld({ "@type": "Recipe", name: "Soup", image: "https://cdn.example.com/soup.jpg" })}</head></html>`;
    expect(serverPhoto.websitePhotoFromHtml(html, page)).toBe("https://cdn.example.com/soup.jpg");
  });
  it("finds the Recipe inside @graph", () => {
    const html = ld({ "@graph": [{ "@type": "WebPage" }, { "@type": ["Recipe"], image: [{ url: "https://cdn.example.com/g.jpg" }] }] });
    expect(serverPhoto.websitePhotoFromHtml(html, page)).toBe("https://cdn.example.com/g.jpg");
  });
  it("falls back to og:image (either attribute order), decoding entities", () => {
    expect(serverPhoto.websitePhotoFromHtml(`<meta property="og:image" content="https://site.example.com/a.jpg?w=1&amp;h=2">`, page))
      .toBe("https://site.example.com/a.jpg?w=1&h=2");
    expect(serverPhoto.websitePhotoFromHtml(`<meta content="/b.jpg" name="twitter:image">`, page))
      .toBe("https://site.example.com/b.jpg");
  });
  it("returns nothing when the page has no photo or bad JSON", () => {
    expect(serverPhoto.websitePhotoFromHtml(`<script type="application/ld+json">{nope</script><p>hi</p>`, page)).toBe("");
    expect(serverPhoto.websitePhotoFromHtml("", page)).toBe("");
  });
  it("rides along on the import extractor as photoUrl", () => {
    const html = ld({ "@type": "Recipe", name: "Soup", recipeIngredient: ["1 cup water"], image: "https://cdn.example.com/soup.jpg" });
    const recipe = extractRecipeFromHtml(html, page);
    expect(recipe.name).toBe("Soup");
    expect(recipe.photoUrl).toBe("https://cdn.example.com/soup.jpg");
    expect(extractRecipeFromHtml("<h1>Plain</h1><p>Ingredients:</p>", page).photoUrl).toBe("");
  });
});

describe("backfill planning", () => {
  it("picks recipes with a website link and no photo", () => {
    const recipes = [
      { id: "a", sourceUrl: "https://x.com/a", photoUrl: "" },
      { id: "b", sourceUrl: "https://x.com/b", photoUrl: PATH },
      { id: "c", sourceUrl: "", photoUrl: "" },
      { id: "d", sourceUrl: "scan", photoUrl: "" },
    ];
    expect(recipesNeedingWebsitePhoto(recipes)).toEqual([{ id: "a", sourceUrl: "https://x.com/a" }]);
  });
  it("never overwrites a photo, and only applies real website URLs", () => {
    const recipes = [
      { id: "a", sourceUrl: "https://x.com/a", photoUrl: "" },
      { id: "b", sourceUrl: "https://x.com/b", photoUrl: PATH },
      { id: "c", sourceUrl: "https://x.com/c", photoUrl: "" },
      { id: "d", sourceUrl: "https://x.com/d", photoUrl: "" },
    ];
    const changed = applyWebsitePhotos(recipes, {
      "https://x.com/a": "https://img.x.com/a.jpg",
      "https://x.com/b": "https://img.x.com/b.jpg",
      "https://x.com/c": "",
      "https://x.com/d": "javascript:alert(1)",
    });
    expect(changed).toEqual(["a"]);
    expect(recipes[1].photoUrl).toBe(PATH);
    expect(recipes[3].photoUrl).toBe("");
  });
  it("is idempotent", () => {
    const recipes = [{ id: "a", sourceUrl: "https://x.com/a", photoUrl: "" }];
    const photos = { "https://x.com/a": "https://img.x.com/a.jpg" };
    expect(applyWebsitePhotos(recipes, photos)).toEqual(["a"]);
    expect(applyWebsitePhotos(recipes, photos)).toEqual([]);
  });
  it("chunks", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 6)).toEqual([[1, 2, 3, 4, 5, 6], [7]]);
  });
});

describe("recipe-website-photo function", () => {
  const { cleanUrls, lookupWebsitePhotos, MAX_URLS } = lookupFn._test;
  it("keeps only distinct web URLs, capped", () => {
    const many = Array.from({ length: 10 }, (_, i) => `https://x.com/${i}`);
    expect(cleanUrls([...many, "ftp://x", "", "https://x.com/0"]).length).toBe(MAX_URLS);
    expect(cleanUrls(["javascript:1", "https://x.com/a", "https://x.com/a"])).toEqual(["https://x.com/a"]);
    expect(cleanUrls("nope")).toEqual([]);
  });
  it("maps each page to its photo, and failures to empty", async () => {
    const safeFetch = vi.fn(async (url) => {
      if (url.endsWith("/boom")) throw new Error("blocked");
      if (url.endsWith("/404")) return { ok: false, status: 404, body: "" };
      return { ok: true, finalUrl: url, body: `<meta property="og:image" content="/p.jpg">` };
    });
    const photos = await lookupWebsitePhotos(["https://x.com/a", "https://x.com/boom", "https://x.com/404"], { safeFetch });
    expect(photos).toEqual({ "https://x.com/a": "https://x.com/p.jpg", "https://x.com/boom": "", "https://x.com/404": "" });
  });
  it("refuses unauthenticated calls", async () => {
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    try {
      const res = await lookupFn.handler({ httpMethod: "POST", headers: {}, body: "{}" });
      expect(res.statusCode).toBe(401);
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
    }
  });
});

describe("service worker photo cache", () => {
  // Load sw.js in a sandbox with fake caches + fetch, then drive its listeners.
  function loadWorker({ corsOk = true } = {}) {
    const listeners = {};
    const stores = new Map();
    const open = async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const map = stores.get(name);
      return {
        match: async (key) => map.get(typeof key === "string" ? key : key.url),
        put: async (key, res) => { map.set(typeof key === "string" ? key : key.url, res); },
        keys: async () => [...map.keys()].map((url) => ({ url })),
        delete: async (key) => map.delete(typeof key === "string" ? key : key.url),
        addAll: async () => {},
      };
    };
    const fetchCalls = [];
    const fakeFetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input.url;
      fetchCalls.push({ url, mode: init.mode || input.mode || "no-cors" });
      if (init.mode === "cors" && !corsOk) throw new TypeError("CORS");
      return {
        ok: true, status: 200,
        headers: { get: (h) => (h.toLowerCase() === "content-type" ? "image/jpeg" : "") },
        clone() { return this; },
      };
    };
    const context = {
      self: { addEventListener: (type, fn) => { listeners[type] = fn; }, location: { origin: "https://app.example" }, skipWaiting() {}, clients: { claim() {} } },
      caches: { open, keys: async () => [...stores.keys()], delete: async (k) => stores.delete(k), match: async () => undefined },
      fetch: fakeFetch, URL, Promise, Request: class {}, console,
    };
    vm.createContext(context);
    vm.runInContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), context);
    const fire = async (url, extra = {}) => {
      let responded = null;
      const waits = [];
      listeners.fetch({
        request: { url, method: "GET", mode: "no-cors", headers: { has: () => false }, ...extra },
        respondWith: (p) => { responded = p; },
        waitUntil: (p) => waits.push(p),
      });
      const res = responded ? await responded : null;
      await Promise.all(waits);
      return { responded: Boolean(responded), res };
    };
    return { listeners, stores, fetchCalls, fire };
  }

  const photo = `${SB}/storage/v1/object/public/recipe-photos/${PATH}`;

  it("downloads a photo once, then serves it from the cache", async () => {
    const w = loadWorker();
    expect((await w.fire(photo)).responded).toBe(true);
    expect((await w.fire(photo)).responded).toBe(true);
    expect(w.fetchCalls.filter((c) => c.url === photo)).toEqual([{ url: photo, mode: "cors" }]);
  });

  it("leaves other Supabase requests alone", async () => {
    const w = loadWorker();
    expect((await w.fire(`${SB}/rest/v1/eat_recipes?select=*`)).responded).toBe(false);
    expect((await w.fire(`${SB}/storage/v1/object/public/receipts/x.jpg`)).responded).toBe(false);
    expect((await w.fire("https://cooking.example.com/soup.jpg")).responded).toBe(false);
  });

  it("falls back to the page's own request when CORS fails, uncached", async () => {
    const w = loadWorker({ corsOk: false });
    const { res } = await w.fire(photo);
    expect(res.ok).toBe(true);
    expect(w.stores.get("live-recipe-photos-v1")?.size || 0).toBe(0);
  });

  it("keeps the photo cache when a new app version activates", async () => {
    const w = loadWorker();
    await w.fire(photo);
    w.stores.set("live-v1-old", new Map());
    const waits = [];
    w.listeners.activate({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
    expect(w.stores.has("live-recipe-photos-v1")).toBe(true);
    expect(w.stores.has("live-v1-old")).toBe(false);
  });
});
