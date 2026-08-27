# Use the official uv image as base
FROM ghcr.io/astral-sh/uv:debian AS base

# Install Node.js and pnpm directly. Node 24: the current MCP package catalog
# declares engines.node >= 24 (nws-weather-mcp-server, paperless-mcp, ...) and
# npm 10 aborts a whole install batch on one engine violation, so a Node 20
# runtime makes those packages impossible to prewarm. ForceIPv4 + curl -4 keep
# the apt/node setup reproducible on IPv6-flaky build runners.
RUN echo 'Acquire::ForceIPv4 "true";' > /etc/apt/apt.conf.d/99force-ipv4 && apt-get update && apt-get install -y \
    curl \
    gnupg \
    && curl -4 -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm@10.29.3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install Bun into /usr/local so `bun`/`bunx` are on the system PATH for any
# spawned process (the runtime runs as `USER nextjs`, whose non-login shells do
# not read ~/.bashrc, so a $HOME-based install would be unreachable).
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
    && bun --version

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
RUN CI=true pnpm install --frozen-lockfile

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

# The pnpm store dir is suffixed with the resolved react peer versions (e.g.
# _react-dom@19.2.4_react@19.2.4__react@19.2.4), which drift as the lockfile
# updates. `find`-based so the sed survives any dependency bump without a path
# rewrite, and fail-open so a future store layout change can't break the build.
RUN find node_modules/.pnpm -path "*next/dist/server/lib/router-utils/proxy-request.js" -exec sed -i "s/30000/600000/" {} + || true && \
    find node_modules/.pnpm -path "*next/dist/esm/server/lib/router-utils/proxy-request.js" -exec sed -i "s/30000/600000/" {} + || true

# Production runner stage
FROM base AS runner
WORKDIR /app

# OCI image labels
LABEL org.opencontainers.image.source="https://github.com/metatool-ai/metamcp"
LABEL org.opencontainers.image.description="MetaMCP - aggregates MCP servers into a unified MetaMCP"
LABEL org.opencontainers.image.licenses="MIT"
LABEL org.opencontainers.image.title="MetaMCP"
LABEL org.opencontainers.image.vendor="metatool-ai"

# Install curl for health checks + git for inline git-build installs
# (netbirdio/netbird-mcp, nikkomiu/pocketid-mcp clone + build at boot).
RUN apt-get update && apt-get install -y curl postgresql-client git && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user with proper home directory
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 --home /home/nextjs nextjs && \
    mkdir -p /home/nextjs/.cache/node/corepack /home/nextjs/.cache/uv && \
    chown -R nextjs:nodejs /home/nextjs

# Required-package install TARGET: pin the npm global prefix to the per-user
# ~/.npm-global (the image default prefix is /usr, which is on the read-only
# overlay — `npm install -g` there would re-resolve the whole tree on every
# boot and never persist). Image-level so it is ALWAYS present, even when the
# operator's runtime env omits it.
ENV REQUIRED_PACKAGES_NPM_PREFIX=/home/nextjs/.npm-global

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
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-lock.yaml ./
COPY --from=builder --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./

# pnpm aborts the modules-dir removal when there's no TTY unless CI is set; CI builds are non-TTY.
ENV CI=true

# MCP server-pool tuning. Bounded spawn concurrency + finite session lifetime
# prevent cold-start storms and connection leaks; the connect timeout covers
# slow cold server boots. All are overridable at runtime.
ENV MCP_SPAWN_CONCURRENCY=4 \
    MCP_CONNECT_TIMEOUT_MS=90000 \
    MCP_STDIO_CONNECT_TIMEOUT_MS=120000 \
    MCP_IDLE_TIMEOUT_MS=1800000 \
    SESSION_LIFETIME=3600000

# Required-package INSTALL phase — a BOOT-BLOCKING pre-install of every stdio
# MCP package, run before the web service serves (like deps). Simple ENV lists:
#   REQUIRED_PACKAGES_NPM="pkg1 pkg2"        # npm install -g → ~/.npm-global
#   REQUIRED_PACKAGES_UVX="uvxpkg1"          # uv tool install → ~/.cache/uv
#   REQUIRED_PACKAGES_UVX_ARGS="--from git+… --with … python -m …,…"  # atomic uvx
#   REQUIRED_PACKAGES_BUN="bunpkg1"          # bun add -g → ~/.bun
#   REQUIRED_PACKAGES_GIT_NPM="git+https://…#<subdir>|#<cmd>|#<args>"  # git+npm build
#   REQUIRED_PACKAGES_BUN_GIT="git+https://…#<subdir>|#<cmd>|#<args>"  # git+bun build
#   REQUIRED_PACKAGES_CONCURRENCY=2
#   REQUIRED_PACKAGES_NPM_PREFIX=$HOME/.npm-global  # pinned at image level above
# Each package logs "Starting package pre-install: <pkg>" → "Pre-installed
# <pkg>" / "Failed: <reason>". Packages install into the per-user cache dirs
# (/home/nextjs/.npm-global, /home/nextjs/.cache/uv, /home/nextjs/.bun) which
# are volume-mountable and persist across recreates; nothing is baked into the
# image. Legacy MCP_PREWARM_* names still work as fallbacks.
#
# Cache self-heal — OPT-IN via env. The npx/uvx/bunx caches are per-user and
# shared by every spawned stdio server; concurrent cold spawns (or two
# replicas sharing a cache volume) can tear a cache entry → "npx cache
# corrupted" / EINTEGRITY, and the corruption cascades because every retry is
# another concurrent writer. MCP_CACHE_HEAL=1 makes the container verify the
# npm cache before prewarm, purge a cache after a corrupt fast-failing spawn
# (once per process lifetime), and re-run a failed prewarm install once
# against the fresh store. Healthy warm caches are never touched. Default off:
#   MCP_CACHE_HEAL=1
#   MCP_CACHE_HEAL_FAST_FAIL_MS=8000   # how fast a non-zero exit counts as cache-corrupt

# Install production dependencies only. drizzle-kit is a production dependency
# of apps/backend (it runs `pnpm exec drizzle-kit migrate` at startup), so the
# --prod prune keeps it linked into apps/backend/node_modules/.bin. --frozen-
# lockfile pins the runner to the lockfile versions (no drift re-resolve).
# The explicit add --prod below is belt-and-braces: if the lockfile doesn't
# carry drizzle-kit as a prod dep, the entrypoint's `pnpm exec drizzle-kit
# migrate` would fail with "Command drizzle-kit not found" and crash-loop.
RUN CI=true pnpm install --prod --frozen-lockfile \
    && cd apps/backend && CI=true pnpm add --prod drizzle-kit@0.31.1 \
    # The Next proxy-request timeout patch must be re-applied here: this stage
    # runs its OWN pnpm install (--prod), which links the store with the peer
    # deps the runner resolves (react 19.x could float to a different minor than
    # the builder's). The builder-stage sed only patched the builder's store, so
    # the static-path sed below would miss and fail the build. find-based + fail-
    # open so it survives any peer/store drift.
    && find node_modules/.pnpm -path "*next/dist/server/lib/router-utils/proxy-request.js" -exec sed -i "s/30000/600000/" {} + || true \
    && find node_modules/.pnpm -path "*next/dist/esm/server/lib/router-utils/proxy-request.js" -exec sed -i "s/30000/600000/" {} + || true

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
