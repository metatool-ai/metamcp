#!/bin/sh

set -e

echo "Starting MetaMCP development services..."

# Function to cleanup Docker containers and networks
cleanup_managed_containers() {
    echo "🧹 CLEANUP: Starting MetaMCP managed Docker resources cleanup..."
    
    # Check if Docker is available by probing docker info
    if docker info >/dev/null 2>&1; then
        echo "🧹 CLEANUP: Docker is available, proceeding with cleanup..."
        
        # Simple clean docker command - stop and remove containers
        echo "🧹 CLEANUP: Stopping and removing managed containers..."
        docker ps -a --filter "label=metamcp.managed=true" --format '{{.ID}}' \
            | xargs -r docker rm -f 2>/dev/null || echo "🧹 CLEANUP: Failed to remove some containers"
        
        echo "✅ CLEANUP: Cleaned up managed containers"
        
        # Remove networks
        NETWORKS=$(docker network ls --filter "label=metamcp.managed=true" --format "{{.ID}}" 2>/dev/null || true)
        if [ -n "$NETWORKS" ]; then
            echo "🧹 CLEANUP: Found managed networks to remove: $NETWORKS"
            for network in $NETWORKS; do
                echo "🧹 CLEANUP: Removing network $network"
                docker network rm "$network" 2>/dev/null || echo "🧹 CLEANUP: Failed to remove network $network"
            done
            echo "✅ CLEANUP: Cleaned up managed networks"
        else
            echo "🧹 CLEANUP: No managed networks found"
        fi
    else
        echo "⚠️  CLEANUP: Docker is not available (docker info failed), skipping container cleanup"
        echo "⚠️  CLEANUP: This may be due to rootless Docker, DOCKER_HOST not set, or Docker daemon not running"
    fi
    
    echo "🧹 CLEANUP: Cleanup process completed"
}

# Function to cleanup on exit
cleanup_on_exit() {
    echo "🛑 SHUTDOWN: Received shutdown signal, cleaning up..."
    echo "🛑 SHUTDOWN: Signal received at $(date)"
    
    # Kill the pnpm dev process
    if [ -n "$PNPM_PID" ]; then
        echo "🛑 SHUTDOWN: Killing pnpm dev process (PID: $PNPM_PID)"
        kill -TERM "$PNPM_PID" 2>/dev/null || true
    fi
    
    # Kill any other background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    echo "🛑 SHUTDOWN: Killed background processes"
    
    # Clean up managed containers
    echo "🛑 SHUTDOWN: Starting container cleanup..."
    cleanup_managed_containers
    
    echo "🛑 SHUTDOWN: Development services stopped"
    exit 0
}

# Setup cleanup trap for multiple signals
trap cleanup_on_exit TERM INT EXIT

# Initialize - clean up any existing managed containers
echo "🚀 INIT: Cleaning up any existing managed containers..."
cleanup_managed_containers

echo "Starting development servers with turborepo..."
echo "Backend will run on port 12009"
echo "Frontend will run on port 12008"

# Start the development servers with proper signal handling
echo "🚀 Starting pnpm dev..."
pnpm dev &
PNPM_PID=$!
echo "🚀 pnpm dev started with PID: $PNPM_PID"

# Wait for the pnpm dev process, but don't block cleanup
wait "$PNPM_PID" || true 