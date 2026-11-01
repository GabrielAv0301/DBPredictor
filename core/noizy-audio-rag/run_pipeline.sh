#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECEIPTS="$ROOT_DIR/noizy-audio-rag/mc96/receipts.log"
D1_DATABASE="${D1_DATABASE_NAME:-gabriel_db}"
WRANGLER_CONFIG="$ROOT_DIR/cloudflare/wrangler.toml"
MIGRATION_SQL="$ROOT_DIR/update_hvs_creator_assets.sql"
HEALTHCHECK_URL="${HEALTHCHECK_URL:-http://127.0.0.1:8787/health}"

emit_receipt() {
  local verb="$1"
  local hash_input="$2"
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  local sha
  sha="$(printf '%s' "$hash_input" | shasum -a 256 | awk '{print $1}')"
  local rid
  rid="$(printf '%s' "${verb}:${timestamp}" | shasum -a 256 | awk '{print $1}' | cut -c1-24)"
  mkdir -p "$(dirname "$RECEIPTS")"
  printf '{"receipt_id":"%s","verb":"%s","sha256":"%s","timestamp":"%s","operator":"RSP"}\n' \
    "$rid" "$verb" "$sha" "$timestamp" >> "$RECEIPTS"
}

run_stage() {
  local name="$1"
  shift
  "$@"
  emit_receipt "$name" "$name"
}

run_stage validate npm run lint
run_stage test npm run test
run_stage migrate npx wrangler d1 execute "$D1_DATABASE" --file="$MIGRATION_SQL" --config "$WRANGLER_CONFIG" --remote
run_stage backup npx wrangler d1 backup create "$D1_DATABASE" --config "$WRANGLER_CONFIG"
run_stage deploy npx wrangler deploy --config "$WRANGLER_CONFIG"
run_stage verify curl -fsS "$HEALTHCHECK_URL"
emit_receipt receipt "pipeline-complete"
