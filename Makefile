ifneq (,$(wildcard .env))
include .env
export $(shell sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p' .env)
endif

TARGET ?= dev
APP_NAME ?= metamcp-app
DBX_USER ?=
BUNDLE_PATH ?= /Workspace/Users/$(DBX_USER)/.bundle/metamcp-databricks/$(TARGET)/files
DBX_HOST ?=

.PHONY: install build bundle-deploy app-deploy app-status

install:
	npm install

build:
	npm run build

bundle-deploy:
	databricks bundle deploy --target $(TARGET)

app-deploy:
	@if [ -z "$(DBX_USER)" ]; then \
		echo "DBX_USER is not set. Export your Databricks username (e.g. user@example.com)"; \
		exit 1; \
	fi
	databricks apps deploy $(APP_NAME) --mode SNAPSHOT --source-code-path $(BUNDLE_PATH)

app-status:
	databricks apps get $(APP_NAME)

.PHONY: app-logs app-health

app-logs:
	@if [ -z "$(DBX_HOST)" ]; then \
		echo "DBX_HOST is not set. Copy .env.template to .env and fill in workspace host"; \
		exit 1; \
	fi
	databricks apps list-deployments $(APP_NAME)
	databricks apps get $(APP_NAME)
	ACCESS_TOKEN=$$(databricks auth token --host $(DBX_HOST) --output json | jq -r .access_token); \
	curl -s -N -H "Authorization: Bearer $$ACCESS_TOKEN" "https://$$(databricks apps get $(APP_NAME) --output json | jq -r .url | sed 's/^https:\/\///')/logz/stream" | head

app-health:
	@if [ -z "$(DBX_HOST)" ]; then \
		echo "DBX_HOST is not set. Copy .env.template to .env and fill in workspace host"; \
		exit 1; \
	fi
	ACCESS_TOKEN=$$(databricks auth token --host $(DBX_HOST) --output json | jq -r .access_token); \
	curl -s -H "Authorization: Bearer $$ACCESS_TOKEN" "https://$$(databricks apps get $(APP_NAME) --output json | jq -r .url | sed 's/^https:\/\///')/api/health" | jq .
