#!/bin/bash

# Quick Docker Build Test
set -e

echo "⚡ Quick Docker Build Test..."

# Test backend build
echo "🔍 Testing backend Docker build..."
docker build -f apps/backend/Dockerfile -t metamcp-backend-test . --quiet
if [ $? -eq 0 ]; then
    echo "✅ Backend Docker build: SUCCESS"
else
    echo "❌ Backend Docker build: FAILED"
    exit 1
fi

# Test frontend build
echo "🔍 Testing frontend Docker build..."
docker build -f apps/frontend/Dockerfile -t metamcp-frontend-test . --quiet
if [ $? -eq 0 ]; then
    echo "✅ Frontend Docker build: SUCCESS"
else
    echo "❌ Frontend Docker build: FAILED"
    exit 1
fi

echo "🎉 All Docker builds successful!"
echo ""
echo "🧹 Cleaning up test images..."
docker rmi metamcp-backend-test metamcp-frontend-test

echo "✅ Quick test completed!"
