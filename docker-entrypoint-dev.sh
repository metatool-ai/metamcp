#!/bin/sh

set -e

echo "Starting MetaMCP development services..."

# Function to cleanup Docker containers and networks
cleanup_managed_containers() {
    echo "🧹 CLEANUP: Starting MetaMCP managed Docker resources cleanup..."
    
    # Only run if we have access to Docker socket
    if [ -S /var/run/docker.sock ]; then
        echo "🧹 CLEANUP: Docker socket found, proceeding with cleanup..."
        
        # Stop and remove containers - with better error handling
        CONTAINERS=$(docker ps -a --filter "label=metamcp.managed=true" --format "{{.ID}}" 2>/dev/null || true)
        if [ -n "$CONTAINERS" ]; then
            echo "🧹 CLEANUP: Found managed containers to remove: $CONTAINERS"
            
            # Stop containers
            echo "🧹 CLEANUP: Stopping managed containers..."
            for container in $CONTAINERS; do
                echo "🧹 CLEANUP: Stopping container $container"
                docker stop "$container" 2>/dev/null || echo "🧹 CLEANUP: Failed to stop container $container"
            done
            
            # Remove containers
            echo "🧹 CLEANUP: Removing managed containers..."
            for container in $CONTAINERS; do
                echo "🧹 CLEANUP: Removing container $container"
                docker rm "$container" 2>/dev/null || echo "🧹 CLEANUP: Failed to remove container $container"
            done
            
            echo "✅ CLEANUP: Cleaned up managed containers"
        else
            echo "🧹 CLEANUP: No managed containers found"
        fi
        
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
        echo "⚠️  CLEANUP: Docker socket not available, skipping container cleanup"
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