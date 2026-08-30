# Single self-contained image for scale-to-zero hosting (Google Cloud Run):
# Kokoro-FastAPI (uvicorn on :8880) + a Caddy Bearer gate on $PORT, in ONE container.
#
#   Internet ──HTTPS──▶ Cloud Run (terminates TLS, sets $PORT)
#                         └─▶ Caddy :$PORT  (checks "Authorization: Bearer $KOKORO_TOKEN")
#                               └─▶ Kokoro  127.0.0.1:8880   (never exposed directly)
#
# Nothing reaches Kokoro without the exact bearer token, so the public Cloud Run URL
# is not an open TTS server. Same auth contract as the home Caddy gate — the app's
# kokoro-tts function is unchanged; only KOKORO_URL points here.
FROM ghcr.io/remsky/kokoro-fastapi-cpu:latest

# Caddy binary straight from the official image — no package manager, no extra layers.
COPY --from=caddy:2 /usr/bin/caddy /usr/bin/caddy

COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /usr/local/bin/start-gated.sh

USER root
RUN chmod +x /usr/local/bin/start-gated.sh /usr/bin/caddy

# Cloud Run injects $PORT (default 8080); Caddy listens there. Kokoro stays internal.
# Keep Caddy's scratch state in /tmp so it never needs a writable HOME.
ENV PORT=8080 \
    XDG_CONFIG_HOME=/tmp \
    XDG_DATA_HOME=/tmp

WORKDIR /app
ENTRYPOINT []
CMD ["/usr/local/bin/start-gated.sh"]
