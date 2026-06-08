#!/usr/bin/env bash
# Ensure deploy/docker-compose/.env exists (gitignored); seed from .env.example.
#
# Usage:
#   scripts/ensure-compose-env.sh                 # copy .env.example if missing
#   scripts/ensure-compose-env.sh internal-deps   # ensure scene B hostnames for compose deps profile

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_DIR="$REPO_ROOT/deploy/docker-compose"
ENV_FILE="$ENV_DIR/.env"
EXAMPLE="$ENV_DIR/.env.example"
MODE="${1:-}"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ ! -f "$EXAMPLE" ]]; then
    echo "[fatal] missing $EXAMPLE" >&2
    exit 1
  fi
  cp "$EXAMPLE" "$ENV_FILE"
  echo "[ensure-compose-env] created $ENV_FILE from .env.example"
fi

if [[ "$MODE" == "internal-deps" ]]; then
  # Scene B — ai-center container talks to deps via compose service names.
  if grep -q '^MYSQL_HOST=host.docker.internal' "$ENV_FILE" 2>/dev/null; then
    sed -i.bak \
      -e 's/^MYSQL_HOST=host.docker.internal/MYSQL_HOST=mysql/' \
      -e 's|^REDIS_URL=redis://host.docker.internal:6379/0|REDIS_URL=redis://redis:6379/0|' \
      -e 's|^QDRANT_URL=http://host.docker.internal:6333|QDRANT_URL=http://qdrant:6333|' \
      "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    echo "[ensure-compose-env] switched .env to internal-deps (mysql/redis/qdrant service names)"
  fi
fi
