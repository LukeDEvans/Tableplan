#!/bin/bash
# Start Kokoro (uvicorn :8880) in the background via its own entrypoint, then run the
# Caddy Bearer gate in the foreground on $PORT. Caddy opens $PORT immediately so Cloud
# Run's startup probe passes fast, and holds early requests until Kokoro has warmed up.
set -e

cd /app
./entrypoint.sh &

exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
