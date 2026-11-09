#!/usr/bin/env bash
# Fetch District from this machine and push the result, as an alternative to the
# self-hosted GitHub runner (.github/workflows/refresh-primary.yml). Uses your own git credentials.
#
#   scripts/refresh-primary-local.sh            # fetch, validate, commit, push
#   DRY_RUN=1 scripts/refresh-primary-local.sh  # fetch and validate only; nothing is committed or pushed
set -euo pipefail

cd "$(dirname "$0")/.."
BRANCH="${BRANCH:-main}"

if [ -n "$(git status --porcelain)" ]; then
  echo "Working tree has uncommitted changes; commit or stash them first." >&2
  exit 1
fi

git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --rebase origin "$BRANCH"

npm ci --no-audit --no-fund
npm test
INGEST_ONLY=district npm run ingest
npm run validate:data

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "DRY_RUN=1: leaving data/ changes uncommitted."
  exit 0
fi

if git diff --quiet -- data/; then
  echo "No event changes"
  exit 0
fi
git add data/
git commit -m "data: refresh primary sources"
git pull --rebase origin "$BRANCH"
git push origin "$BRANCH"
