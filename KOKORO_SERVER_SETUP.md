# Kokoro Server Setup — step by step

Goal: hear Bella read an article, through the app, using Kokoro running on your own machine.

**Do Part A first** — it gets everything working on your Mac with **no tunnel and no auth setup**. Part B (making it work from your phone / in production) comes later, and I'll walk you through it live when you're ready. If Part A doesn't play audio, there's no point doing Part B, so don't skip ahead.

The only thing you truly need installed: **Docker Desktop** (free — docker.com). Everything else is paste-and-go.

---

## Part A — Get it working locally (do this now)

### A1. Start Kokoro on your Mac

Kokoro-FastAPI ships as a Docker image and runs on CPU (no GPU needed). Open Terminal and run:

```bash
docker run -d --name kokoro -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-cpu:latest
```

- First run downloads the model (a few minutes). After that it starts in seconds.
- ⚠️ Image names on community projects drift over time. If that exact line errors, open the **Kokoro-FastAPI** project page, copy its current "run with Docker (CPU)" command, and use that — the rest of this guide is unchanged as long as it serves on port **8880** with the OpenAI-style `/v1/audio/speech` endpoint (the standard for that project).
- To watch it / stop it: `docker logs -f kokoro` … `docker stop kokoro` … `docker start kokoro`.

### A2. Prove Kokoro works by itself

Still in Terminal:

```bash
curl -s -X POST http://localhost:8880/v1/audio/speech \
  -H 'content-type: application/json' \
  -d '{"model":"kokoro","input":"Hello from Kokoro.","voice":"af_bella","response_format":"mp3"}' \
  --output ~/Desktop/kokoro-test.mp3 && open ~/Desktop/kokoro-test.mp3
```

If a `kokoro-test.mp3` on your Desktop plays Bella's voice, **Kokoro itself is good.** Don't continue until this works. (If the voice name errors, the server lists its voices at `http://localhost:8880/v1/audio/voices` in a browser — tell me if they differ from `af_bella, af_nicole, af_sarah, af_sky, am_adam, am_michael`.)

### A3. Point the app at it

In the project folder, create a file named **`.env`** (same folder as `package.json`) containing:

```
KOKORO_URL=http://localhost:8880/v1/audio/speech
KOKORO_TOKEN=local-dev-not-used
```

(Locally there's no auth, so the token is a throwaway. It matters only in Part B.)

### A4. Run the app with functions enabled

The app's functions only run under **Netlify Dev** (plain `vite`/`dev.sh` won't serve them). From the project folder:

```bash
npm run dev
```

That launches Netlify Dev; it prints a URL (usually `http://localhost:5173`). Open it and **log in** as usual. (Netlify Dev picks up your `.env` plus your normal Supabase keys, so the `kokoro-tts` function can verify your session and save audio.)

### A5. Choose Bella (there's no Settings screen yet)

In the browser DevTools **Console**, paste:

```js
state.aiSettings = { ...(state.aiSettings||{}), voice: { default: { voiceId: "bella", speed: 1.0 } } };
persist();
```

To switch back to the current Google voice later: replace `"bella"` with `"google-neural"` and run it again.

### A6. Listen

Open a saved article → press **Listen**.

- ✅ You should hear **Bella**. (No on-screen word-highlighting for Kokoro yet — that's expected; Google still highlights.)
- Press Listen again on the same article → it should start **instantly** (served from cache).

If that works, the entire chain — app → VoiceService → Kokoro provider → `kokoro-tts` function → your Docker Kokoro → audio → playback — is proven. 🎉 Tell me and we'll do Part B.

---

## Part B — Make it work everywhere (later; I'll help live)

Part A only works while `netlify dev` + Docker are running on your Mac. To use Kokoro from your **phone** and on the **deployed site**, the cloud function has to reach your home machine, safely. Three things:

1. **A tunnel** so the internet can reach `localhost:8880` at a stable HTTPS URL — **Tailscale Funnel** (no domain needed, one command) or **Cloudflare Tunnel**.
2. **An auth gate** in front of Kokoro (since the tunnel URL is public) — a tiny **Caddy** container that checks `Authorization: Bearer <secret>` and forwards to Kokoro. The function already sends that bearer.
3. **Two Netlify env vars** (Site config → Environment variables): `KOKORO_URL` = your tunnel's `/v1/audio/speech` URL, `KOKORO_TOKEN` = the secret Caddy checks. Then **push + deploy** (the `kokoro-tts` function ships with that deploy).

I'll give you a one-file `docker-compose` (Kokoro + Caddy) and the exact tunnel + Netlify steps when you're ready — it's more moving parts than Part A, so it's worth doing together after Part A is green.

---

## If something breaks in Part A

Tell me the symptom and I'll pinpoint it:
- **A2 curl fails / no audio** → Kokoro/Docker issue (not the app). Check `docker logs kokoro`.
- **A6 does nothing / console error** → I'll read the error. Common causes: not logged in, `netlify dev` not running (plain Vite won't serve the function), `.env` not picked up, or the voice not selected in A5.
- **"KOKORO_UNAVAILABLE"** → the function can't reach `KOKORO_URL` (Docker not running, wrong URL/port).
- **Wrong voices** → send me the list from `/v1/audio/voices` and I'll align the allowlist.

Nothing here changes app behavior for anyone else: Google stays the default until you've tested Kokoro and we deliberately flip it.
