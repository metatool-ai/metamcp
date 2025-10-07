# MetaMCP on Databricks - Simplified Makefile
# Run 'make' to deploy to production, 'make dev' for development

# Load environment variables if .env exists
-include .env
export

# Configuration sourced from .env/.env.template
REQUIRED_ENV_VARS = METAMCP_REPO_URL METAMCP_REF APP_NAME DATABRICKS_CONFIG_PROFILE
CHECK_ENV_TARGETS := $(if $(MAKECMDGOALS),$(filter-out help,$(MAKECMDGOALS)),default)

ifeq ($(CHECK_ENV_TARGETS),)
# Skip env validation when only asking for help
else
MISSING_ENV_VARS := $(strip $(foreach var,$(REQUIRED_ENV_VARS),$(if $($(var)),,$(var))))
ifneq ($(MISSING_ENV_VARS),)
$(error Missing required environment variables: $(MISSING_ENV_VARS). Copy .env.template to .env and configure it.)
endif
endif

TARGET ?= prod

APP_NAME_BASE := $(strip $(if $(APP_NAME),$(APP_NAME),metamcp))
LAKEBASE_INSTANCE_NAME_BASE := $(strip $(if $(LAKEBASE_INSTANCE_NAME),$(LAKEBASE_INSTANCE_NAME),metamcp-lakebase))
LAKEBASE_DATABASE_NAME_BASE := $(strip $(if $(LAKEBASE_DATABASE_NAME),$(LAKEBASE_DATABASE_NAME),metamcp_app))

override APP_NAME = $(if $(filter dev,$(TARGET)),$(if $(filter dev-%,$(APP_NAME_BASE)),$(APP_NAME_BASE),dev-$(APP_NAME_BASE)),$(APP_NAME_BASE))
override LAKEBASE_INSTANCE_NAME = $(if $(filter dev,$(TARGET)),$(if $(filter dev-%,$(LAKEBASE_INSTANCE_NAME_BASE)),$(LAKEBASE_INSTANCE_NAME_BASE),dev-$(LAKEBASE_INSTANCE_NAME_BASE)),$(LAKEBASE_INSTANCE_NAME_BASE))
override LAKEBASE_DATABASE_NAME = $(if $(filter dev,$(TARGET)),$(if $(filter dev_%,$(LAKEBASE_DATABASE_NAME_BASE)),$(LAKEBASE_DATABASE_NAME_BASE),dev_$(LAKEBASE_DATABASE_NAME_BASE)),$(LAKEBASE_DATABASE_NAME_BASE))

BUILD_DIR = build/metamcp
BUNDLE_VARS = --var app_name=$(APP_NAME) --var lakebase_instance_name=$(LAKEBASE_INSTANCE_NAME) --var lakebase_database_name=$(LAKEBASE_DATABASE_NAME)

# Default target: deploy to production
.DEFAULT_GOAL := deploy

# Main deployment targets
.PHONY: deploy dev prod dev-delete

# Deploy to production (default)
deploy: TARGET=prod
deploy: _deploy_app health

# Deploy to development
dev: TARGET=dev
dev: _deploy_app health

# Delete development deployment
.PHONY: dev-delete
dev-delete: TARGET=dev
dev-delete: _check_auth
	@echo "🗑️ Deleting MetaMCP dev deployment..."
	@databricks apps delete $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE) || \
		echo "ℹ️ Dev app $(APP_NAME) not found; skipping delete"
	@databricks bundle destroy --target $(TARGET) --profile $(DATABRICKS_CONFIG_PROFILE) --auto-approve || \
		echo "ℹ️ No bundle resources found for $(TARGET); skipping destroy"
	@echo "✅ Dev environment cleaned up."

# Alias for production
prod: deploy

# Internal deployment target
.PHONY: _deploy_app
_deploy_app: _check_auth test
	@echo "🚀 Deploying MetaMCP to $(TARGET) environment..."
	@BETTER_AUTH_SECRET="$(BETTER_AUTH_SECRET)" \
	METAMCP_REPO_URL="$(METAMCP_REPO_URL)" \
	METAMCP_REF="$(METAMCP_REF)" \
		databricks bundle deploy --target $(TARGET) --profile $(DATABRICKS_CONFIG_PROFILE) $(BUNDLE_VARS)
	@BUNDLE_PATH=$$(BETTER_AUTH_SECRET="$(BETTER_AUTH_SECRET)" \
		METAMCP_REPO_URL="$(METAMCP_REPO_URL)" \
		METAMCP_REF="$(METAMCP_REF)" \
		databricks bundle summary --target $(TARGET) --profile $(DATABRICKS_CONFIG_PROFILE) $(BUNDLE_VARS) --output json | jq -r '.workspace.file_path'); \
	if ! databricks apps deploy $(APP_NAME) --mode SNAPSHOT --source-code-path $$BUNDLE_PATH --profile $(DATABRICKS_CONFIG_PROFILE); then \
		echo "⚠️ apps deploy reported an active deployment, attempting databricks apps start"; \
		databricks apps start $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE); \
	fi
	@echo "✅ Deployment complete!"

