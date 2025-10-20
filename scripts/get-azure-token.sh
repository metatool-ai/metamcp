#!/usr/bin/env bash
set -eE

# Script to get Azure access token for PostgreSQL MCP
# This script should be run locally (not in the container)

echo "Getting Azure access token for PostgreSQL..."

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI (az) not installed. Install it from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli" >&2
    exit 1
fi

# Check if already logged in
if ! az account show >/dev/null 2>&1; then
    echo "Please run 'az login' first to authenticate with Azure"
    exit 1
fi

# Get the access token
TOKEN=$(az account get-access-token --resource-type oss-rdbms -o tsv | awk '{ print $1 }')

if [ -z "$TOKEN" ]; then
    echo "Error: Failed to get Azure access token" >&2
    exit 1
fi

echo "Azure access token obtained successfully!"
echo ""
echo "Add this to your .env file:"
echo "AZURE_ACCESS_TOKEN=$TOKEN"
echo ""
echo "Or set it as an environment variable:"
echo "export AZURE_ACCESS_TOKEN=$TOKEN"
echo ""
echo "Token expires in 1 hour. Run this script again to get a new token."
