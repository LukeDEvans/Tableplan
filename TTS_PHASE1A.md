# TTS Phase 1A — Kokoro proxy + home-server integration

Makes Kokoro a real provider behind the Phase-0 architecture, via a session-gated
proxy. **Behavior unchanged for users:** Google stays the default; Kokoro is only
reached if a Kokoro voice is explicitly selected. No playback-engine / queue /
Settings / assistant changes.

## Topology (implemented)

```
client (VoiceService → Kokoro provider: kokoroSynthViaProxy)
   → POST /.netlify/functions/kokoro-tts   (Supabase session bearer)
      → verify app session (getUserId)
      → validate + allowlist voice + chunk text (kokoro-core.mjs)
      → server-to-server POST {KOKORO_URL}  (Authorization: Bearer {KOKORO_TOKEN})   ← env only, SSRF-safe
      → store chunk MP3s in Storage under the Phase-0 cacheKey
   → { urls, timings:null, cached }   ← same shape the engine already plays
```

## Security

- **Client auth:** the existing Supabase session — `callNetlifyFunction` sends the access-token bearer; the function calls Supabase `/auth/v1/user` to verify (never trusts a client user id).
- **Proxy → home-server auth:** `Authorization: Bearer ${KOKORO_TOKEN}` (server-side env). The token/URL are **never** bundled into client JS (verified: `grep` of `dist/` finds zero `KOKORO_URL`/`KOKORO_TOKEN`/`process.env.KOKORO`; the client knows only the function name).
- **SSRF:** the destination is `KOKORO_URL` from env **only** — the client cannot supply a url/host/endpoint. The voice is checked against an explicit allowlist (`KOKORO_VOICES`), so a client can't request an arbitrary voice/model path.
- **Validation:** authenticated user, body JSON, text present + ≤ `MAX_TTS_CHARS` (60k), voice ∈ allowlist, speed finite (clamped 0.5–2.0). Only allowlisted fields are forwarded.
- **No silent fallback:** if Kokoro is unconfigured/unreachable the function returns a typed error; the client throws; the VoiceService does **not** reroute to Google (private text never leaks to a third party).
- **Logging:** metadata only (`reqId, status, code, voice, count, ms, textLen`) — never the text, never secrets.

## Provider flow (`bella → kokoro → af_bella`)

Unchanged from Phase 0: `voice-registry` resolves `bella → {provider:"kokoro", providerVoiceId:"af_bella"}`; `voice-service` computes the cache key and calls the Kokoro provider, whose `synthViaProxy` (wired in Phase 1A) POSTs to `kokoro-tts` with the resolved `providerVoiceId` + `cacheKey`. The proxy re-validates the voice against its own allowlist.

## Audio → `{ urls, timings }`

The home server returns raw MP3 bytes per chunk; the function stores them as `${cacheKey}/${i}.mp3` in the `article-audio` bucket and returns `{ urls, timings }` — the identical normalized shape the Google provider returns and the playback engine already consumes. **No new audio format, no engine change.**

## Word highlighting (§12)

Kokoro (base model) has no word-level alignment, so **`timings` is `null`** in Phase 1A. The existing highlighting path already no-ops on null timings (`highlightCurrentWord` guards `listenWordAbsTimes`), so **Kokoro articles simply don't highlight; Google highlighting is untouched.** The meta reserves the `timings` field for a future aligned Kokoro.

## Cache

Uses the **Phase-0 content-addressed identity** (`ttsCacheKey`: provider + providerVoiceId + model + speed-marker + text hash). Kokoro (`provider:"kokoro"`, `model:"kokoro-v1"`) and Google keys never collide, so they share the `article-audio` bucket safely. Bumping `KOKORO_MODEL` (client) invalidates Kokoro audio. Legacy behavior + `articleId` fallback preserved.

## Playback engine

**No changes.** `playback-engine.js`, `MEDIA_KINDS`, `prefetchNextQueueAudio`, `ttsResolvedUrls`, `beginNextResolvedArticleSync`, and the persistent `<audio>` are untouched (verified by diff).

## Concurrency / timeouts (§17–18)

- The function synthesizes chunks **sequentially** (a natural throttle); it does not parallelize.
- Per-chunk home-server request timeout = 25s (`AbortController`) → typed `KOKORO_TIMEOUT`.
- **The home Kokoro server must bound its own concurrency** (a small worker pool/queue) — multiple articles/users produce concurrent function invocations. (Do not add distributed job infra.)
- Known limit (shared with `generate-tts`): a very long article's total synthesis can exceed the serverless function's overall timeout; long-form streaming/look-ahead is the Phase-2 SpeechQueue concern.

## Retry policy (§19)

Conservative — only `KOKORO_TIMEOUT` / `KOKORO_UNAVAILABLE` are marked retryable (`isRetryable`); invalid/auth/unsupported-voice are terminal. The proxy itself does not auto-retry (avoids synthesis storms); playback-level recovery comes with the SpeechQueue phase.

## Deployment configuration

Set on Netlify (server-side env; already have `SUPABASE_SERVICE_ROLE_KEY`):

| Var | Purpose |
|---|---|
| `KOKORO_URL` | The home Kokoro server's synth endpoint, reachable from Netlify (via a tunnel — Tailscale Funnel / Cloudflare Tunnel). Server-side only. |
| `KOKORO_TOKEN` | Shared bearer secret the home server checks. Server-side only. |

**Home Kokoro server contract** (implement on the home box; keep it simple + stable):
```
POST {KOKORO_URL}
  Authorization: Bearer {KOKORO_TOKEN}
  Content-Type: application/json
  { "text": "<chunk ≤1800 chars>", "voice": "af_bella", "speed": 1.0, "format": "mp3" }
→ 200  Content-Type: audio/mpeg   (raw MP3 bytes for the chunk)
→ 4xx/5xx → error (mapped: 401/403→AUTH_FAILED, 400/422→INVALID_REQUEST,
                    404/502/503/504→UNAVAILABLE, else→SYNTHESIS_FAILED)
```
- The server must reject requests without the correct `KOKORO_TOKEN`.
- The server should bound concurrency.
- No new Supabase bucket needed (reuses `article-audio`). `netlify.toml` already bundles `kokoro-core.mjs` with the function.

## Real-device QA (do BEFORE any default flip)

Kokoro is reachable but **not** the default and there is **no Settings UI yet** (Phase 3). To exercise Kokoro, temporarily select it from the browser console while logged in:
```js
state.aiSettings = { ...(state.aiSettings||{}), voice: { default: { voiceId: "bella", speed: 1.0 } } };
persist();
```
Revert with `voiceId: "google-neural"` (or delete `state.aiSettings.voice`) + `persist()`.

1. **Desktop, logged in:** open a saved article → **Listen** → confirm Kokoro audio plays. (Word highlighting will NOT appear for Kokoro — expected.) Replay → confirm a **cache hit** (instant, `cached:true`).
2. **Article transition:** queue A→B→C → confirm no avoidable gap/failure across articles.
3. **iPhone:** start playback → **lock the phone** → confirm playback continues + Now Playing is correct → confirm the A→B transition while locked/backgrounded.
4. **Failure / no-fallback:** unset `KOKORO_URL` (or stop the home server) → select Kokoro → **Listen** → confirm it reports a failure and does **NOT** silently play a Google voice.
5. Switch back to `google-neural` → confirm Google TTS + highlighting still work exactly as before.

**Only after these pass** do we consider flipping the default to Bella (a separate step).
