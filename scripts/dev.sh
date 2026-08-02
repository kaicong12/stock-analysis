#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a; . .env; set +a
fi

SIDECAR_PORT="${PYBACKEND_URL##*:}"
SIDECAR_PORT="${SIDECAR_PORT%/}"
OPEND_HOST="${FUTU_OPEND_HOST:-127.0.0.1}"
OPEND_PORT="${FUTU_OPEND_PORT:-11111}"

SIDECAR_PID=""
NEXT_PID=""
SHUTTING_DOWN=0

# OpenD probe — TCP connect via bash's /dev/tcp redirect (no nc required).
# Returns 0 if something is listening on host:port, non-zero otherwise.
opend_reachable() {
  ( exec 3<>"/dev/tcp/${OPEND_HOST}/${OPEND_PORT}" ) 2>/dev/null
}

# Kill a PID and every descendant, depth-first. macOS-portable (uses pgrep -P).
kill_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  kill -0 "$pid" 2>/dev/null || return 0
  local kids
  kids=$(pgrep -P "$pid" 2>/dev/null || true)
  for k in $kids; do kill_tree "$k"; done
  kill -TERM "$pid" 2>/dev/null || true
}

# Wait up to ~3s for a tree to die, then SIGKILL anything still alive.
finalize_tree() {
  local pid="$1"
  [ -z "$pid" ] && return 0
  for _ in 1 2 3 4 5 6; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.5
  done
  local lingering
  lingering=$(pgrep -P "$pid" 2>/dev/null || true)
  for l in $lingering; do kill -KILL "$l" 2>/dev/null || true; done
  kill -KILL "$pid" 2>/dev/null || true
}

cleanup() {
  [ "$SHUTTING_DOWN" = "1" ] && return
  SHUTTING_DOWN=1
  echo ""
  echo "[dev] shutting down…"

  kill_tree "$NEXT_PID"
  kill_tree "$SIDECAR_PID"

  finalize_tree "$NEXT_PID"
  finalize_tree "$SIDECAR_PID"

  echo "[dev] done."
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

port_in_use() { lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }

# ---- moomoo OpenD precheck (must be running — sidecar is useless without it) ----
if ! opend_reachable; then
  cat >&2 <<EOF
[opend] ERROR: moomoo OpenD is not reachable at ${OPEND_HOST}:${OPEND_PORT}.

Without OpenD the python sidecar can't fetch any moomoo data, which means every
panel call (capital, technical, derivatives, news, digest, sentiment) will fail.

Start OpenD before running this script:
  - macOS:   open -a "moomoo OpenD"   (or launch from Applications)
  - Linux:   ./moomooOpenD            (from the OpenD install directory)
  - Windows: launch moomooOpenD.exe

Then re-run: pnpm dev:all

(Override host/port via FUTU_OPEND_HOST / FUTU_OPEND_PORT in .env if non-default.)
EOF
  exit 1
fi
echo "[opend] reachable on ${OPEND_HOST}:${OPEND_PORT}."

# ---- Python sidecar ----
if port_in_use "$SIDECAR_PORT"; then
  echo "[sidecar] already on :$SIDECAR_PORT — leaving as-is (will not stop on Ctrl-C)."
else
  echo "[sidecar] starting on :$SIDECAR_PORT …"
  PORT="$SIDECAR_PORT" bash "$ROOT/python_backend/run.sh" >"$ROOT/.dev-sidecar.log" 2>&1 &
  SIDECAR_PID=$!
  echo "[sidecar] pid=$SIDECAR_PID  log=.dev-sidecar.log"
fi

sleep 1

# ---- Next.js dev (own background slot so cleanup() can reach it) ----
echo "[next] starting Next.js dev server (Ctrl-C stops everything)…"
pnpm exec next dev &
NEXT_PID=$!
wait "$NEXT_PID"
