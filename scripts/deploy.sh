#!/usr/bin/env bash
#
# VPS deploy: pull code → install → build → PM2 reload → health check
#
# Usage:
#   ./scripts/deploy.sh
#   DEPLOY_BRANCH=main ./scripts/deploy.sh
#   DEPLOY_FLUSH_LOGS=1 ./scripts/deploy.sh
#   DEPLOY_DB_PUSH=1 ./scripts/deploy.sh   # only when schema changed
#   DEPLOY_SKIP_PULL=1 ./scripts/deploy.sh
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${ROOT_DIR}/backend"
BRANCH="${DEPLOY_BRANCH:-develop}"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:3000/health}"
HEALTH_RETRIES="${DEPLOY_HEALTH_RETRIES:-12}"
HEALTH_SLEEP="${DEPLOY_HEALTH_SLEEP:-2}"

log() { printf '%s %s\n' "$(date -u +'%H:%M:%S')" "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing command: $1"
}

wait_for_health() {
  local i code
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || echo 000)"
    if [[ "$code" == "200" ]]; then
      log "Health OK ($HEALTH_URL)"
      return 0
    fi
    log "Health wait $i/$HEALTH_RETRIES (HTTP $code)..."
    sleep "$HEALTH_SLEEP"
  done
  die "Health check failed after $HEALTH_RETRIES attempts ($HEALTH_URL)"
}

main() {
  require_cmd git
  require_cmd npm
  require_cmd pm2
  require_cmd curl

  log "Deploy backend (branch: $BRANCH)"

  cd "$ROOT_DIR"

  if [[ "${DEPLOY_SKIP_PULL:-0}" != "1" ]]; then
    if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
      log "WARN: Working tree has local changes (deploy continues)"
    fi
    log "Pull latest code..."
    git fetch origin "$BRANCH"
    git checkout "$BRANCH" 2>/dev/null || true
    git pull --ff-only origin "$BRANCH"
  else
    log "Skip git pull (DEPLOY_SKIP_PULL=1)"
  fi

  local commit
  commit="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
  log "Commit: $commit ($(git log -1 --format='%s' 2>/dev/null || echo '?'))"

  [[ -f "${BACKEND_DIR}/.env" ]] || die "Missing ${BACKEND_DIR}/.env"
  [[ -f "${BACKEND_DIR}/ecosystem.config.cjs" ]] || die "Missing ecosystem.config.cjs"

  cd "$BACKEND_DIR"

  if [[ "${DEPLOY_FLUSH_LOGS:-0}" == "1" ]]; then
    log "Flush PM2 logs..."
    pm2 flush || true
  fi

  log "Install dependencies..."
  # NODE_ENV=production on VPS skips devDependencies; TypeScript is required for build.
  if [[ -f package-lock.json ]]; then
    npm ci --include=dev
  else
    npm install --include=dev
  fi

  if [[ "${DEPLOY_DB_PUSH:-0}" == "1" ]]; then
    log "Prisma db push..."
    npx prisma db push
  fi

  log "Build..."
  rm -rf dist
  npm run build

  log "PM2 start (re-read backend/.env; reload does not refresh env_file)..."
  if pm2 describe crypto-api >/dev/null 2>&1; then
    pm2 delete ecosystem.config.cjs || true
  fi
  pm2 start ecosystem.config.cjs
  pm2 save

  wait_for_health

  log "PM2 status:"
  pm2 status

  log "Recent worker log (non-blocking):"
  pm2 logs crypto-worker --lines 20 --nostream 2>/dev/null || true

  log "Deploy complete (commit $commit)"
}

main "$@"