# Build target (combines prepare and build)
.PHONY: _build
_build: _prepare
	@echo "🔨 Building MetaMCP..."
	@APP_URL_VALUE=$${APP_URL:-http://localhost:12008}; \
	NEXT_PUBLIC_APP_URL_VALUE=$${NEXT_PUBLIC_APP_URL:-$$APP_URL_VALUE}; \
	APP_URL=$$APP_URL_VALUE NEXT_PUBLIC_APP_URL=$$NEXT_PUBLIC_APP_URL_VALUE \
		node $(BUILD_DIR)/scripts/databricks-build.mjs

# Prepare MetaMCP source
.PHONY: _prepare
_prepare:
	@echo "📦 Preparing MetaMCP $(METAMCP_REF)..."
	@rm -rf $(BUILD_DIR)
	@mkdir -p $(BUILD_DIR)
	@# Clone the repository
	@GIT_TERMINAL_PROMPT=0 git clone --depth 1 --branch $(METAMCP_REF) $(METAMCP_REPO_URL) $(BUILD_DIR)
	@# Apply overrides
	@node scripts/apply-databricks-overrides.mjs $(BUILD_DIR)
	@# Copy Databricks-specific files
	@cp -f databricks.yml $(BUILD_DIR)/
	@node scripts/render-app-config.mjs $(BUILD_DIR)
	@cp -f AGENTS.md $(BUILD_DIR)/ 2>/dev/null || true
	@mkdir -p $(BUILD_DIR)/scripts
	@cp -rf scripts/databricks-*.mjs $(BUILD_DIR)/scripts/
	@cp -rf scripts/bin $(BUILD_DIR)/scripts/
	@# Create .databricksignore
	@echo "node_modules/" > $(BUILD_DIR)/.databricksignore
	@echo ".pnpm-store/" >> $(BUILD_DIR)/.databricksignore
	@echo "apps/*/node_modules/" >> $(BUILD_DIR)/.databricksignore
	@echo "packages/*/node_modules/" >> $(BUILD_DIR)/.databricksignore
	@echo "**/*.log" >> $(BUILD_DIR)/.databricksignore

# Check authentication
.PHONY: _check_auth
_check_auth:
	@databricks auth token --profile $(DATABRICKS_CONFIG_PROFILE) >/dev/null 2>&1 || \
		(echo "❌ Not authenticated. Run: databricks auth login --profile $(DATABRICKS_CONFIG_PROFILE)" && exit 1)

# Operational commands
.PHONY: status logs health clean test

test: _build
	@echo "🧪 Running local validation checks..."
	@node scripts/check-app-config.mjs $(BUILD_DIR)/app.yaml
	@BETTER_AUTH_SECRET="$(BETTER_AUTH_SECRET)" \
		METAMCP_REPO_URL="$(METAMCP_REPO_URL)" \
		METAMCP_REF="$(METAMCP_REF)" \
		databricks bundle validate --target $(TARGET) --profile $(DATABRICKS_CONFIG_PROFILE) $(BUNDLE_VARS)
	@echo "✅ Local validation passed."

status:
	@databricks apps get $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE) | jq -r '. | "App: \(.name)\nStatus: \(.status)\nURL: \(.url)"'

logs:
	@APP_URL=$$(databricks apps get $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .url); \
	ACCESS_TOKEN=$$(databricks auth token --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .access_token); \
	curl -s -N -H "Authorization: Bearer $$ACCESS_TOKEN" "$$APP_URL/logz/stream"

health:
	@APP_URL=$$(databricks apps get $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .url); \
	ACCESS_TOKEN=$$(databricks auth token --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .access_token); \
	STATUS=$$(curl -s -w '\n%{http_code}' -H "Authorization: Bearer $$ACCESS_TOKEN" "$$APP_URL/metamcp/health" | tail -1); \
	if [ "$$STATUS" = "200" ]; then \
		echo "✅ Health check passed (HTTP 200)"; \
	else \
		echo "❌ Health check failed (HTTP $$STATUS)"; \
		exit 1; \
	fi

clean:
	@echo "🧹 Cleaning build directory..."
	@rm -rf build/metamcp

# Help command
.PHONY: help
help:
	@echo "MetaMCP on Databricks - Deployment Commands"
	@echo ""
	@echo "Main commands:"
	@echo "  make         Deploy to production (default)"
	@echo "  make dev     Deploy to development"
	@echo "  make test    Run local preflight checks"
	@echo ""
	@echo "Operations:"
	@echo "  make dev-delete Remove dev app and bundle"
	@echo "  make status  Show app status"
	@echo "  make logs    Stream app logs"
	@echo "  make health  Check app health"
	@echo "  make clean   Remove build artifacts"
	@echo ""
	@echo "Configuration:"
	@echo "  METAMCP_REPO_URL=$(METAMCP_REPO_URL)"
	@echo "  METAMCP_REF=$(METAMCP_REF)"
	@echo "  APP_NAME=$(APP_NAME)"
	@echo "  DATABRICKS_CONFIG_PROFILE=$(DATABRICKS_CONFIG_PROFILE)"
