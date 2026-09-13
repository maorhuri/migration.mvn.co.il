#!/usr/bin/env bash
# Manual deploy: same steps as .github/workflows/deploy.yml, run from your machine.
#   ./scripts/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:-2.28.68.194}"
USER_="${DEPLOY_USER:-root}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/migration_deploy_key}"
DIR="${DEPLOY_DIR:-/opt/migration-tool}"

ssh -i "$KEY" "$USER_@$HOST" bash -s <<REMOTE
  set -euo pipefail
  cd "$DIR"
  git pull --ff-only
  git log -1 --oneline
  cd docker
  docker compose --env-file ../.env build --quiet
  docker compose --env-file ../.env up -d
  docker compose --env-file ../.env ps
REMOTE

echo "health:"; curl -fsS "http://$HOST:8080/api/v1/health"; echo
