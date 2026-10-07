#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
PORT="${PORT:-3000}"

if [ ! -d .venv ]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi

( cd backend && PORT="$PORT" exec ../.venv/bin/python server.py ) &
SERVER_PID=$!

if command -v cloudflared >/dev/null 2>&1; then
  cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate &
  TUNNEL_PID=$!
else
  TUNNEL_PID=""
  echo "cloudflared no encontrado: la app queda en http://127.0.0.1:$PORT"
fi

cleanup() { kill "$SERVER_PID" ${TUNNEL_PID:+"$TUNNEL_PID"} 2>/dev/null || true; }
trap cleanup EXIT INT TERM
wait
