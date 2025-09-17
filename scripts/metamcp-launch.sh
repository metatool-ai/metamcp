#!/bin/bash
set -euo pipefail

# Determine repository root based on this script location
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$REPO_ROOT"
export COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-metamcp}
export PATH="/usr/local/bin:/usr/bin:/bin:/Applications/Docker.app/Contents/Resources/bin"

exec /usr/local/bin/docker compose up
