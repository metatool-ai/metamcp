TARGET ?= dev
APP_NAME ?= metamcp-app
DBX_USER ?=
BUNDLE_PATH ?= /Workspace/Users/$(DBX_USER)/.bundle/metamcp-databricks/$(TARGET)/files

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
	@if [ -z "$(DBX_USER)" ]; then \
		echo "DBX_USER is not set. Export your Databricks username"; \
		exit 1; \
	fi
	databricks apps get $(APP_NAME) --output json | jq -r '.active_deployment.deployment_id' | \
		sed '/^null$$/d' | tail -n 1 | xargs -I{} databricks workspace export --format AUTO --file /tmp/metamcp-deployment.json /Workspace/Users/$(DBX_USER)/.bundle/metamcp-databricks/$(TARGET)/state/deployment.json >/dev/null 2>&1; \
	databricks apps list-deployments $(APP_NAME)
	databricks apps get $(APP_NAME)
	ACCESS_TOKEN=$$(databricks auth token --output json | jq -r .access_token); \
	curl -s -H "Authorization: Bearer $$ACCESS_TOKEN" "https://$$(databricks apps get $(APP_NAME) --output json | jq -r .url | sed 's/^https:\/\///')/logz/stream" | head

app-health:
	ACCESS_TOKEN=$$(databricks auth token --output json | jq -r .access_token); \
	curl -s -H "Authorization: Bearer $$ACCESS_TOKEN" "https://$$(databricks apps get $(APP_NAME) --output json | jq -r .url | sed 's/^https:\/\///')/api/health" | jq .
