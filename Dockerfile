# Use the official uv image as base
FROM ghcr.io/astral-sh/uv:debian AS base

# Install Node.js and pnpm directly
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm@10.12.0 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED 1

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

# Install dependencies
RUN pnpm install --frozen-lockfile

# Builder stage
FROM base AS builder
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/frontend/node_modules ./apps/frontend/node_modules
COPY --from=deps /app/apps/backend/node_modules ./apps/backend/node_modules
COPY --from=deps /app/packages ./packages

# Copy source code
COPY . .

# Build all packages and apps
RUN pnpm build

# Bump Next.js dev proxy timeout 30s -> 600s. The pnpm store dir for `next`
# embeds the resolved react/react-dom versions, so we glob it instead of
# hardcoding (a hardcoded path silently breaks on every react/next bump).
RUN found=0; \
    for f in node_modules/.pnpm/next@*/node_modules/next/dist/server/lib/router-utils/proxy-request.js \
             node_modules/.pnpm/next@*/node_modules/next/dist/esm/server/lib/router-utils/proxy-request.js; do \
      if [ -f "$f" ]; then sed -i -e "s/30000/600000/" "$f"; found=1; fi; \
    done; \
    if [ "$found" = 0 ]; then echo "WARN: next proxy-request.js not found; timeout patch skipped"; fi

# Production runner stage
FROM base AS runner
WORKDIR /app

# OCI image labels
LABEL org.opencontainers.image.source="https://github.com/metatool-ai/metamcp"
LABEL org.opencontainers.image.description="MetaMCP - aggregates MCP servers into a unified MetaMCP"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="MetaMCP"
LABEL org.opencontainers.image.vendor="metatool-ai"

# Install curl for health checks
RUN apt-get update && apt-get install -y curl postgresql-client && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user with proper home directory
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /home/nextjs/.cache/node/corepack /home/nextjs/.cache/uv && \
    chown -R nextjs:nodejs /home/nextjs

# Copy built applications
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/.next ./apps/frontend/.next
COPY --from=builder --chown=nextjs:nodejs /app/apps/frontend/package.json ./apps/frontend/
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/package.json ./apps/backend/
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle ./apps/backend/drizzle
COPY --from=builder --chown=nextjs:nodejs /app/apps/backend/drizzle.config.ts ./apps/backend/

# Copy built packages
COPY --from=builder --chown=nextjs:nodejs /app/packages ./packages
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./

# drizzle-kit is a backend devDependency but is required at runtime for
# `pnpm exec drizzle-kit migrate` (see docker-entrypoint.sh). `pnpm install --prod`
# prunes devDependencies, so promote it to a prod dependency first; the prod
# install below then keeps it and links its bin. (A separate `pnpm add
# drizzle-kit --prod` no-ops because it is an already-satisfied devDep, leaving
# no binary and breaking migrations at startup.)
RUN cd apps/backend \
    && pnpm pkg set dependencies.drizzle-kit="^0.31.1" \
    && pnpm pkg delete devDependencies.drizzle-kit

# Install production dependencies only.
# pnpm >=10 refuses to purge the copied node_modules without a TTY
# (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY) during a non-interactive Docker
# build. Disable the purge confirmation: pnpm v10 reads npm_config_*, v11 reads
# pnpm_config_* (set both), and CI=true makes pnpm treat the build as
# non-interactive. --no-frozen-lockfile lets pnpm reconcile the drizzle-kit
# promotion above.
ENV CI=true \
    npm_config_confirm_modules_purge=false \
    pnpm_config_confirm_modules_purge=false
RUN pnpm install --prod --no-frozen-lockfile

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