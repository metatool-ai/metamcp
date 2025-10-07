#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${REPO_ROOT}/build/metamcp"
sanitize_var() {
  local value="$1"
  if [[ -z "$value" ]]; then
    return 1
  fi
  if [[ "$value" =~ ^\$\{.*\}$ ]]; then
    return 1
  fi
  return 0
}

trim_whitespace() {
  local input="$1"
  input="${input#${input%%[![:space:]]*}}"
  input="${input%${input##*[![:space:]]}}"
  printf '%s' "$input"
}

strip_quotes() {
  local input="$1"
  if [[ ${#input} -ge 2 ]]; then
    local first="${input:0:1}"
    local last="${input: -1}"
    if [[ "$first" == "$last" && ( "$first" == '"' || "$first" == "'") ]]; then
      input="${input:1:${#input}-2}"
    fi
  fi
  printf '%s' "$input"
}

read_var_from_file() {
  local key="$1"
  local path="$2"
  if [[ ! -f "$path" ]]; then
    return 0
  fi
  local line name value result=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line%%#*}"
    line="$(trim_whitespace "$line")"
    [[ -z "$line" ]] && continue
    if [[ "$line" == export* ]]; then
      line="${line#export}"
      line="$(trim_whitespace "$line")"
    fi
    [[ "$line" == *=* ]] || continue
    name="${line%%=*}"
    value="${line#*=}"
    name="$(trim_whitespace "$name")"
    if [[ "$name" != "$key" ]]; then
      continue
    fi
    value="$(trim_whitespace "$value")"
    value="$(strip_quotes "$value")"
    result="$value"
  done <"$path"

  if sanitize_var "$result"; then
    printf '%s' "$result"
  fi
  return 0
}

REF="${METAMCP_REF:-}"
REPO_URL="${METAMCP_REPO_URL:-}"

if ! sanitize_var "${REF}"; then
  REF="$(read_var_from_file METAMCP_REF "${REPO_ROOT}/.env")"
fi
if ! sanitize_var "${REF}"; then
  REF="$(read_var_from_file METAMCP_REF "${REPO_ROOT}/.env.template")"
fi
if ! sanitize_var "${REF}"; then
  REF=""
fi

if ! sanitize_var "${REPO_URL}"; then
  REPO_URL="$(read_var_from_file METAMCP_REPO_URL "${REPO_ROOT}/.env")"
fi
if ! sanitize_var "${REPO_URL}"; then
  REPO_URL="$(read_var_from_file METAMCP_REPO_URL "${REPO_ROOT}/.env.template")"
fi
if ! sanitize_var "${REPO_URL}"; then
  REPO_URL="https://github.com/metatool-ai/metamcp.git"
fi

info() {
  printf '[prepare-metamcp] %s\n' "$1"
}

if [[ -z "${REF}" ]]; then
  info "METAMCP_REF not set; attempting to resolve latest release tag"
  REF=$(git ls-remote --tags --sort=-v:refname "${REPO_URL}" 'v*' | grep -v '\^{}' | head -n1 | awk '{print $2}' | sed 's@refs/tags/@@')
  if [[ -z "${REF}" ]]; then
    echo "[prepare-metamcp] Failed to resolve MetaMCP ref" >&2
    exit 1
  fi
fi

info "Using MetaMCP ref: ${REF}"

rm -rf "${BUILD_DIR}"
mkdir -p "${BUILD_DIR}"

info "Cloning ${REPO_URL}#${REF}"
GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch "${REF}" "${REPO_URL}" "${BUILD_DIR}"

info "Applying custom schema patches"
# Patch drizzle config to use custom schema
sed -i.bak 's/url: process\.env\.DATABASE_URL!,$/url: process.env.DATABASE_URL!,/' "${BUILD_DIR}/apps/backend/drizzle.config.ts"
sed -i.bak '/},$/a\
  schemaFilter: ["metamcp_app"],' "${BUILD_DIR}/apps/backend/drizzle.config.ts" && rm "${BUILD_DIR}/apps/backend/drizzle.config.ts.bak"

# Patch schema.ts to use custom schema
cd "${BUILD_DIR}/apps/backend/src/db"
sed -i.bak '/^  pgEnum,$/a\
  pgSchema,' schema.ts

sed -i.bak '/^} from "drizzle-orm\/pg-core";$/a\
\
// Define the custom schema\
export const metamcpSchema = pgSchema("metamcp_app");' schema.ts

sed -i.bak 's/export const mcpServerTypeEnum = pgEnum(/export const mcpServerTypeEnum = metamcpSchema.enum(/' schema.ts
sed -i.bak 's/export const mcpServerStatusEnum = pgEnum(/export const mcpServerStatusEnum = metamcpSchema.enum(/' schema.ts
sed -i.bak 's/= pgTable(/= metamcpSchema.table(/' schema.ts

rm schema.ts.bak
cd "${REPO_ROOT}"

# Patch existing migrations to use custom schema
info "Patching migration files to use custom schema"
find "${BUILD_DIR}/apps/backend/drizzle" -name "*.sql" -type f -exec sed -i.bak 's/"public"\./"metamcp_app"./g' {} \; -exec rm {}.bak \;

info "Applying Databricks overrides"
node "${REPO_ROOT}/scripts/apply-databricks-overrides.mjs" "${BUILD_DIR}"

export METAMCP_REF="${REF}"
export METAMCP_REPO_URL="${REPO_URL}"

info "Rendering Databricks app config"
node "${REPO_ROOT}/scripts/render-app-config.mjs" "${BUILD_DIR}"

if [[ -f "${REPO_ROOT}/AGENTS.md" ]]; then
  cp -f "${REPO_ROOT}/AGENTS.md" "${BUILD_DIR}/"
fi

cp -f "${REPO_ROOT}/databricks.yml" "${BUILD_DIR}/"
mkdir -p "${BUILD_DIR}/scripts"
cp -rf "${REPO_ROOT}/scripts/databricks-"*.mjs "${BUILD_DIR}/scripts/"
cp -rf "${REPO_ROOT}/scripts/bin" "${BUILD_DIR}/scripts/"

cat > "${BUILD_DIR}/.databricksignore" <<'EOL'
node_modules/
.pnpm-store/
apps/*/node_modules/
packages/*/node_modules/
**/*.log
EOL

info "Prepared tree at ${BUILD_DIR}"
