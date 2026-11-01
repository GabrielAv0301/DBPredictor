#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-status}"
REPO="${2:-GabrielAv0301/DBPredictor}"
PR_NUMBER="${3:-1}"

export GH_PAGER=""

status_mode() {
  echo "== HOT ROD STATUS =="
  git --no-pager status -sb
  echo "---"
  gh pr view "$PR_NUMBER" --repo "$REPO" --json url,state,headRefName,baseRefName,mergeStateStatus
  echo "---"
  gh pr checks "$PR_NUMBER" --repo "$REPO" || true
}

triage_mode() {
  echo "== HOT ROD TRIAGE =="
  gh pr view "$PR_NUMBER" --repo "$REPO" --json comments,reviews --jq '{comments:.comments|length,reviews:.reviews|length}'
  echo "---"
  gh pr view "$PR_NUMBER" --repo "$REPO" --comments
}

ship_mode() {
  echo "== HOT ROD SHIP =="
  npm run lint
  npm run test
  npm run typecheck
  git --no-pager status -sb
  echo "Ship check complete. Use normal commit/push flow after reviewing status."
}

sync_mode() {
  echo "== HOT ROD SYNC =="
  git fetch --all --prune
  git --no-pager branch -vv
}

case "$MODE" in
status) status_mode ;;
triage) triage_mode ;;
ship) ship_mode ;;
sync) sync_mode ;;
*)
  echo "Usage: ./scripts/hotrod-git-leader.sh [status|triage|ship|sync] [owner/repo] [pr_number]"
  exit 1
  ;;
esac
