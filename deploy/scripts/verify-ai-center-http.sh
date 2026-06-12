#!/usr/bin/env bash
# =============================================================================
# cube-ai-center — HTTP 冒烟验证（curl）
# =============================================================================
# 用法：
#   ./deploy/scripts/verify-ai-center-http.sh
#   ./deploy/scripts/verify-ai-center-http.sh http://127.0.0.1:3000
#
# Mock 鉴权（USE_GHCLOUD_IDENTITY=0 + AGENTIC_ENGINE_AUTH_MODE=mock）：
#   AI_CENTER_VERIFY_TENANT=91001
#   AI_CENTER_VERIFY_USER_ID=verify-user
#   AI_CENTER_VERIFY_BEARER=any
# =============================================================================

set -u

PASSED=0
FAILED=0

usage() {
  sed -n '1,14p' "$0" | sed -e 's/^# \{0,1\}//' -e '/^$/d'
}

strip_trailing_slash() {
  local x="${1:-}"
  x="${x%/}"
  printf '%s' "$x"
}

pass() {
  PASSED=$((PASSED + 1))
  printf '[PASS] %s — %s\n' "$1" "$2"
}

fail() {
  FAILED=$((FAILED + 1))
  printf '[FAIL] %s — %s\n' "$1" "$2" >&2
}

BASE_URL="$(strip_trailing_slash "${1:-${AI_CENTER_VERIFY_BASE_URL:-http://127.0.0.1:3000}}")"
TENANT="${AI_CENTER_VERIFY_TENANT:-91001}"
USER_ID="${AI_CENTER_VERIFY_USER_ID:-verify-user}"
BEARER="${AI_CENTER_VERIFY_BEARER:-any}"

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "[verify-ai-center] missing: $1" >&2
    exit 2
  }
}
require curl

MOCK_HEADERS=(
  -H "Authorization: Bearer ${BEARER}"
  -H "X-Tenant-Id: ${TENANT}"
  -H "X-User-Id: ${USER_ID}"
)

echo "[verify-ai-center] base=${BASE_URL}"

# /health/live
if body="$(curl -fsS "${BASE_URL}/health/live")"; then
  if printf '%s' "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*"UP"'; then
    pass "health/live" "$body"
  else
    fail "health/live" "unexpected body: $body"
  fi
else
  fail "health/live" "request failed"
fi

# /health/ready
if body="$(curl -fsS "${BASE_URL}/health/ready")"; then
  if printf '%s' "$body" | grep -q '"status"'; then
    pass "health/ready" "$body"
  else
    fail "health/ready" "unexpected body: $body"
  fi
else
  fail "health/ready" "request failed"
fi

# /metrics（Prometheus 文本或 200）
code="$(curl -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/metrics" || echo 000)"
if [ "$code" = "200" ]; then
  pass "metrics" "HTTP 200"
else
  fail "metrics" "HTTP ${code}"
fi

# /v1/sessions（mock 鉴权下应可达；201/200/4xx 业务错误也算路由存活）
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE_URL}/v1/sessions" \
  "${MOCK_HEADERS[@]}" \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"agt_smoke"}' || echo 000)"
case "$code" in
  200|201|400|404|422)
    pass "POST /v1/sessions" "HTTP ${code} (route reachable)"
    ;;
  401|403)
    fail "POST /v1/sessions" "HTTP ${code} — check USE_GHCLOUD_IDENTITY=0 + AGENTIC_ENGINE_AUTH_MODE=mock"
    ;;
  *)
    fail "POST /v1/sessions" "HTTP ${code}"
    ;;
esac

echo
echo "[verify-ai-center] passed=${PASSED} failed=${FAILED}"
if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
