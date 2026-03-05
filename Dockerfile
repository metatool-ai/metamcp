# syntax=docker/dockerfile:1

# === Base: build tools (Node.js + pnpm) ===
FROM ghcr.io/astral-sh/uv:debian AS base

RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm@10.12.0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# === Deps: install all dependencies (with pnpm store cache) ===
FROM base AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Copy root package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY turbo.json ./

# Copy package.json files from all workspaces
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/backend/package.json ./apps/backend/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/typescript-config/package.json ./packages/typescript-config/
COPY packages/zod-types/package.json ./packages/zod-types/

# Install dependencies with pnpm store cache
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# === Builder: build all packages and prepare prod deps ===
FROM base AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY . .

# Patch Next.js proxy timeout BEFORE build so standalone bundle includes the patch
RUN sed -i -e "s/30000/600000/" \
    "node_modules/.pnpm/next@15.5.12_react-dom@19.1.2_react@19.1.2__react@19.1.2/node_modules/next/dist/server/lib/router-utils/proxy-request.js" \
    "node_modules/.pnpm/next@15.5.12_react-dom@19.1.2_react@19.1.2__react@19.1.2/node_modules/next/dist/esm/server/lib/router-utils/proxy-request.js"

# Build with turbo + Next.js cache mounts for incremental rebuilds
RUN --mount=type=cache,id=turbo-cache,target=node_modules/.cache/turbo \
    --mount=type=cache,id=nextjs-cache,target=apps/frontend/.next/cache \
    pnpm build

# Prune to production dependencies (build done, dev deps no longer needed)
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --prod --ignore-scripts && \
    cd apps/backend && pnpm add drizzle-kit@0.31.1

# === Runner: lightweight production image ===
FROM node:20-slim AS runner
WORKDIR /app

# OCI image labels
LABEL org.opencontainers.image.source="https://github.com/metatool-ai/metamcp"
LABEL org.opencontainers.image.description="MetaMCP - aggregates MCP servers into a unified MetaMCP"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="MetaMCP"
LABEL org.opencontainers.image.vendor="metatool-ai"

# Install curl for health checks and pg_isready for postgres checks
RUN apt-get update && apt-get install -y curl postgresql-client && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user with proper home directory
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /home/nextjs/.cache/node/corepack && \
    chown -R nextjs:nodejs /home/nextjs

# Frontend: Next.js standalone bundle (server.js + minimal node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next/static ./apps/frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/public ./apps/frontend/public

# Backend: compiled code + migration files
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle.config.ts ./apps/backend/drizzle.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/package.json ./apps/backend/

# Production node_modules (merges on top of standalone's traced node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/node_modules ./apps/backend/node_modules

# Built workspace packages (needed at runtime by backend)
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages

# Copy startup script
COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs

# Expose frontend port (Next.js)
EXPOSE 12008

# Health check
HEALTHCHECK --interval=30s --timeout=30s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:12008/health || exit 1

# Start both backend and frontend
CMD ["./docker-entrypoint.sh"]
