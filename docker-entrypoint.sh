#!/bin/sh

set -e

echo "Starting MetaMCP production services..."

# Function to wait for postgres
wait_for_postgres() {
    echo "Waiting for PostgreSQL to be ready..."
    until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER"; do
        echo "PostgreSQL is not ready - sleeping 2 seconds"
        sleep 2
    done
    echo "PostgreSQL is ready!"
}

# Function to run migrations
run_migrations() {
    echo "Running database migrations..."
    cd /app/apps/backend
    
    # Check if migrations need to be run
    if [ -d "drizzle" ] && [ "$(ls -A drizzle/*.sql 2>/dev/null)" ]; then
        echo "Found migration files, running migrations..."
        # Use local drizzle-kit since env vars are available at system level in Docker
        if pnpm exec drizzle-kit migrate; then
            echo "Migrations completed successfully!"
        else
            echo "❌ Migration failed! Exiting..."
            exit 1
        fi
    else
        echo "No migrations found or directory empty"
    fi
    
    cd /app
}

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
    
    # Kill the backend process
    if [ -n "$BACKEND_PID" ]; then
        echo "🛑 SHUTDOWN: Killing backend process (PID: $BACKEND_PID)"
        kill -TERM "$BACKEND_PID" 2>/dev/null || true
    fi
    
    # Kill the frontend process
    if [ -n "$FRONTEND_PID" ]; then
        echo "🛑 SHUTDOWN: Killing frontend process (PID: $FRONTEND_PID)"
        kill -TERM "$FRONTEND_PID" 2>/dev/null || true
    fi
    
    # Kill any other background processes
    jobs -p | xargs -r kill 2>/dev/null || true
    echo "🛑 SHUTDOWN: Killed background processes"
    
    # Wait for processes to terminate gracefully
    if [ -n "$BACKEND_PID" ]; then
        wait "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        wait "$FRONTEND_PID" 2>/dev/null || true
    fi
    
    # Clean up managed containers
    echo "🛑 SHUTDOWN: Starting container cleanup..."
    cleanup_managed_containers
    
    echo "🛑 SHUTDOWN: Production services stopped"
    exit 0
}

# Setup cleanup trap for multiple signals
trap cleanup_on_exit TERM INT EXIT

# Initialize - clean up any existing managed containers
echo "🚀 INIT: Cleaning up any existing managed containers..."
cleanup_managed_containers

# Set default values for postgres connection if not provided
POSTGRES_HOST=${POSTGRES_HOST:-postgres}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-postgres}

# Wait for PostgreSQL
wait_for_postgres

# Run migrations
run_migrations

# Start backend in the background
echo "Starting backend server..."
cd /app/apps/backend
PORT=12009 node dist/index.js &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 3

# Check if backend is still running
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "❌ Backend server died! Exiting..."
    exit 1
fi
echo "✅ Backend server started successfully (PID: $BACKEND_PID)"

# Start frontend
echo "Starting frontend server..."
cd /app/apps/frontend
PORT=12008 pnpm start &
FRONTEND_PID=$!

# Wait a moment for frontend to start
sleep 3

# Check if frontend is still running
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Frontend server died! Exiting..."
    kill $BACKEND_PID 2>/dev/null
    exit 1
fi
echo "✅ Frontend server started successfully (PID: $FRONTEND_PID)"

echo "🚀 Production services started successfully!"
echo "Backend running on port 12009"
echo "Frontend running on port 12008"

# Wait for both processes
wait $BACKEND_PID
wait $FRONTEND_PID 