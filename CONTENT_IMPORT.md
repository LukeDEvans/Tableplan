# CONTENT_IMPORT.md — Unified content import (Phase 0 + Phase 1)

Status: **gateway live; in-app recipe importer wired.** Phase 0 (recipe-import fix),
Phase 1 (secure deterministic import foundation), Phase 2 (the unified `/import` gateway),
and the first client cutover (the in-app recipe importer now `POST`s `/import` and
populates the recipe form from the contract) are implemented. The Chrome extension and
mobile Share Target still use the existing endpoints. Mobile Share Target, the extension
migration, a unified in-app entry that also saves articles, and AI fallback are **not**
built yet.

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

Extension + mobile-share wiring to `/import` (the in-app **recipe** importer now uses it;
the extension and mobile share still use the existing endpoints), a unified in-app entry
that also **saves articles** (the recipe dialog only imports recipes — an article URL
gets a clear "that's an article" message, not a save), mobile Share Target, the
Chrome-extension migration, microdata/RDFa recipe parsing, and AI fallback. Duplicate
detection still uses each domain's
existing exact-URL match (recipe `source_url`; article `savedArticles[].url`);
canonicalization is available (and surfaced as `source.canonicalUrl`) for a later,
backward-compatible dedup upgrade.
