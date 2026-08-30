# Home Kokoro server

Runs the private Kokoro TTS engine + a Bearer auth gate, so the deployed app's
`kokoro-tts` function can reach it securely over a tunnel.

```
Netlify function ──(HTTPS + Bearer token)──▶ TUNNEL ──▶ Caddy :8080 (checks Bearer) ──▶ Kokoro :8880
                                                                                          ▲
                                    local dev (server.js) ────────────────────────────────┘  (direct, no auth)
```

## Run it

```bash
cd kokoro-server
# .env holds KOKORO_TOKEN=<secret> (generated once; keep it out of git)
docker compose up -d
docker compose ps        # kokoro + caddy should be Up
docker compose logs -f   # watch; "Model warmed up" means Kokoro is ready
```

- **:8880** — Kokoro directly. Used by LOCAL dev (`server.js` → `localhost:8880`), no auth.
- **:8080** — Caddy, **Bearer-gated**. The tunnel exposes THIS. Requests without
  `Authorization: Bearer <KOKORO_TOKEN>` get 401.

`KOKORO_TOKEN` lives in `kokoro-server/.env` **and** in the Netlify site env — they must match.

## Tunnel — current: Tailscale Funnel

1. `brew install --cask tailscale` (or download from tailscale.com), open it, sign in.
2. In login.tailscale.com: enable **MagicDNS** + **HTTPS Certificates** (DNS page), and allow **Funnel** for this machine (Access controls / the Funnel docs page).
3. Expose the gated port:
   ```bash
   tailscale funnel 8080          # prints https://<machine>.<tailnet>.ts.net
   # or:  tailscale funnel --bg 8080   (run in background)
   ```
4. Netlify env vars (Site config → Environment variables):
   - `KOKORO_URL = https://<machine>.<tailnet>.ts.net/v1/audio/speech`
   - `KOKORO_TOKEN = <same secret as .env>`
   - Do **NOT** set `KOKORO_LOCAL_NO_AUTH` in Netlify (that flag is local-dev only).

## Switching to Cloudflare Tunnel later (drop-in — nothing else changes)

The Caddy gate + `KOKORO_TOKEN` stay exactly as they are. Only the tunnel layer and
one env var change:

1. Get/point a domain at Cloudflare; install `cloudflared`; create a **named tunnel**:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create kokoro
   # route a hostname (e.g. tts.yourdomain.com) to the local Caddy port:
   cloudflared tunnel route dns kokoro tts.yourdomain.com
   cloudflared tunnel run --url http://localhost:8080 kokoro
   ```
   (or add cloudflared as a service / a container in this compose with the tunnel token.)
2. Change ONE Netlify var: `KOKORO_URL = https://tts.yourdomain.com/v1/audio/speech`.
3. Redeploy. Done — no app code, no Caddy change, same token.

Why you might switch: Cloudflare has no practical bandwidth cap and a stable custom
subdomain, which matters if TTS traffic grows (assistant/email/audiobooks). Tailscale
Funnel is simpler and free but bandwidth-limited.

## Stop / update

```bash
docker compose down       # stop
docker compose pull && docker compose up -d   # update Kokoro/Caddy images
```
