#!/bin/bash

# Production Deployment Script for MetaMCP
set -e

echo "🚀 Starting MetaMCP Production Deployment..."

# Check if required environment variables are set
if [ -z "$BETTER_AUTH_SECRET" ]; then
    echo "❌ Error: BETTER_AUTH_SECRET environment variable is required"
    echo "   Generate one with: openssl rand -base64 32"
    exit 1
fi

if [ -z "$DB_PASSWORD" ]; then
    echo "❌ Error: DB_PASSWORD environment variable is required"
    exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p ssl
mkdir -p /tmp/metamcp-servers

# Build and start services
echo "🏗️  Building and starting services..."
docker-compose -f docker-compose.prod.yml down --remove-orphans
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo "⏳ Waiting for services to be healthy..."
sleep 30

# Check service health
echo "🔍 Checking service health..."
if docker-compose -f docker-compose.prod.yml ps | grep -q "unhealthy"; then
    echo "❌ Some services are unhealthy. Check logs:"
    docker-compose -f docker-compose.prod.yml logs
    exit 1
fi

echo "✅ Deployment completed successfully!"
echo ""
echo "🌐 Your application should be available at:"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:12009"
echo "   Health:   http://localhost:12009/health"
echo ""
echo "📊 To view logs:"
echo "   docker-compose -f docker-compose.prod.yml logs -f"
echo ""
echo "🛑 To stop:"
echo "   docker-compose -f docker-compose.prod.yml down"
