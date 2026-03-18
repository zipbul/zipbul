#!/bin/bash
# E2E Test Script for Zipbul Examples
# Verifies all REMAIN.md items are GREEN

set -e

PORT=5000
PASS=0
FAIL=0
APP_PID=""

cleanup() {
  # Kill the known app process
  if [ -n "$APP_PID" ]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi

  # Ensure no processes remain on the test port (prevents orphans across runs)
  local stale
  stale=$(lsof -i :"$PORT" -t 2>/dev/null || true)
  if [ -n "$stale" ]; then
    echo "$stale" | xargs kill -9 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "=== Zipbul E2E Tests ==="
echo ""

cd "$(dirname "$0")"

# --- Kill any stale processes on the test port ---
STALE_PIDS=$(lsof -i :"$PORT" -t 2>/dev/null || true)
if [ -n "$STALE_PIDS" ]; then
  echo "[setup] Killing stale processes on :$PORT"
  echo "$STALE_PIDS" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# --- Start app ---
echo "[setup] Starting app..."
bun dist/entry.js &
APP_PID=$!
sleep 3

if ! kill -0 "$APP_PID" 2>/dev/null; then
  echo "[FAIL] App failed to start"
  exit 1
fi

echo "[setup] App running on :$PORT (PID=$APP_PID)"
echo ""

# --- Helper ---
assert_status() {
  local label="$1"
  local expected="$2"
  local method="$3"
  local url="$4"
  local body="$5"
  local headers="${6:--H Content-Type:application/json}"

  local actual
  if [ -n "$body" ]; then
    actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "http://localhost:$PORT$url" -H 'Content-Type: application/json' -d "$body")
  else
    actual=$(curl -s -o /dev/null -w "%{http_code}" -X "$method" "http://localhost:$PORT$url")
  fi

  if [ "$actual" = "$expected" ]; then
    echo "  [PASS] $label (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label — expected $expected, got $actual"
    FAIL=$((FAIL + 1))
  fi
}

assert_body_contains() {
  local label="$1"
  local needle="$2"
  local method="$3"
  local url="$4"
  local body="$5"

  local response
  if [ -n "$body" ]; then
    response=$(curl -s -X "$method" "http://localhost:$PORT$url" -H 'Content-Type: application/json' -d "$body")
  else
    response=$(curl -s -X "$method" "http://localhost:$PORT$url")
  fi

  if echo "$response" | grep -q "$needle"; then
    echo "  [PASS] $label (contains '$needle')"
    PASS=$((PASS + 1))
  else
    echo "  [FAIL] $label — '$needle' not found in: $response"
    FAIL=$((FAIL + 1))
  fi
}

# ═══════════════════════════════════════════════════════
# TODO 1: @UseExceptionFilters(PaymentErrorFilter)
# ═══════════════════════════════════════════════════════
echo "[TODO 1] PaymentErrorFilter"
assert_status "PaymentErrorFilter returns 402" "402" POST "/billing/charge" '{"amount":1500}'
assert_body_contains "PaymentErrorFilter body has PAYMENT_REQUIRED" "PAYMENT_REQUIRED" POST "/billing/charge" '{"amount":1500}'

# ═══════════════════════════════════════════════════════
# TODO 11: @UseGuards(authGuard)
# ═══════════════════════════════════════════════════════
echo "[TODO 11] AuthGuard on DELETE /users/:id"
assert_status "No auth header → 403" "403" DELETE "/users/1"
# With auth header → should succeed (200)
# Using curl with auth header
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "http://localhost:$PORT/users/1" -H 'Authorization: Bearer test-token')
if [ "$STATUS" = "200" ] || [ "$STATUS" = "204" ]; then
  echo "  [PASS] With auth header → allowed (HTTP $STATUS)"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] With auth header → expected 200/204, got $STATUS"
  FAIL=$((FAIL + 1))
fi

# ═══════════════════════════════════════════════════════
# Sanity: existing routes still work
# ═══════════════════════════════════════════════════════
echo "[Sanity] Basic CRUD"
assert_status "GET /posts" "200" GET "/posts"
assert_status "GET /users" "200" GET "/users"
assert_status "GET /billing/history" "200" GET "/billing/history"
assert_status "POST /billing/charge valid" "200" POST "/billing/charge" '{"amount":100}'
assert_status "POST /billing/charge validation" "400" POST "/billing/charge" '{"amount":-1}'

# ═══════════════════════════════════════════════════════
# TODO 10: Same-named AuditService in billing and users
# Both modules inject AuditService — responses should
# include the correct module prefix
# ═══════════════════════════════════════════════════════
echo "[TODO 10] Same-named AuditService across modules"
assert_status "Billing charge with AuditService" "200" POST "/billing/charge" '{"amount":100}'

# ═══════════════════════════════════════════════════════
# TODO 3: Graceful shutdown
# ═══════════════════════════════════════════════════════
echo "[TODO 3] Graceful shutdown"
kill "$APP_PID" 2>/dev/null || true

# Poll until process is actually dead (max 5s)
for i in $(seq 1 50); do
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    break
  fi
  sleep 0.1
done
APP_PID=""

# After stop, server should not respond
STATUS=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 "http://localhost:$PORT/posts" 2>/dev/null) || STATUS="000"
if [ "$STATUS" = "000" ]; then
  echo "  [PASS] Server stopped after app.stop()"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] Server still responding (HTTP $STATUS) after app.stop()"
  FAIL=$((FAIL + 1))
fi

# ═══════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════
echo ""
echo "═══════════════════════════════"
echo "  PASS: $PASS  FAIL: $FAIL"
echo "═══════════════════════════════"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
