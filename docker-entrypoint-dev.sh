#!/bin/sh

set -e

echo "🚀 Starting MetaMCP development services..."
echo "📁 Working directory: $(pwd)"
echo "🔍 Node version: $(node --version)"
echo "📦 pnpm version: $(pnpm --version)"

# Wait for Postgres if compose didn't already gate startup
if command -v pg_isready >/dev/null 2>&1; then
    echo "⏳ Checking PostgreSQL readiness..."
    until pg_isready -h "${POSTGRES_HOST:-postgres}" -p "${POSTGRES_PORT:-5432}" -U "${POSTGRES_USER:-metamcp_user}" >/dev/null 2>&1; do
        echo "🔁 PostgreSQL not ready yet, retrying in 2s..."
        sleep 2
    done
    echo "✅ PostgreSQL is ready"
else
    echo "ℹ️ pg_isready not found; relying on docker-compose healthcheck"
fi

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

echo "🔧 Setting up development environment..."
echo "📊 Backend will run on port 12009"
echo "🌐 Frontend will run on port 12008"
echo "🔄 Hot reloading is enabled for both frontend and backend"

# Ensure dependencies are up to date
echo "📦 Checking dependencies..."
pnpm install

# Run database migrations for development
echo "🛠 Running database migrations (dev)..."
(
    set -e
    cd apps/backend
    # drizzle-kit reads DATABASE_URL from env (compose provides it)
    if pnpm exec drizzle-kit migrate; then
        echo "✅ Migrations applied successfully"
    else
        echo "❌ Migration failed. See logs above."
        exit 1
    fi
)

# Start the development servers with proper signal handling
echo "🚀 Starting pnpm dev with turborepo..."
echo "💡 This will start both frontend and backend in development mode"
pnpm dev &
PNPM_PID=$!
echo "🚀 pnpm dev started with PID: $PNPM_PID"

# Wait for the pnpm dev process, but don't block cleanup
wait "$PNPM_PID" || true 
