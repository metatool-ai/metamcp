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
