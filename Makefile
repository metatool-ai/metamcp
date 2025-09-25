ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

METAMCP_REF ?=
METAMCP_REPO_URL ?= https://github.com/metatool-ai/metamcp.git
BUNDLE_DIR ?= build/metamcp
TARGET ?= dev
APP_NAME ?= metamcp-app
DATABRICKS_CONFIG_PROFILE ?= DEFAULT

.PHONY: prepare build clean bundle-deploy app-deploy app-status app-logs app-health

prepare:
	METAMCP_REF=$(METAMCP_REF) METAMCP_REPO_URL=$(METAMCP_REPO_URL) ./scripts/prepare-metamcp.sh

build: prepare
	NODE_ENV= node $(BUNDLE_DIR)/scripts/databricks-build.mjs

clean:
	rm -rf $(BUNDLE_DIR)

bundle-deploy: build
	databricks bundle deploy --target $(TARGET) --profile $(DATABRICKS_CONFIG_PROFILE)

app-deploy:
	BUNDLE_PATH=$$(databricks bundle summary --target $(TARGET) --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r '.workspace.file_path'); \
	if [ -z "$$BUNDLE_PATH" ] || [ "$$BUNDLE_PATH" = "null" ]; then \
		echo "Unable to resolve bundle workspace path. Run 'make bundle-deploy' first."; \
		exit 1; \
	fi; \
	databricks apps deploy $(APP_NAME) --mode SNAPSHOT --source-code-path $$BUNDLE_PATH --profile $(DATABRICKS_CONFIG_PROFILE)

app-status:
	databricks apps get $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE)

app-logs:
	APP_URL=$$(databricks apps get $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .url); \
	ACCESS_TOKEN=$$(databricks auth token --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .access_token); \
	curl -s -N -H "Authorization: Bearer $$ACCESS_TOKEN" "$$APP_URL/logz/stream" | head

app-health:
	APP_URL=$$(databricks apps get $(APP_NAME) --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .url); \
	ACCESS_TOKEN=$$(databricks auth token --profile $(DATABRICKS_CONFIG_PROFILE) --output json | jq -r .access_token); \
	curl -s -w '\nHTTP_STATUS:%{http_code}\n' -H "Authorization: Bearer $$ACCESS_TOKEN" "$$APP_URL/metamcp/health"
