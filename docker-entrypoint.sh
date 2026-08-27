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

# Wait until a local TCP port accepts connections (bounded). The old code used
# a fixed `sleep 3` + `kill -0`, which misclassified a slow-but-healthy boot as
# dead and exited the container — a restart loop on cold caches. Probing the
# actual port proves the service is LISTENING, not merely that the wrapper
# process is alive.
wait_for_port() {
    local host="$1"
    local port="$2"
    local timeout_s="${3:-60}"
    local deadline=$(( $(date +%s) + timeout_s ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if curl -fsS -o /dev/null "http://${host}:${port}/health" 2>/dev/null; then
            echo "✅ Service on ${host}:${port} is healthy"
            return 0
        fi
        sleep 1
    done
    echo "❌ Service on ${host}:${port} did not become healthy within ${timeout_s}s"
    return 1
}

# Wait for the backend to become healthy WITHOUT starting the health-wait
# (kill) timer before the blocking install phase has finished. On a COLD first
# boot the backend installs required packages BEFORE it binds port 12009, which
# can take minutes. Phase 1 waits — no kill timer, crash detection only — for
# the "[startup] backend serving on port 12009" marker in the backend's own
# stdout, the authoritative signal that install completed and the server is
# listening. Only then does phase 2 start the bounded /health wait. Warm boots
# stay fast because the install no-ops and the marker appears immediately.
wait_for_backend() {
    # Phase 1: install. No kill timer here — the install takes as long as it
    # takes; the only early exit is the backend process dying.
    echo "⏳ Waiting for backend install to complete..."
    while ! grep -qF "[startup] backend serving on port 12009" "$BACKEND_OUT" 2>/dev/null; do
        # Crash, not slow: if the backend process dies mid-install, fail fast.
        if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
            echo "❌ Backend server process died during startup! Exiting..."
            tail -n 50 "$BACKEND_OUT" 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done
    echo "✅ Backend install completed and server is listening"
    # Phase 2: install done + listening — only now does the kill timer start.
    if ! wait_for_port localhost 12009 90; then
        echo "❌ Backend server failed to become healthy! Exiting..."
        exit 1
    fi
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

# Start backend in the background. Direct file redirect (proven, unbuffered at
# the shell level) so the wait loop's marker grep sees the line immediately —
# the SAME path as before. A separate `tail -F` copier streams that same file
# to OUR stdout so install + MCP lifecycle logs ALSO reach `docker logs`.
echo "Starting backend server..."
cd /app/apps/backend
BACKEND_OUT=/tmp/backend.out
: > "$BACKEND_OUT"
PORT=12009 node dist/index.js > "$BACKEND_OUT" 2>&1 &
BACKEND_PID=$!
tail -n +1 -F "$BACKEND_OUT" &

# Wait for the backend to actually bind + answer /health. The health-wait
# (kill) timer only starts AFTER the install phase completes — on cold boots
# the install can take minutes, so the timer must not be running during it.
if ! wait_for_backend; then
    echo "❌ Backend server failed to become healthy! Exiting..."
    exit 1
fi
echo "✅ Backend server started successfully (PID: $BACKEND_PID)"

# Start frontend
echo "Starting frontend server..."
cd /app/apps/frontend
PORT=12008 pnpm start &
FRONTEND_PID=$!

# Wait for the frontend to bind. The Next proxy rewrites /health to the backend
# (12009), so 12008 answering on its own assets is enough to prove the frontend
# is up; the backend health is already gated above.
if ! wait_for_port localhost 12008 90; then
    echo "❌ Frontend server failed to become healthy! Exiting..."
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
trap cleanup TERM INT

echo "Services started successfully!"
echo "Backend running on port 12009"
echo "Frontend running on port 12008"

# Wait for both processes
wait $BACKEND_PID
wait $FRONTEND_PID 