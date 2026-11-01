#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PAPYRUS_DB="${PAPYRUS_DB:-$ROOT_DIR/noizy-audio-rag/papyrus/papyrus.db}"
RECEIPTS_LOG="$ROOT_DIR/noizy-audio-rag/mc96/receipts.log"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
REPORT_ID="$(printf '%s' "capacity:$TIMESTAMP" | shasum -a 256 | awk '{print $1}' | cut -c1-24)"

RED=$'\033[0;31m'; YLW=$'\033[0;33m'; GRN=$'\033[0;32m'; BLD=$'\033[1m'; RST=$'\033[0m'

status_badge() {
  local pct=$1
  if   (( pct >= 95 )); then printf "${RED}${BLD}CRITICAL${RST}"
  elif (( pct >= 85 )); then printf "${RED}WARNING${RST}"
  elif (( pct >= 75 )); then printf "${YLW}CAUTION${RST}"
  else                       printf "${GRN}OK${RST}"
  fi
}

echo
echo "${BLD}╔══════════════════════════════════════════════════════════╗${RST}"
echo "${BLD}║    NOIZYVAULT_OS — CAPACITY REPORT                      ║${RST}"
echo "${BLD}║    Report ID : $REPORT_ID   ║${RST}"
echo "${BLD}║    Generated : $TIMESTAMP           ║${RST}"
echo "${BLD}╚══════════════════════════════════════════════════════════╝${RST}"
echo

echo "${BLD}── STORAGE VOLUMES ──────────────────────────────────────────${RST}"
printf "%-30s %8s %8s %8s %5s  %s\n" "VOLUME" "SIZE" "USED" "FREE" "%" "STATUS"
printf "%-30s %8s %8s %8s %5s  %s\n" "------" "----" "----" "----" "---" "------"

while IFS= read -r line; do
  pct_raw=$(echo "$line" | awk '{print $5}' | tr -d '%')
  [[ -z "$pct_raw" || ! "$pct_raw" =~ ^[0-9]+$ ]] && continue
  vol=$(echo "$line" | awk '{for(i=9;i<=NF;i++) printf $i (i<NF?" ":""); print ""}' | sed 's|.*/||')
  size=$(echo "$line" | awk '{print $2}')
  used=$(echo "$line" | awk '{print $3}')
  free=$(echo "$line" | awk '{print $4}')
  [[ -z "$vol" ]] && vol=$(echo "$line" | awk '{print $9}')
  badge=$(status_badge "$pct_raw")
  printf "%-30s %8s %8s %8s %4s%%  %s\n" "$vol" "$size" "$used" "$free" "$pct_raw" "$badge"
done < <(df -h 2>/dev/null | grep '/Volumes/')

echo
echo "${BLD}── EVACUATION TARGETS (CRITICAL/WARNING) ────────────────────${RST}"
df -h 2>/dev/null | grep '/Volumes/' | awk '{
  pct=$5; gsub(/%/,"",pct);
  if(pct+0 >= 85) {
    printf "  %-30s %s%% FULL\n", $9, pct
  }
}'

echo
echo "${BLD}── FREE CAPACITY (AVAILABLE LANDING ZONES) ──────────────────${RST}"
df -h 2>/dev/null | grep '/Volumes/' | awk '{
  pct=$5; gsub(/%/,"",pct);
  if(pct+0 < 60) {
    printf "  %-30s %s free\n", $9, $4
  }
}' | sort -k2 -rh

echo
echo "${BLD}── PAPYRUS DB STATE ──────────────────────────────────────────${RST}"
if [[ -f "$PAPYRUS_DB" ]]; then
  asset_count=$(sqlite3 "$PAPYRUS_DB" "SELECT COUNT(*) FROM local_assets;" 2>/dev/null || echo "0")
  receipt_count=$(sqlite3 "$PAPYRUS_DB" "SELECT COUNT(*) FROM stage_receipts;" 2>/dev/null || echo "0")
  db_size=$(du -sh "$PAPYRUS_DB" | awk '{print $1}')
  printf "  %-24s %s\n" "local_assets rows:" "$asset_count"
  printf "  %-24s %s\n" "stage_receipts rows:" "$receipt_count"
  printf "  %-24s %s\n" "DB size on disk:" "$db_size"
else
  echo "  Papyrus DB not found at: $PAPYRUS_DB"
fi

echo
echo "${BLD}── MC96 RECEIPT LOG ──────────────────────────────────────────${RST}"
if [[ -f "$RECEIPTS_LOG" ]]; then
  receipt_lines=$(wc -l < "$RECEIPTS_LOG" | tr -d ' ')
  last_receipt=$(tail -n 1 "$RECEIPTS_LOG")
  printf "  %-24s %s\n" "Total receipts:" "$receipt_lines"
  printf "  %-24s %s\n" "Latest:" "$last_receipt"
else
  echo "  No receipts log yet at: $RECEIPTS_LOG"
fi

echo
echo "${BLD}── RECOMMENDATIONS ───────────────────────────────────────────${RST}"
echo "  1. NOIZY_POOL_B is at 100% — evacuate to NOIZY_POOL_A (1.9TB free) IMMEDIATELY"
echo "  2. 3TB-GRF at 91% — stage overflow to 4TB Lacie (2.2TB free) or NOIZY_POOL_A"
echo "  3. 12TB at 87% — monitor; run dedup scan before next write"
echo "  4. Hollywood Orchestra Mac at 87% — 122GB margin; no new writes without audit"
echo "  5. MICHAEL (931GB) and 120GB_UT (114GB) are nearly empty — use as staging targets"
echo "  6. Run: ./noizy duplicates --input /Volumes/NOIZY_POOL_B before any move"
echo "  7. Run: npm run autonomy:center -- 3  (sync dry-run) before any mutation"

echo
echo "${BLD}── RECEIPT EMISSION ──────────────────────────────────────────${RST}"
mkdir -p "$(dirname "$RECEIPTS_LOG")"
printf '{"receipt_id":"%s","verb":"capacity_report","timestamp":"%s","operator":"MC96"}\n' \
  "$REPORT_ID" "$TIMESTAMP" >> "$RECEIPTS_LOG"
echo "  Receipt $REPORT_ID emitted to receipts.log"
echo
