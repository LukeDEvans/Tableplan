# CONTENT_IMPORT.md — Unified content import (Phase 0 + Phase 1)

Status: **foundation only.** Phase 0 (recipe-import fix) + Phase 1 (secure, reusable
deterministic import foundation) are implemented. The unified `/import` gateway,
mobile Share Target, extension migration, and AI fallback are **not** built yet.

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

`import-recipe.js` and `fetch-article.js` are now thin handlers (auth + request/response)
over these modules. Response shapes are unchanged; `import-recipe` additionally returns
an `{ result }` (the contract) alongside the existing `{ recipe }`.

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

Microdata/RDFa recipe parsing, AI fallback, the `/import` gateway, mobile Share Target,
and the Chrome-extension migration. Duplicate detection still uses each domain's existing
exact-URL match (recipe `source_url`; article `savedArticles[].url`); canonicalization is
available for a later, backward-compatible dedup upgrade.
