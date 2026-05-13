#!/usr/bin/env bash
# Re-trigger summarization for a recording that has already been processed.
# Usage: ./trigger-summary.sh <RECORDING_ID>
set -euo pipefail

RID="${1:?Usage: $0 <RECORDING_ID>}"

RECORDINGS_DIR="${CRAIG_RECORDINGS_DIR:-/mnt/media8tb/craig-recordings}"
TASMAS_DIR="${TASMAS_OUTPUT_DIR:-$RECORDINGS_DIR/tasmas}"
ZIP="$RECORDINGS_DIR/$RID.flac.zip"
LOCK="$TASMAS_DIR/recordings.lock.json"
DONE="$TASMAS_DIR/$RID/.done"

if [[ ! -f "$ZIP" ]]; then
    echo "Error: $ZIP not found" >&2
    exit 1
fi

# Clear completed state from lock file
python3 - <<EOF
import json
with open("$LOCK") as f:
    s = json.load(f)
s["recordings"].pop("$RID", None)
with open("$LOCK", "w") as f:
    json.dump(s, f, indent=2, sort_keys=True)
print("Cleared $RID from lock file")
EOF

# Remove .done marker if present
rm -f "$DONE" && echo "Removed .done marker"

# Touch the zip to trigger the watcher
cp "$ZIP" "$ZIP.tmp" && mv "$ZIP.tmp" "$ZIP"
echo "Triggered: $ZIP"
