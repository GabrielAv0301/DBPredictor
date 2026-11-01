#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

check_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    local path
    path="$(command -v "$name")"
    local version
    case "$name" in
      goland) version="$(goland --version 2>/dev/null | head -n 1 || echo 'version unavailable')" ;;
      idea) version="$(idea --version 2>/dev/null | head -n 1 || echo 'version unavailable')" ;;
      jbang) version="$(jbang --version 2>/dev/null | head -n 1 || echo 'version unavailable')" ;;
      java) version="$(java -version 2>&1 | head -n 1 || echo 'version unavailable')" ;;
      go) version="$(go version 2>/dev/null || echo 'version unavailable')" ;;
      gradle) version="$(gradle --version 2>/dev/null | head -n 1 || echo 'version unavailable')" ;;
      mvn) version="$(mvn -v 2>/dev/null | head -n 1 || echo 'version unavailable')" ;;
      *) version="$("$name" --version 2>/dev/null | head -n 1 || echo 'version unavailable')" ;;
    esac
    printf "OK   %-10s %-40s %s\n" "$name" "$version" "$path"
  else
    printf "MISS %-10s %s\n" "$name" "not found in PATH"
  fi
}

echo "== NOIZY FOSS STACK DOCTOR =="
echo "repo: $ROOT_DIR"
echo
check_cmd goland
check_cmd idea
check_cmd jbang
check_cmd java
check_cmd go
check_cmd gradle
check_cmd mvn
check_cmd git
check_cmd gh
check_cmd node
check_cmd npm
check_cmd python3
check_cmd ollama
check_cmd sqlite3

echo
echo "JetBrains OSS support:"
echo "https://www.jetbrains.com/community/opensource/#support"
