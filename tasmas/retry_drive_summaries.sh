#!/usr/bin/env bash
# Retry Drive summary uploads for any tasmas recording that has a summary file
# but whose upload may have failed (e.g. due to the _summary.md vs summary_*.md bug).
#
# Usage: ./retry_drive_summaries.sh [tasmas_dir]
#   tasmas_dir defaults to /mnt/media8tb/craig-recordings/tasmas
#
# Reads CRAIG_INTERNAL_TRPC_URL from environment (default: http://localhost:2022).
# Reads CRAIG_REC_DIR for the recordings root (default: /mnt/media8tb/craig-recordings).

set -euo pipefail

TASMAS_DIR="${1:-/mnt/media8tb/craig-recordings/tasmas}"
TRPC_URL="${CRAIG_INTERNAL_TRPC_URL:-http://localhost:2022}"
REC_DIR="${CRAIG_REC_DIR:-/mnt/media8tb/craig-recordings}"

ok=0
skip=0
fail=0

for dir in "$TASMAS_DIR"/*/; do
  id=$(basename "$dir")
  [[ "$id" == "recordings.lock.json" ]] && continue

  summary=$(ls "$dir"summary_*.md 2>/dev/null | head -1)
  [[ -z "$summary" ]] && continue

  info_file="$REC_DIR/${id}.ogg.info"
  if [[ ! -f "$info_file" ]]; then
    echo "SKIP $id: no .ogg.info (recording expired)"
    ((skip++)) || true
    continue
  fi

  user_id=$(python3 -c "import json,sys; d=json.load(open('$info_file')); print(d.get('requesterId',''))" 2>/dev/null)
  if [[ -z "$user_id" ]]; then
    echo "SKIP $id: could not read requesterId"
    ((skip++)) || true
    continue
  fi

  input=$(python3 -c "import json; print(json.dumps({'recordingId':'$id','userId':'$user_id'}))")
  encoded=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$input'))")

  result=$(curl -sf -X GET "${TRPC_URL}/driveSummaryUpload?input=${encoded}" \
    -H "Content-Type: application/json" 2>&1) || true

  uploaded=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('data',{}).get('uploaded','false'))" 2>/dev/null || echo "false")
  error=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('data',{}).get('error',''))" 2>/dev/null || echo "parse_error")
  url=$(echo "$result" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('result',{}).get('data',{}).get('url',''))" 2>/dev/null || echo "")

  if [[ "$uploaded" == "True" ]]; then
    echo "OK   $id: $url"
    ((ok++)) || true
  else
    echo "FAIL $id: $error"
    ((fail++)) || true
  fi

  sleep 0.3
done

echo ""
echo "Done: $ok uploaded, $skip skipped, $fail failed"
