#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRANGLER_CONFIG="$ROOT_DIR/cloudflare/wrangler.toml"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is required for deploy."
  exit 1
fi

if [[ -z "${API_AUTH_TOKEN:-}" ]]; then
  echo "API_AUTH_TOKEN is required and must be set in the environment."
  exit 1
fi

npx wrangler deploy --config "$WRANGLER_CONFIG" --var "API_AUTH_TOKEN:$API_AUTH_TOKEN"
