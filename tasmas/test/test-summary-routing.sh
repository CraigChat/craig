#!/usr/bin/env bash
# Tests notify_summary_delivery() in process_flac_zip.py using a mock bot API.
#
# Usage:
#   cd tasmas/test && ./test-summary-routing.sh
#   PORT=3002 ./test-summary-routing.sh     # use a different port if 3001 is in use
#
# Requirements: python3, curl (both available in the TASMAS container and on the host).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export TASMAS_DIR
TASMAS_DIR="$(dirname "$SCRIPT_DIR")"   # tasmas/ — added to sys.path by Python calls below

PORT="${PORT:-3001}"
SECRET="test-secret-$(date +%s)"       # fresh secret each run
PASS=0
FAIL=0
MOCK_PID=""

# ── Helpers ────────────────────────────────────────────────────────────────────

cleanup() { stop_mock; }
trap cleanup EXIT

start_mock() {
    local mode="${1:-200}"
    local secret="${2:-}"
    python3 "$SCRIPT_DIR/mock-bot-api.py" \
        --port "$PORT" --mode "$mode" \
        ${secret:+--secret "$secret"} \
        >>/tmp/mock-bot-api-test.log 2>&1 &
    MOCK_PID=$!
    # Wait up to 2 s for the port to open
    python3 - <<PYEOF
import socket, sys, time
for _ in range(20):
    try:
        socket.create_connection(("127.0.0.1", $PORT), timeout=0.1).close()
        sys.exit(0)
    except OSError:
        time.sleep(0.1)
print("mock-bot-api did not start in time", file=sys.stderr)
sys.exit(1)
PYEOF
}

stop_mock() {
    if [[ -n "$MOCK_PID" ]]; then
        kill "$MOCK_PID" 2>/dev/null || true
        wait "$MOCK_PID" 2>/dev/null || true
        MOCK_PID=""
    fi
}

# Call notify_summary_delivery(recording_id) with env vars set in the current shell.
# Accepts inline  VAR=val notify "rec-001"  thanks to bash function env-prefix semantics.
# logging_utils.log is patched to a no-op before the import so log lines don't pollute stdout.
notify() {
    python3 - "$1" <<'PYEOF'
import sys, os
sys.path.insert(0, os.environ["TASMAS_DIR"])
import logging_utils
logging_utils.log = lambda msg, *, stream=None: None  # silence during tests
from process_flac_zip import notify_summary_delivery
print("True" if notify_summary_delivery(sys.argv[1]) else "False")
PYEOF
}

check() {
    local desc="$1" expected="$2" actual="$3"
    if [[ "$actual" == "$expected" ]]; then
        printf '  \033[0;32mPASS\033[0m  %s\n' "$desc"
        PASS=$((PASS + 1))
    else
        printf '  \033[0;31mFAIL\033[0m  %s  (expected %s, got %s)\n' "$desc" "$expected" "$actual"
        FAIL=$((FAIL + 1))
    fi
}

# ── Test cases ─────────────────────────────────────────────────────────────────

echo "=== notify_summary_delivery() — routing tests (port $PORT) ==="
echo ""

# 1. No URL set → function exits early without touching the network
echo "[1] CRAIG_INTERNAL_API_URL not set"
result=$(CRAIG_INTERNAL_API_URL="" CRAIG_INTERNAL_SECRET="" notify "rec-001")
check "returns False immediately when URL is empty" "False" "$result"

# 2. Bot returns 200 → summary delivered, return True
echo "[2] Bot returns 200 (channel configured)"
start_mock 200 "$SECRET"
result=$(CRAIG_INTERNAL_API_URL="http://127.0.0.1:$PORT/deliver-summary" \
         CRAIG_INTERNAL_SECRET="$SECRET" notify "rec-002")
stop_mock
check "returns True on 200" "True" "$result"

# 3. Bot returns 204 → no channel found (guild has no system channel)
echo "[3] Bot returns 204 (no channel found for recording)"
start_mock 204 "$SECRET"
result=$(CRAIG_INTERNAL_API_URL="http://127.0.0.1:$PORT/deliver-summary" \
         CRAIG_INTERNAL_SECRET="$SECRET" notify "rec-003")
stop_mock
check "returns False on non-200 (summary not delivered)" "False" "$result"

# 4. Bot returns 500 → internal error
echo "[4] Bot returns 500 (internal error)"
start_mock 500 "$SECRET"
result=$(CRAIG_INTERNAL_API_URL="http://127.0.0.1:$PORT/deliver-summary" \
         CRAIG_INTERNAL_SECRET="$SECRET" notify "rec-004")
stop_mock
check "returns False on 500 (summary not delivered)" "False" "$result"

# 5. Wrong secret → bot returns 401
echo "[5] Wrong secret → 401"
start_mock 200 "$SECRET"
result=$(CRAIG_INTERNAL_API_URL="http://127.0.0.1:$PORT/deliver-summary" \
         CRAIG_INTERNAL_SECRET="wrong-secret" notify "rec-005")
stop_mock
check "returns False on 401 (summary not delivered)" "False" "$result"

# 6. No server at that address → curl fails
echo "[6] Connection refused (bot not running)"
result=$(CRAIG_INTERNAL_API_URL="http://127.0.0.1:$PORT/deliver-summary" \
         CRAIG_INTERNAL_SECRET="" notify "rec-006")
check "returns False when server unreachable (summary not delivered)" "False" "$result"

# 7. No secret required → unauthenticated request succeeds
echo "[7] No secret required"
start_mock 200  # no secret arg
result=$(CRAIG_INTERNAL_API_URL="http://127.0.0.1:$PORT/deliver-summary" \
         CRAIG_INTERNAL_SECRET="" notify "rec-007")
stop_mock
check "returns True when server has no auth configured" "True" "$result"

# ── Summary ────────────────────────────────────────────────────────────────────

echo ""
if [[ $FAIL -gt 0 ]]; then
    printf 'Results: \033[0;32m%d passed\033[0m, \033[0;31m%d failed\033[0m\n' "$PASS" "$FAIL"
    exit 1
else
    printf 'Results: \033[0;32m%d passed\033[0m, %d failed\n' "$PASS" "$FAIL"
fi
