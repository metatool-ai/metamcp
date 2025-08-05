# Docker Development Environment

This document describes how to run MetaMCP in a Docker development environment with hot reload using turborepo.

## Quick Start

Run the development environment with a single command:

```bash
# Using npm script
npm run dev:docker

# Or directly
./scripts/dev-docker.sh
```

## What This Does

The Docker development environment:

1. **Uses turborepo**: Runs `pnpm dev` inside the container, which uses turborepo to manage both frontend and backend
2. **Hot reload**: Changes to your code automatically restart the services
3. **Docker integration**: The backend can spawn new Docker containers and manage networks
4. **Volume mounting**: Your local code is mounted into the container for live development
5. **Database**: Includes a PostgreSQL database with persistent storage

## Services

- **Frontend**: http://localhost:12008 (Next.js with Turbopack)
- **Backend**: http://localhost:12009 (Express.js)
- **Database**: localhost:9433 (PostgreSQL)

## Environment Variables

The development environment uses `.env.local` for configuration. If it doesn't exist, it will be created from `example.env`.

Key environment variables:
- `DATABASE_URL`: PostgreSQL connection string
- `BETTER_AUTH_SECRET`: Authentication secret
- `APP_URL`: Application URL
- `DOCKER_HOST`: Docker socket path

## Docker Features

The development container has access to:
- Docker socket for spawning containers
- Docker CLI for container management
- Network administration capabilities
- System administration privileges

## Development Workflow

1. **Start the environment**: `npm run dev:docker`
2. **Make changes**: Edit files in your local workspace
3. **See changes**: Hot reload will automatically restart services
4. **Stop**: Press `Ctrl+C` to stop all services

## Troubleshooting

### Port conflicts
If ports 12008, 12009, or 9433 are already in use, modify the ports in `docker-compose.dev.yml`.

### Docker permissions
On Linux, you may need to add your user to the docker group:
```bash
sudo usermod -aG docker $USER
```

### Environment variables
Ensure `.env.local` exists and contains the necessary variables. Check `example.env` for required variables.

### Database issues
If the database isn't starting, check the PostgreSQL logs:
```bash
docker-compose -f docker-compose.dev.yml logs postgres
```

## Differences from Local Development

- Uses Docker containers instead of local Node.js
- Includes PostgreSQL database
- Has Docker integration capabilities
- Uses volume mounts for hot reload
- Runs in an isolated environment

## Building for Production

For production builds, use the main `Dockerfile` and `docker-compose.yml` instead of the development versions. 