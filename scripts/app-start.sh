#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
BACKEND_PYTHON="$BACKEND_DIR/venv/bin/python"

FRONTEND_PORT="${FRONTEND_PORT:-3000}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
HOST="${HOST:-127.0.0.1}"
API_URL="${NEXT_PUBLIC_API_URL:-http://$HOST:$BACKEND_PORT}"

MODE="stable"
REBUILD="false"

for arg in "$@"; do
  case "$arg" in
    --dev)
      MODE="dev"
      ;;
    --rebuild)
      REBUILD="true"
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

require_path() {
  local path="$1"
  local message="$2"
  if [[ ! -e "$path" ]]; then
    echo "$message" >&2
    exit 1
  fi
}

port_in_use() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

assert_port_free() {
  local port="$1"
  local service_name="$2"
  if port_in_use "$port"; then
    echo "$service_name could not start because port $port is already in use." >&2
    echo "Free that port first, then rerun this command." >&2
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}

build_frontend() {
  echo "Building frontend for a stable startup..."
  (
    cd "$FRONTEND_DIR"
    NEXT_PUBLIC_API_URL="$API_URL" npm run build
  )
}

cleanup() {
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

require_path "$BACKEND_PYTHON" "Backend virtualenv not found at backend/venv. Set up the backend first."
require_path "$FRONTEND_DIR/package.json" "Frontend package.json not found."
require_path "$BACKEND_DIR/main.py" "Backend entrypoint backend/main.py not found."

assert_port_free "$BACKEND_PORT" "Backend"
assert_port_free "$FRONTEND_PORT" "Frontend"

if [[ "$MODE" == "stable" ]]; then
  if [[ "$REBUILD" == "true" ]]; then
    rm -rf "$FRONTEND_DIR/.next"
    build_frontend
  elif [[ ! -f "$FRONTEND_DIR/.next/BUILD_ID" ]]; then
    build_frontend
  fi
fi

echo "Starting backend on http://$HOST:$BACKEND_PORT"
(
  cd "$BACKEND_DIR"
  if [[ "$MODE" == "dev" ]]; then
    exec "$BACKEND_PYTHON" -m uvicorn main:app --reload --host "$HOST" --port "$BACKEND_PORT"
  else
    exec "$BACKEND_PYTHON" -m uvicorn main:app --host "$HOST" --port "$BACKEND_PORT"
  fi
) &
BACKEND_PID=$!

echo "Starting frontend on http://$HOST:$FRONTEND_PORT"
(
  cd "$FRONTEND_DIR"
  if [[ "$MODE" == "dev" ]]; then
    exec env NEXT_PUBLIC_API_URL="$API_URL" npm run dev -- --hostname "$HOST" --port "$FRONTEND_PORT"
  else
    exec env NEXT_PUBLIC_API_URL="$API_URL" npm run start -- --hostname "$HOST" --port "$FRONTEND_PORT"
  fi
) &
FRONTEND_PID=$!

echo
echo "FPL Copilot is starting up..."
echo "Frontend: http://$HOST:$FRONTEND_PORT"
echo "Backend health: http://$HOST:$BACKEND_PORT/health"
echo

while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

BACKEND_STATUS=0
FRONTEND_STATUS=0

if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
  wait "$BACKEND_PID" || BACKEND_STATUS=$?
fi

if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
  wait "$FRONTEND_PID" || FRONTEND_STATUS=$?
fi

if [[ "$BACKEND_STATUS" -ne 0 ]]; then
  echo "Backend exited unexpectedly with status $BACKEND_STATUS." >&2
fi

if [[ "$FRONTEND_STATUS" -ne 0 ]]; then
  echo "Frontend exited unexpectedly with status $FRONTEND_STATUS." >&2
fi

exit 1
