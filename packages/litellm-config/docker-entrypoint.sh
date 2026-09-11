#!/bin/sh
# Picks up admin-managed config from the shared volume (written by the
# Chronarch API from Settings > AI / LiteLLM), falling back to the baked
# default config when the volume is empty (fresh deploy, nothing saved yet).
set -eu

if [ -f /app/dynamic/litellm.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /app/dynamic/litellm.env
  set +a
fi

CONFIG=/app/config.yaml
if [ -f /app/dynamic/config.yaml ]; then
  CONFIG=/app/dynamic/config.yaml
fi

exec litellm --config "$CONFIG" --port 4000
