#!/bin/bash
set -e

# Parse MCP_ARGS from JSON array to space-separated string
if [ -n "$MCP_ARGS" ]; then
  ARGS=$(echo "$MCP_ARGS" | jq -r '.[]' 2>/dev/null | tr '\n' ' ')
else
  ARGS=""
fi

# Export environment variables from MCP_ENV_JSON
if [ -n "$MCP_ENV_JSON" ]; then
  for key in $(echo "$MCP_ENV_JSON" | jq -r 'keys[]' 2>/dev/null); do
    value=$(echo "$MCP_ENV_JSON" | jq -r --arg k "$key" '.[$k]')
    export "$key=$value"
  done
fi

if [ -z "$MCP_COMMAND" ]; then
  echo "ERROR: MCP_COMMAND environment variable is required"
  exit 1
fi

FULL_COMMAND="$MCP_COMMAND $ARGS"

echo "Starting supergateway with command: $FULL_COMMAND"

exec supergateway --stdio "$FULL_COMMAND" --outputTransport streamableHttp --stateful --port "${SUPERGATEWAY_PORT:-8000}" --healthEndpoint /healthz
