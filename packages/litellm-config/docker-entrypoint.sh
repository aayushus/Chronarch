#!/bin/sh
# Chronarch LiteLLM entrypoint with auto-reload (BRD §20).
#
# The API rewrites the admin-managed files in /app/dynamic (config.yaml +
# litellm.env) on every Settings > AI save. This supervisor polls that
# directory and restarts the litellm process when the files change, so a
# rotated OpenRouter key or new model routing takes effect within seconds
# with no manual `docker compose restart litellm` — which the person using
# the Settings UI cannot run.
set -eu

POLL_SECONDS="${LITELLM_RELOAD_POLL_SECONDS:-5}"
DYNAMIC_DIR="/app/dynamic"
CONFIG_FILE="$DYNAMIC_DIR/config.yaml"
ENV_FILE="$DYNAMIC_DIR/litellm.env"
DEFAULT_CONFIG="/app/config.yaml"

CHILD_PID=""


stop_child() {
  if [ -n "$CHILD_PID" ] && kill -0 "$CHILD_PID" 2>/dev/null; then
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  CHILD_PID=""
}


shutdown() {
  stop_child
  exit 0
}
trap shutdown TERM INT


snapshot() {
  # Fingerprint the UI-managed files. Missing files contribute markers so
  # creation/deletion also counts as a change.
  if [ -f "$CONFIG_FILE" ]; then cat "$CONFIG_FILE"; else echo "(no config)"; fi
  echo "---env---"
  if [ -f "$ENV_FILE" ]; then cat "$ENV_FILE"; else echo "(no env)"; fi
}


start_proxy() {
  # Fresh environment on every (re)start: a cleared key must not linger in
  # this shell from a previous generation.
  unset OPENROUTER_API_KEY || true
  if [ -f "$ENV_FILE" ]; then
    set -a
    # shellcheck disable=SC1091
    . "$ENV_FILE"
    set +a
  fi

  CONFIG="$DEFAULT_CONFIG"
  if [ -f "$CONFIG_FILE" ]; then
    CONFIG="$CONFIG_FILE"
  fi

  litellm --config "$CONFIG" --port 4000 &
  CHILD_PID="$!"
}


LAST="$(snapshot)"
start_proxy

while true; do
  sleep "$POLL_SECONDS"
  CURRENT="$(snapshot)"
  if [ "$CURRENT" != "$LAST" ]; then
    echo "chronarch: dynamic AI config changed — restarting litellm proxy"
    LAST="$CURRENT"
    stop_child
    start_proxy
  elif ! kill -0 "$CHILD_PID" 2>/dev/null; then
    # litellm exited on its own (crash) — bring it back on current config.
    echo "chronarch: litellm process exited — restarting"
    wait "$CHILD_PID" 2>/dev/null || true
    start_proxy
  fi
done
