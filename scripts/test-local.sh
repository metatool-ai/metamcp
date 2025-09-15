#!/bin/bash

# Local Docker Testing Script for MetaMCP
set -e

echo "🧪 Testing MetaMCP Docker Setup Locally..."

# Function to test individual app
test_app() {
    local app_name=$1
    local dockerfile_path=$2
    local port=$3
    
    echo "🔍 Testing $app_name Docker build..."
    
    # Build the Docker image
    echo "  Building Docker image..."
    docker build -f $dockerfile_path -t metamcp-$app_name-test .
    
    if [ $? -eq 0 ]; then
        echo "✅ $app_name Docker image built successfully!"
    else
        echo "❌ $app_name Docker build failed!"
        exit 1
    fi
    
    # Test if we can run the container (don't start it, just test)
    echo "  Testing container creation..."
    docker create --name metamcp-$app_name-test-container metamcp-$app_name-test
    
    if [ $? -eq 0 ]; then
        echo "✅ $app_name container can be created successfully!"
        docker rm metamcp-$app_name-test-container
    else
        echo "❌ $app_name container creation failed!"
        exit 1
    fi
}

# Function to test full stack
test_full_stack() {
    echo "🚀 Testing full stack with Docker Compose..."
    
    # Clean up any existing containers
    echo "  Cleaning up existing containers..."
    docker compose -f docker-compose.local.yml down --remove-orphans --volumes
    
    # Build and start services
    echo "  Building and starting services..."
    docker compose -f docker-compose.local.yml up -d --build
    
    # Wait for services to be ready
    echo "  Waiting for services to be healthy..."
    sleep 45
    
    # Test backend health
    echo "  Testing backend health..."
    if curl -f http://localhost:12009/health > /dev/null 2>&1; then
        echo "✅ Backend is healthy!"
    else
        echo "❌ Backend health check failed!"
        echo "Backend logs:"
        docker compose -f docker-compose.local.yml logs backend-local
        return 1
    fi
    
    # Test frontend
    echo "  Testing frontend..."
    if curl -f http://localhost:3001 > /dev/null 2>&1; then
        echo "✅ Frontend is responding!"
    else
        echo "❌ Frontend health check failed!"
        echo "Frontend logs:"
        docker compose -f docker-compose.local.yml logs frontend-local
        return 1
    fi
    
    # Test database connection
    echo "  Testing database connection..."
    if docker compose -f docker-compose.local.yml exec -T postgres-local psql -U metamcp_local -d metamcp_local -c "SELECT 1;" > /dev/null 2>&1; then
        echo "✅ Database is accessible!"
    else
        echo "❌ Database connection failed!"
        docker compose -f docker-compose.local.yml logs postgres-local
        return 1
    fi
    
    echo "🎉 Full stack test completed successfully!"
    echo ""
    echo "🌐 Access your application at:"
    echo "   Frontend: http://localhost:3001"
    echo "   Backend:  http://localhost:12009"
    echo "   Health:   http://localhost:12009/health"
    echo ""
    echo "📊 To view logs:"
    echo "   docker compose -f docker-compose.local.yml logs -f"
    echo ""
    echo "🛑 To stop:"
    echo "   docker compose -f docker-compose.local.yml down"
}

# Parse command line arguments
case "${1:-full}" in
    "backend")
        test_app "backend" "apps/backend/Dockerfile" "12009"
        ;;
    "frontend")
        test_app "frontend" "apps/frontend/Dockerfile" "3000"
        ;;
    "individual")
        echo "🔄 Testing individual apps..."
        test_app "backend" "apps/backend/Dockerfile" "12009"
        test_app "frontend" "apps/frontend/Dockerfile" "3000"
        echo "✅ All individual tests passed!"
        ;;
    "full")
        test_full_stack
        ;;
    "clean")
        echo "🧹 Cleaning up test containers and images..."
        docker compose -f docker-compose.local.yml down --remove-orphans --volumes
        docker rmi metamcp-backend-test metamcp-frontend-test 2>/dev/null || true
        echo "✅ Cleanup completed!"
        ;;
    *)
        echo "Usage: $0 [backend|frontend|individual|full|clean]"
        echo "  backend     - Test only backend Docker build"
        echo "  frontend    - Test only frontend Docker build"
        echo "  individual  - Test both apps individually"
        echo "  full        - Test full stack with docker-compose (default)"
        echo "  clean       - Clean up test containers and images"
        exit 1
        ;;
esac
