#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-help}"
shift || true

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INPUT_PATH="${NOIZY_INPUT_PATH:-/NOIZY/raw_stems}"
CANARY_LIMIT="${NOIZY_CANARY_LIMIT:-500}"
GH_REPO="${NOIZY_GH_REPO:-GabrielAv0301/DBPredictor}"
GH_PR_NUMBER="${NOIZY_GH_PR_NUMBER:-1}"

print_usage() {
  cat <<'USAGE'
NOIZY Autonomy Center (voice-friendly operator presets)

Usage:
  npm run autonomy:center -- <action> [args...]

Actions:
  1 | observe             PR status + checks + local scan + receipt verify
  2 | triage              PR comments/reviews triage
  3 | sync-dry            Non-mutating sync plan
  4 | sync-approve        Mutating sync (requires NOIZY_APPROVE_MUTATION=true)
  5 | duplicates          Duplicate scan on source path
  6 | search <query>      Metadata/FAISS search
  7 | ship                Lint + test + typecheck gate
  8 | sync-git            Fetch/prune branch sync
  9 | foss-doctor         GoLand/JBang/FOSS toolchain readiness check
  10| capacity-report     NOIZYVAULT_OS storage capacity + evacuation map
  11| gabriel-scan        Gabriel turbo scan — all volumes, commercial+personal grep
  doctor                  Dependency and env health snapshot
  help                    Show this help

Environment overrides:
  NOIZY_INPUT_PATH        default: /NOIZY/raw_stems
  NOIZY_CANARY_LIMIT      default: 500
  NOIZY_GH_REPO           default: GabrielAv0301/DBPredictor
  NOIZY_GH_PR_NUMBER      default: 1
USAGE
}

assert_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

doctor_mode() {
  assert_command git
  assert_command gh
  assert_command npm
  assert_command python3
  echo "== AUTONOMY DOCTOR =="
  echo "cwd: $ROOT_DIR"
  echo "input: $INPUT_PATH"
  echo "repo: $GH_REPO"
  echo "pr: $GH_PR_NUMBER"
  git --version
  gh --version | head -n 1
  npm --version
  python3 --version
}

observe_mode() {
  (cd "$ROOT_DIR" && npm run git:hotrod -- status "$GH_REPO" "$GH_PR_NUMBER")
  (cd "$ROOT_DIR" && ./noizy scan --input "$INPUT_PATH")
  (cd "$ROOT_DIR" && ./noizy receipt verify)
}

triage_mode() {
  (cd "$ROOT_DIR" && npm run git:hotrod -- triage "$GH_REPO" "$GH_PR_NUMBER")
}

sync_dry_mode() {
  (cd "$ROOT_DIR" && ./noizy sync --input "$INPUT_PATH" --canary "$CANARY_LIMIT" --dry-run)
}

sync_approve_mode() {
  if [[ "${NOIZY_APPROVE_MUTATION:-false}" != "true" ]]; then
    echo "Refusing mutating sync. Set NOIZY_APPROVE_MUTATION=true to proceed." >&2
    exit 1
  fi
  (cd "$ROOT_DIR" && ./noizy sync --input "$INPUT_PATH" --canary "$CANARY_LIMIT" --approve-mutation)
}

duplicates_mode() {
  (cd "$ROOT_DIR" && ./noizy duplicates --input "$INPUT_PATH")
}

search_mode() {
  if [[ $# -eq 0 ]]; then
    echo "Search requires a query string." >&2
    exit 1
  fi
  (cd "$ROOT_DIR" && ./noizy search "$*")
}

ship_mode() {
  (cd "$ROOT_DIR" && npm run git:hotrod -- ship "$GH_REPO" "$GH_PR_NUMBER")
}

sync_git_mode() {
  (cd "$ROOT_DIR" && npm run git:hotrod -- sync "$GH_REPO" "$GH_PR_NUMBER")
}

foss_doctor_mode() {
  (cd "$ROOT_DIR" && ./scripts/noizy-foss-stack-doctor.sh)
}

capacity_report_mode() {
  (cd "$ROOT_DIR" && ./scripts/noizy-capacity-report.sh)
}

gabriel_scan_mode() {
  (cd "$ROOT_DIR" && ./noizy-army/scripts/gabriel-turbo-scan.sh)
}

case "$ACTION" in
  1|observe) observe_mode "$@" ;;
  2|triage) triage_mode "$@" ;;
  3|sync-dry) sync_dry_mode "$@" ;;
  4|sync-approve) sync_approve_mode "$@" ;;
  5|duplicates) duplicates_mode "$@" ;;
  6|search) search_mode "$@" ;;
  7|ship) ship_mode "$@" ;;
  8|sync-git) sync_git_mode "$@" ;;
  9|foss-doctor) foss_doctor_mode "$@" ;;
  10|capacity-report) capacity_report_mode "$@" ;;
  11|gabriel-scan) gabriel_scan_mode "$@" ;;
  doctor) doctor_mode "$@" ;;
  help|--help|-h) print_usage ;;
  *)
    echo "Unknown action: $ACTION" >&2
    print_usage
    exit 1
    ;;
esac
