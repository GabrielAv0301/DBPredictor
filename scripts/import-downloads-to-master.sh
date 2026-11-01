#!/usr/bin/env bash
set -euo pipefail

MASTER_REPO="${1:-/tmp/the-gathering-37495}"
DOWNLOADS_DIR="${DOWNLOADS_DIR:-/Users/m2ultra/Downloads}"
MODE="${MODE:-copy}"

if [[ ! -d "$MASTER_REPO/.git" ]]; then
  echo "Master repo not found or not a git repo: $MASTER_REPO"
  exit 1
fi

if [[ ! -d "$DOWNLOADS_DIR" ]]; then
  echo "Downloads directory not found: $DOWNLOADS_DIR"
  exit 1
fi

if [[ "$MODE" != "copy" && "$MODE" != "move" ]]; then
  echo "MODE must be copy or move."
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
DEST_DIR="$MASTER_REPO/imports/downloads-staged-$STAMP"
LOG_DIR="$MASTER_REPO/imports/logs"
INDEX_FILE="$LOG_DIR/downloads-index-$STAMP.txt"
RESULTS_FILE="$LOG_DIR/downloads-import-$STAMP.tsv"
FAILED_FILE="$LOG_DIR/downloads-import-failed-$STAMP.tsv"

mkdir -p "$DEST_DIR" "$LOG_DIR"

echo "Building Spotlight index list..."
mdfind -onlyin "$DOWNLOADS_DIR" "kMDItemFSName == '*'" | sort -u > "$INDEX_FILE" || true

copied=0
moved=0
failed=0

: > "$RESULTS_FILE"
: > "$FAILED_FILE"

while IFS= read -r source; do
  [[ -n "$source" ]] || continue
  [[ -e "$source" ]] || continue

  rel="${source#$DOWNLOADS_DIR/}"
  if [[ "$rel" == "$source" ]]; then
    continue
  fi

  target="$DEST_DIR/$rel"
  mkdir -p "$(dirname "$target")"

  if [[ -d "$source" ]]; then
    continue
  fi

  if cp -p "$source" "$target" 2>/dev/null; then
    copied=$((copied + 1))
    echo -e "copied\t$source\t$target" >> "$RESULTS_FILE"
  else
    failed=$((failed + 1))
    echo -e "copy_failed\t$source\t$target" >> "$FAILED_FILE"
    continue
  fi

  if [[ "$MODE" == "move" ]]; then
    if rm -f "$source" 2>/dev/null; then
      moved=$((moved + 1))
      echo -e "moved\t$source\t$target" >> "$RESULTS_FILE"
    else
      failed=$((failed + 1))
      echo -e "remove_failed\t$source\t$target" >> "$FAILED_FILE"
    fi
  fi
done < "$INDEX_FILE"

echo "DEST_DIR=$DEST_DIR"
echo "COPIED=$copied"
echo "MOVED=$moved"
echo "FAILED=$failed"
echo "RESULTS=$RESULTS_FILE"
echo "FAILED_REPORT=$FAILED_FILE"
