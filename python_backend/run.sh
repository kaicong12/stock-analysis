#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8765}"
exec "$HOME/.moomoo-venv/bin/python" -m uvicorn main:app --app-dir "$HERE" --host 127.0.0.1 --port "$PORT" --log-level info
