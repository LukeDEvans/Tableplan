#!/usr/bin/env bash
# Starts the API server (port 4175) and Vite dev server (port 4174) together.
# Ctrl+C kills both.

PORT=4175 node server.js &
API_PID=$!

cleanup() {
  kill "$API_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM

npx vite
