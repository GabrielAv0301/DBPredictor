#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SQL_FILE="$ROOT_DIR/update_hvs_creator_assets.sql"
WRANGLER_CONFIG="$ROOT_DIR/cloudflare/wrangler.toml"
DATABASE_NAME="${D1_DATABASE_NAME:-gabriel_db}"
MODE="${1:---remote}"

if [[ "$MODE" != "--remote" && "$MODE" != "--local" ]]; then
  echo "Usage: ./scripts/run-d1-migration.sh [--remote|--local]"
  exit 1
fi

if [[ "$MODE" == "--remote" && -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "CLOUDFLARE_API_TOKEN is not set."
  echo "Create a token (D1 edit permissions), then export it:"
  echo "  export CLOUDFLARE_API_TOKEN='***'"
  exit 1
fi

if [[ ! -f "$WRANGLER_CONFIG" ]]; then
  echo "Missing wrangler config: $WRANGLER_CONFIG"
  exit 1
fi

npx wrangler d1 execute "$DATABASE_NAME" --file="$SQL_FILE" "$MODE" --config "$WRANGLER_CONFIG"
