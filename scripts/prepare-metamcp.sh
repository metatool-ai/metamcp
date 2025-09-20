#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_DIR="${REPO_ROOT}/build/metamcp"
REPO_URL="${METAMCP_REPO_URL:-https://github.com/metatool-ai/metamcp.git}"
REF="${METAMCP_REF:-}" 

function latest_release_tag() {
  git ls-remote --tags --sort=-v:refname "${REPO_URL}" 'v*' \
    | grep -v '\^{}' \
    | head -n1 \
    | awk '{print $2}' \
    | sed 's@refs/tags/@@'
}

if [[ -z "${REF}" ]]; then
  REF="$(latest_release_tag)"
  if [[ -z "${REF}" ]]; then
    echo "Failed to resolve latest release tag" >&2
    exit 1
  fi
fi

echo "[prepare-metamcp] Using MetaMCP ref: ${REF}" 

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

echo "[prepare-metamcp] Cloning ${REPO_URL}#${REF}"
GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "${REF}" "${REPO_URL}" "${TARGET_DIR}"

echo "[prepare-metamcp] Applying Databricks overrides"
node "${REPO_ROOT}/scripts/apply-databricks-overrides.mjs" "${TARGET_DIR}"

copy_items=(
  "AGENTS.md"
  "databricks.yml"
  ".env.template"
  "scripts/databricks-build.mjs"
  "scripts/databricks-start.mjs"
  "scripts/metamcp-launch.sh"
  "scripts/bin/npm"
)

for item in "${copy_items[@]}"; do
  src="${REPO_ROOT}/${item}"
  dest="${TARGET_DIR}/${item}"
  if [[ -e "${src}" ]]; then
    mkdir -p "$(dirname "${dest}")"
    rm -rf "${dest}"
    cp -R "${src}" "${dest}"
  fi
done

echo "[prepare-metamcp] Prepared tree at ${TARGET_DIR}"
