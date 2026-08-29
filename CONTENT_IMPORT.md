# CONTENT_IMPORT.md — Unified content import (Phase 0 + Phase 1)

Status: **gateway live; unified in-app import wired.** Phase 0 (recipe-import fix),
Phase 1 (secure deterministic import foundation), Phase 2 (the unified `/import` gateway),
and the in-app cutover are implemented. The in-app "Import from URL" dialog now `POST`s
`/import` and routes by detected type: a recipe opens the recipe form; an article is
saved to the reading list (`state.savedArticles`, deduped on URL) with the extracted
title/author/date/text. An Android **Web Share Target** routes shared links into that
same importer. The Chrome extension's **recipe** import now `POST`s `/import` too (its
article save intentionally stays on `save-article` — see below). AI fallback is **not**
built.

See `ARCHITECTURE_AUDIT.md` for the full plan this derives from. This file documents
only what exists now.

## Modules (all pure/CJS, `netlify/functions/_*.js`, unit-tested)

| Module | Responsibility |
|---|---|
| `_import-url.js` | SSRF URL/host/IP classification (`assertAllowedUrl`, `isBlockedIp`, `isBlockedHostname`) + conservative `canonicalizeUrl` (dedup key) + `normalizeImportUrlInput`. No DOM, no network. |
| `_import-fetch.js` | `safeFetch(url, opts)` — the **one** guarded fetch for public import URLs. SSRF checks (pre-DNS + resolved-IP + per-redirect), timeout, max-size (streamed), max-redirects, content-type allow-list, clean request context. `statusForImportError` maps codes → HTTP status. |
| `_recipe-extract.js` | Deterministic recipe extraction moved verbatim from `import-recipe`: JSON-LD (multi-block + `@graph`) → HTML/text heuristic fallback. `extractRecipeFromHtml` / `extractRecipeFromText`. |
| `_article-extract.js` | Deterministic server-side article extraction moved verbatim from `fetch-article`: metadata + JSON-LD `articleBody` + `__NEXT_DATA__` walker + semantic-HTML blocks. `extractArticleFromHtml`. |
| `_import-contract.js` | Ingestion result shape `{ type, status, confidence, data, warnings, source }` + `scoreRecipe`/`scoreArticle` (field-presence only). **Not** a persistence model. |
| `_import-detect.js` | `detectContentType({html,text,url,metadata,hint})` → `{ type: recipe\|article\|unknown, confidence, reason }` from hint → JSON-LD `@type` → og:type → microdata → recipe DOM signals → URL heuristic. |
| `_import-gateway.js` | `runImport(input, {safeFetch?})` — orchestration: use `extractedContent` if supplied else `safeFetch(url)`; detect; extract with that core; if not `ready`, also try the other core and keep the higher-scoring result; return the contract. **Stateless — never persists.** |

`import-recipe.js` and `fetch-article.js` are now thin handlers (auth + request/response)
over these modules. Response shapes are unchanged; `import-recipe` additionally returns
an `{ result }` (the contract) alongside the existing `{ recipe }`.

## Gateway (`/import`, additive)

`netlify/functions/import.js` — `POST`, session-verified. Body:

```
{ source:{ url?, title?, sharedText?, sourceClient? },
  hints?:{ contentType? },
  extractedContent?:{ html?, text?, metadata? } }
```

→ returns the import-result contract (with a `detection` annotation). The handler is a
thin auth wrapper over `runImport`; typed fetch errors map to HTTP status via
`statusForImportError`. It is **stateless extraction only** — the caller persists
`result.data` through the existing domain path (recipe → `eat_recipes`; article →
`media.savedArticles` via `updateSection`). Existing endpoints (`import-recipe`,
`save-article`, `fetch-article`) are untouched; nothing calls `/import` yet.

Server vs client: pass a `url` for normal server-side import; pass `extractedContent`
(rendered `html`/`text` + `metadata`) for logged-in/JS-rendered pages the server can't
reproduce — the gateway then skips its own fetch.

## Mobile share (Web Share Target)

`manifest.json` declares a **GET** `share_target` (`action:"/"`, params `title/text/url`).
Sharing a link to the installed PWA opens it at `/?url=…` (or `/?text=…`); `app.js`'s
`handleImportUrlParameter` reads `importUrl`/`url`/`text`/`title`, extracts the first URL
(Android Chrome often puts the link in `text`), strips the params, and opens the unified
importer with auto-fetch — so a shared recipe or article is detected and routed with no
extra taps. No service-worker change is needed (GET navigation flows through the existing
network-first handler).

Platform limits: **iOS Safari does not support Web Share Target** — there is no code path
that makes it work; the fallback is the in-app "Import from URL" paste box (or a
user-added iOS Shortcut that opens `/?url=…`). On Android it requires the PWA to be
**installed**. If the app is locked when a share arrives, the URL is pre-filled but the
auto-fetch may fail until the user unlocks and taps Fetch (a later refinement could defer
the fetch past unlock).

## Security model (server-side fetch)

Every server import fetch goes through `safeFetch`, which:

- allows only `http`/`https`, ports 80/443, rejects embedded credentials;
- rejects `localhost`, single-label + `.local/.internal/.lan/.home/.corp/.intranet`
  hosts, and IP literals in private/loopback/link-local/CGNAT/multicast/reserved ranges
  (IPv4 + IPv6, incl. `169.254.169.254` cloud-metadata and IPv4-mapped IPv6);
- resolves DNS and rejects if **any** resolved address is blocked;
- follows redirects **manually**, re-validating scheme/host/resolved-IP on **every** hop,
  capped at `maxRedirects` (default 4);
- aborts after `timeoutMs` (default 10s) and caps the body at `maxBytes` (default ~3 MB,
  checked against `Content-Length` and enforced while streaming);
- enforces a content-type allow-list (text/markup by default; callers may widen);
- sends only a `User-Agent` + `Accept` — **never** forwards cookies, Authorization, or
  the user's session to the third-party site.

**Residual (documented, accepted):** global `fetch` re-resolves DNS at connect time, so
resolve-then-fetch does not fully close DNS-rebinding. Full IP pinning needs a custom
undici dispatcher and would break TLS SNI/cert validation; these endpoints are already
session-authenticated, so the residual is accepted rather than over-engineered.

## Canonical URL

`canonicalizeUrl` is conservative: it removes the fragment, default ports, a trailing
slash, and a small allow-list of tracking params (`utm_*`, `fbclid`, `gclid`, …). It
**preserves** all other query params and their order. The original source URL is kept
separately (`source.url`); the canonical form is only a dedup key.

## Deliberately NOT here

Extension **article** migration and popup unification (the extension's recipe import now
uses `/import`, but its article save deliberately stays on `save-article`: the extension's
own rendered-DOM extraction already produces exactly what `save-article` persists, so
round-tripping it through the gateway's *server-side* extractor would add a call and a
failure mode for no gain — unifying the popup into one "Add to Tableplan" button is a
later UX task). Also not here: microdata/RDFa recipe parsing and AI fallback. Duplicate
detection still uses each domain's
existing exact-URL match (recipe `source_url`; article `savedArticles[].url`);
canonicalization is available (and surfaced as `source.canonicalUrl`) for a later,
backward-compatible dedup upgrade.
