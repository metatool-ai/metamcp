# Backend Production Dockerfile
FROM node:18-alpine AS base

# Install pnpm
RUN npm install -g pnpm

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/zod-types/package.json ./packages/zod-types/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN pnpm install --frozen-lockfile --prod

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy package files and install all dependencies (including devDependencies)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/zod-types/package.json ./packages/zod-types/
COPY packages/trpc/package.json ./packages/trpc/
COPY packages/typescript-config/package.json ./packages/typescript-config/
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/zod-types ./packages/zod-types
COPY packages/trpc ./packages/trpc
COPY packages/typescript-config ./packages/typescript-config
COPY apps/backend ./apps/backend

# Build packages first (dependencies)
RUN pnpm --filter @repo/zod-types build
RUN pnpm --filter @repo/trpc build

# Build backend
RUN pnpm --filter backend build

# Production image, copy all the files and run the app
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 backend

# Copy built application
COPY --from=builder --chown=backend:nodejs /app/apps/backend/dist ./dist
COPY --from=builder --chown=backend:nodejs /app/packages/zod-types/dist ./node_modules/@repo/zod-types/dist
COPY --from=builder --chown=backend:nodejs /app/packages/trpc/dist ./node_modules/@repo/trpc/dist

# Copy production dependencies
COPY --from=deps --chown=backend:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=backend:nodejs /app/apps/backend/node_modules ./apps/backend/node_modules

# Copy package.json for runtime
COPY --chown=backend:nodejs apps/backend/package*.json ./

USER backend

EXPOSE 12009

ENV PORT=12009

CMD ["node", "dist/index.js"]
