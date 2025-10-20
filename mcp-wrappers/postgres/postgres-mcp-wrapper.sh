#!/usr/bin/env bash
set -eE

# PostgreSQL MCP Wrapper for Azure Database
# This wrapper handles Azure authentication and SSH tunneling for PostgreSQL MCP servers
# 
# Environment Variables Required:
# - AZURE_TENANT_ID: Azure tenant ID
# - AZURE_CLIENT_ID: Azure client ID (optional, for service principal)
# - AZURE_CLIENT_SECRET: Azure client secret (optional, for service principal)
# - POSTGRES_HOST: PostgreSQL host (default: localhost)
# - POSTGRES_PORT: PostgreSQL port (default: 5432)
# - POSTGRES_USER: PostgreSQL username
# - POSTGRES_DB: PostgreSQL database name
# - BASTION_HOST: SSH bastion host for tunneling (optional)
# - BASTION_USER: SSH bastion username (optional)
# - BASTION_PORT: SSH bastion port (default: 22)

# Default values
POSTGRES_HOST=${POSTGRES_HOST:-localhost}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
BASTION_PORT=${BASTION_PORT:-22}

# Check if required environment variables are set
if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_DB" ]; then
    echo "Error: POSTGRES_USER and POSTGRES_DB environment variables are required" >&2
    exit 1
fi

# Azure authentication - prefer pre-provided token
if [ -n "$AZURE_ACCESS_TOKEN" ]; then
    echo "Using provided Azure access token..." >&2
    DB_PASSWORD="$AZURE_ACCESS_TOKEN"
elif [ -n "$AZURE_CLIENT_ID" ] && [ -n "$AZURE_CLIENT_SECRET" ]; then
    # Service principal authentication
    echo "Authenticating with Azure using service principal..." >&2
    if ! command -v az &> /dev/null; then
        echo "Error: Azure CLI (az) not installed. Install it from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" >&2
        exit 1
    fi
    az login --service-principal --username "$AZURE_CLIENT_ID" --password "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID" >/dev/null 2>&1
    DB_PASSWORD=$(az account get-access-token --resource-type oss-rdbms -o tsv 2>/dev/null | awk '{ print $1 }')
else
    # Check if Azure CLI is available for interactive authentication
    if command -v az &> /dev/null; then
        echo "Checking Azure authentication..." >&2
        if az account show >/dev/null 2>&1; then
            echo "Getting Azure access token..." >&2
            DB_PASSWORD=$(az account get-access-token --resource-type oss-rdbms -o tsv 2>/dev/null | awk '{ print $1 }')
        else
            echo "Error: Please run 'az login' locally and set AZURE_ACCESS_TOKEN environment variable" >&2
            echo "Or provide AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, and AZURE_TENANT_ID for service principal auth" >&2
            exit 1
        fi
    else
        echo "Error: Azure CLI not available. Please provide AZURE_ACCESS_TOKEN environment variable" >&2
        echo "Get the token by running: az account get-access-token --resource-type oss-rdbms -o tsv" >&2
        exit 1
    fi
fi

if [ -z "$DB_PASSWORD" ]; then
    echo "Error: Failed to get Azure access token. Please check your Azure permissions." >&2
    exit 1
fi

# Function to check if SSH tunnel is already running
check_tunnel() {
    if lsof -i :$POSTGRES_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0  # Tunnel exists
    else
        return 1  # No tunnel
    fi
}

# Create SSH tunnel via bastion if configured
if [ -n "$BASTION_HOST" ] && [ -n "$BASTION_USER" ]; then
    if ! check_tunnel; then
        echo "Creating SSH tunnel through bastion ($BASTION_USER@$BASTION_HOST:$BASTION_PORT)..." >&2
        ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
            $BASTION_USER@$BASTION_HOST -p $BASTION_PORT \
            -N -C -L "$POSTGRES_PORT:$POSTGRES_HOST:$POSTGRES_PORT" -f
        sleep 2  # Give tunnel time to establish
    else
        echo "SSH tunnel already active on port $POSTGRES_PORT" >&2
    fi
    # Use localhost when tunneling
    DB_HOST="localhost"
else
    # Direct connection
    DB_HOST="$POSTGRES_HOST"
fi

# PostgreSQL connection URL
if [ -n "$BASTION_HOST" ] || [ "$DB_HOST" = "host.docker.internal" ]; then
    # SSL through tunnel or local tunnel (no hostname verification)
    # Use no-verify because hostname (localhost or host.docker.internal) won't match certificate (ox-stg-db-2.postgres.database.azure.com)
    export POSTGRES_URL="postgresql://${POSTGRES_USER}:${DB_PASSWORD}@${DB_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=no-verify"
    export NODE_TLS_REJECT_UNAUTHORIZED="0"
else
    # Direct connection with full SSL verification
    export POSTGRES_URL="postgresql://${POSTGRES_USER}:${DB_PASSWORD}@${DB_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=require"
fi

# Debug output
echo "DEBUG: Connecting to ${DB_HOST}:${POSTGRES_PORT}" >&2
echo "DEBUG: Database: ${POSTGRES_DB}, User: ${POSTGRES_USER}" >&2
echo "DEBUG: NODE_TLS_REJECT_UNAUTHORIZED=${NODE_TLS_REJECT_UNAUTHORIZED}" >&2
if [ -n "$BASTION_HOST" ]; then
    echo "DEBUG: Using SSH tunnel through $BASTION_HOST" >&2
fi

# Run the PostgreSQL MCP server
echo "Starting PostgreSQL MCP server..." >&2
exec npx -y @modelcontextprotocol/server-postgres "$POSTGRES_URL"
