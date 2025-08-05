#!/bin/bash

# Development Docker script for MetaMCP
# This script runs the entire development environment in Docker with hot reload using turborepo

set -e

echo "🚀 Starting MetaMCP development environment in Docker..."
echo "📦 Using turborepo for development..."

# Check if .env.local exists, if not create from example
if [ ! -f .env.local ]; then
    if [ -f example.env ]; then
        echo "📝 Creating .env.local from example.env..."
        cp example.env .env.local
    else
        echo "⚠️  Warning: No .env.local found and no example.env available"
        echo "   You may need to create .env.local manually"
    fi
fi

# Build MCP server image first
echo "🔨 Building MCP server image..."
docker build -t mcp/server:latest -f apps/backend/src/lib/metamcp/mcp-server-docker/Dockerfile apps/backend/src/lib/metamcp/mcp-server-docker/

# Build and start the development environment
echo "🔨 Building development container..."
docker compose -f docker-compose.dev.yml build

echo "🏃 Starting development services with turborepo..."
echo "   This will run 'pnpm dev' inside the container using turborepo"
docker compose -f docker-compose.dev.yml up

echo "✅ Development environment started!"
echo "📱 App: http://localhost:12008"
echo "🗄️  Database: localhost:${POSTGRES_EXTERNAL_PORT:-9433}"
echo ""
echo "🔄 Hot reload is enabled - changes to your code will automatically restart the services"
echo "Press Ctrl+C to stop the development environment" 