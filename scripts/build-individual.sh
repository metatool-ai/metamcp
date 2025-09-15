#!/bin/bash

# Individual Build Script for MetaMCP Apps
set -e

echo "🏗️  Building MetaMCP Apps Individually..."

# Function to build an app
build_app() {
    local app_name=$1
    local app_path=$2
    
    echo "📦 Building $app_name..."
    
    # Build dependencies first
    echo "  Building dependencies..."
    pnpm --filter @repo/zod-types build
    pnpm --filter @repo/trpc build
    
    # Build the app
    echo "  Building $app_name..."
    pnpm --filter $app_name build
    
    echo "✅ $app_name built successfully!"
}

# Parse command line arguments
case "${1:-all}" in
    "backend")
        build_app "backend" "apps/backend"
        ;;
    "frontend")
        build_app "frontend" "apps/frontend"
        ;;
    "all")
        echo "🔄 Building all apps..."
        build_app "backend" "apps/backend"
        build_app "frontend" "apps/frontend"
        ;;
    *)
        echo "Usage: $0 [backend|frontend|all]"
        echo "  backend  - Build only the backend app"
        echo "  frontend - Build only the frontend app"
        echo "  all      - Build both apps (default)"
        exit 1
        ;;
esac

echo "🎉 Build completed successfully!"
