#!/usr/bin/env bash
# 需：API 已启动（如 npm run dev -w @zhizhu/api）、.env 已配 DATABASE_URL 与 JWT_SECRET 且已 migrate:api 含平台种子。
set -euo pipefail
API_BASE="${API_URL:-http://127.0.0.1:3000}"
OUT="$(mktemp)"
trap 'rm -f "$OUT"' EXIT

curl -sSf "$API_BASE/health" > /dev/null
CODE=$(
  curl -sS -o "$OUT" -w '%{http_code}' -X POST "$API_BASE/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"tenant_id":"vtea","login_identifier":"vtea","password":"A123456"}' \
)
if [ "$CODE" != "200" ]; then
  echo "verify-platform-login: expected HTTP 200, got $CODE" >&2
  cat "$OUT" >&2
  exit 1
fi
if ! grep -q '"tenant_id":"vtea"' "$OUT" && ! grep -q '"tenant_id": "vtea"' "$OUT"; then
  echo "verify-platform-login: response must contain tenant_id vtea" >&2
  cat "$OUT" >&2
  exit 1
fi
echo "verify-platform-login: ok (platform admin)"
