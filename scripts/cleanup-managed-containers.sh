#!/bin/bash

# Script to clean up MetaMCP managed Docker containers and networks
# This can be run from the host system

set -e

echo "Cleaning up MetaMCP managed Docker resources..."

# Stop and remove containers
CONTAINERS=$(docker ps -a --filter "label=metamcp.managed=true" --format "{{.ID}}" 2>/dev/null || true)
if [ -n "$CONTAINERS" ]; then
    echo "Stopping and removing managed containers..."
    echo "$CONTAINERS" | xargs -r docker stop 2>/dev/null || true
    echo "$CONTAINERS" | xargs -r docker rm 2>/dev/null || true
    echo "✅ Cleaned up managed containers"
else
    echo "No managed containers found"
fi

# Remove networks
NETWORKS=$(docker network ls --filter "label=metamcp.managed=true" --format "{{.ID}}" 2>/dev/null || true)
if [ -n "$NETWORKS" ]; then
    echo "Removing managed networks..."
    echo "$NETWORKS" | xargs -r docker network rm 2>/dev/null || true
    echo "✅ Cleaned up managed networks"
else
    echo "No managed networks found"
fi

echo "Cleanup completed!" 