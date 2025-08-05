#!/bin/bash

set -e

# Get the MCP server command from environment
MCP_SERVER_COMMAND=${MCP_SERVER_COMMAND:-}

# Get the MCP server arguments from environment
MCP_SERVER_ARGS=${MCP_SERVER_ARGS:-"[]"}

# Get the MCP server environment variables from environment
MCP_SERVER_ENV=${MCP_SERVER_ENV:-"{}"}

# Execute the MCP server using mcp-proxy (Python version)
if [[ -n "$MCP_SERVER_COMMAND" ]]; then
    echo "Starting MCP server with mcp-proxy: $MCP_SERVER_COMMAND"
    
    # Parse the arguments JSON array
    if [[ "$MCP_SERVER_ARGS" != "[]" ]]; then
        # Use jq to parse the JSON array and join with spaces
        ARGS_STRING=$(echo "$MCP_SERVER_ARGS" | jq -r 'join(" ")')
        echo "MCP server arguments: $ARGS_STRING"
        FULL_COMMAND="$MCP_SERVER_COMMAND $ARGS_STRING"
    else
        FULL_COMMAND="$MCP_SERVER_COMMAND"
    fi
    
    echo "Full command: $FULL_COMMAND"
    
    # Parse and set environment variables if provided
    if [[ "$MCP_SERVER_ENV" != "{}" ]]; then
        echo "Setting MCP server environment variables..."
        # Use jq to extract key-value pairs and export them
        while IFS= read -r line; do
            if [[ -n "$line" ]]; then
                export "$line"
                echo "Set env: $line"
            fi
        done < <(echo "$MCP_SERVER_ENV" | jq -r 'to_entries | .[] | "\(.key)=\(.value)"')
    fi
    
    # Use mcp-proxy with options to run the MCP server
    # --port 3000: Listen on port 3000 (matches Dockerfile health check)
    # --host 0.0.0.0: Listen on all interfaces
    # --debug: Enable debug logging for troubleshooting
    # --pass-environment: Pass through all environment variables
    exec mcp-proxy --port 3000 --host 0.0.0.0 --debug --pass-environment "$FULL_COMMAND"
else
    echo "No MCP_SERVER_COMMAND provided"
    exit 1
fi