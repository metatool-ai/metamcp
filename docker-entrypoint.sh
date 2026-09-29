#!/bin/sh

set -e

echo "Starting MetaMCP services..."

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

# Set default values for postgres connection if not provided
POSTGRES_HOST=${POSTGRES_HOST:-postgres}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-postgres}

# Wait for PostgreSQL
wait_for_postgres

# Run migrations
run_migrations

# V8 sizes its heaps from the host memory, not from what MetaMCP needs: an
# idle backend would hold ~350 MB. These caps stay well above the actual use;
# flags given in NODE_OPTIONS take precedence (the last one wins), and an
# empty value falls back to Node's own defaults.
BACKEND_NODE_OPTIONS=${BACKEND_NODE_OPTIONS---max-semi-space-size=4 --max-old-space-size=512}
FRONTEND_NODE_OPTIONS=${FRONTEND_NODE_OPTIONS---max-semi-space-size=2 --max-old-space-size=256}

# Start backend in the background
echo "Starting backend server..."
cd /app/apps/backend
NODE_OPTIONS="$BACKEND_NODE_OPTIONS ${NODE_OPTIONS:-}" PORT=12009 node dist/index.js &
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
# forwarded-for.cjs adds the client address to X-Forwarded-For (see the file).
# Next.js is started by node itself: through `pnpm start` a pnpm process
# (~100 MB) would stay alive for nothing.
NODE_OPTIONS="--require /app/apps/frontend/forwarded-for.cjs $FRONTEND_NODE_OPTIONS ${NODE_OPTIONS:-}" PORT=12008 node node_modules/next/dist/bin/next start &
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

# Function to cleanup on exit
cleanup() {
    echo "Shutting down services..."
    kill $BACKEND_PID 2>/dev/null || true
    kill $FRONTEND_PID 2>/dev/null || true
    wait $BACKEND_PID 2>/dev/null || true
    wait $FRONTEND_PID 2>/dev/null || true
    echo "Services stopped"
}

# Trap signals for graceful shutdown
trap 'cleanup; exit 0' TERM INT

echo "Services started successfully!"
echo "Backend running on port 12009"
echo "Frontend running on port 12008"

# Stop the container as soon as one of the servers exits (a crash, or a heap
# cap reached), so that the restart policy brings MetaMCP back instead of
# leaving the other one running alone
while kill -0 $BACKEND_PID 2>/dev/null && kill -0 $FRONTEND_PID 2>/dev/null; do
    sleep 5 &
    wait $!
done
echo "❌ A MetaMCP server exited, stopping the container"
cleanup
exit 1 