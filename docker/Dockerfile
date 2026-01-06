# Multi-stage build for Next.js + PocketBase + Worker monorepo
FROM node:20-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat unzip curl
WORKDIR /app

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Copy package files
COPY package.json yarn.lock .yarnrc.yml* ./
COPY webapp/package.json ./webapp/
COPY shared/package.json ./shared/
COPY pb/package.json ./pb/
COPY worker/package.json ./worker/

# Install dependencies
RUN yarn install --immutable

# Download PocketBase binary
# Supports multi-architecture builds via TARGETARCH
# TARGETARCH is automatically provided by Docker Buildx
ARG POCKETBASE_VERSION=0.35.0
ARG TARGETARCH
RUN mkdir -p /app/pb && \
    # Map Docker TARGETARCH to PocketBase architecture naming
    POCKETBASE_ARCH=$(case "${TARGETARCH}" in \
        "amd64") echo "amd64" ;; \
        "arm64") echo "arm64" ;; \
        *) echo "amd64" ;; \
    esac) && \
    echo "Downloading PocketBase v${POCKETBASE_VERSION} for architecture: ${POCKETBASE_ARCH}" && \
    echo "Target architecture: ${TARGETARCH}" && \
    curl -f -L -S "https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_linux_${POCKETBASE_ARCH}.zip" \
    -o /tmp/pocketbase.zip && \
    unzip /tmp/pocketbase.zip -d /app/pb && \
    chmod +x /app/pb/pocketbase && \
    echo "Verifying binary..." && \
    head -c 4 /app/pb/pocketbase | od -A x -t x1 | head -1 && \
    rm /tmp/pocketbase.zip && \
    echo "PocketBase downloaded successfully"

# Build stage
FROM base AS builder
WORKDIR /app

# Build argument for NEXT_PUBLIC_POCKETBASE_URL
# This is embedded into the Next.js build at build time
# - Production/Staging: "/" (routes through nginx)
# - Development: "http://localhost:8090" (direct connection)
ARG NEXT_PUBLIC_POCKETBASE_URL="/"

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/.yarn ./.yarn
COPY --from=deps /app/pb/pocketbase ./pb/pocketbase

# Copy workspace files
COPY package.json yarn.lock .yarnrc.yml* ./
COPY webapp ./webapp
COPY shared ./shared
# Copy pb directory but exclude the binary (we use the downloaded one from deps stage)
COPY pb/pb_hooks ./pb/pb_hooks
COPY pb/pb_migrations ./pb/pb_migrations
COPY pb/package.json ./pb/package.json
COPY worker ./worker

# Build shared package first (required by webapp and worker)
RUN yarn workspace @project/shared build

# Build Next.js application
# Set NEXT_PUBLIC_POCKETBASE_URL as ENV so it's available during Next.js build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_POCKETBASE_URL=${NEXT_PUBLIC_POCKETBASE_URL}
# Verify the environment variable is set correctly before building
RUN echo "Building Next.js with NEXT_PUBLIC_POCKETBASE_URL=${NEXT_PUBLIC_POCKETBASE_URL}"
RUN yarn workspace @project/webapp build

# Build worker TypeScript to JavaScript
RUN yarn workspace @project/worker build

# Ensure optional files/directories exist for runner stage
RUN mkdir -p /app/pb/pb_migrations && \
    touch /app/.yarnrc.yml 2>/dev/null || true && \
    mkdir -p /app/shared/node_modules /app/worker/node_modules 2>/dev/null || true

# Ensure pb_migrations exists (it might not exist in source)
RUN mkdir -p /app/pb/pb_migrations

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Set POCKETBASE_URL for server-side code and worker
# Server-side code (API routes, Server Actions) and worker processes
# bypass nginx and connect directly to PocketBase at localhost:8090
ENV POCKETBASE_URL="http://localhost:8090"

# Install supervisor, nginx, curl, and ffmpeg for worker processing
RUN apk add --no-cache supervisor nginx curl ffmpeg

# Install Yarn v4
RUN corepack enable && corepack prepare yarn@4.12.0 --activate

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    adduser nextjs nodejs

# Create directories for supervisor and nginx
RUN mkdir -p /var/log/supervisor /var/run /etc/supervisor/conf.d && \
    mkdir -p /var/log/nginx /var/cache/nginx /var/run/nginx && \
    chown -R nextjs:nodejs /var/log/supervisor /var/run && \
    chown -R nginx:nginx /var/log/nginx /var/cache/nginx /var/run/nginx

# Copy PocketBase binary
COPY --from=builder --chown=nextjs:nodejs /app/pb/pocketbase ./pb/pocketbase

# Copy PocketBase hooks and migrations
COPY --from=builder --chown=nextjs:nodejs /app/pb/pb_hooks ./pb/pb_hooks
COPY --from=builder --chown=nextjs:nodejs /app/pb/pb_migrations ./pb/pb_migrations

# Create pb_data directory (will be populated at runtime)
RUN mkdir -p ./pb/pb_data && chown -R nextjs:nodejs ./pb/pb_data

# Create worker data directory for temporary processing files
RUN mkdir -p ./data && chown -R nextjs:nodejs ./data

# Create cache directories for Node.js and Yarn with proper permissions
RUN mkdir -p /app/.cache/node /app/.yarn/cache && \
    chown -R nextjs:nodejs /app/.cache /app/.yarn/cache

# Copy package files for workspace resolution
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./
COPY --from=builder --chown=nextjs:nodejs /app/yarn.lock ./
COPY --from=builder --chown=nextjs:nodejs /app/.yarn ./.yarn
COPY --from=builder --chown=nextjs:nodejs /app/.yarnrc.yml ./.yarnrc.yml

# Copy workspace package.json files
COPY --from=builder --chown=nextjs:nodejs /app/webapp/package.json ./webapp/
COPY --from=builder --chown=nextjs:nodejs /app/shared/package.json ./shared/
COPY --from=builder --chown=nextjs:nodejs /app/pb/package.json ./pb/
COPY --from=builder --chown=nextjs:nodejs /app/worker/package.json ./worker/

# Install production dependencies only
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/webapp/node_modules ./webapp/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/shared/node_modules ./shared/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/worker/node_modules ./worker/node_modules

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/webapp/.next ./webapp/.next
COPY --from=builder --chown=nextjs:nodejs /app/webapp/public ./webapp/public
COPY --from=builder --chown=nextjs:nodejs /app/webapp/next.config.ts ./webapp/next.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/webapp/tsconfig.json ./webapp/tsconfig.json

# Copy shared package dist
COPY --from=builder --chown=nextjs:nodejs /app/shared/dist ./shared/dist

# Copy worker built files
COPY --from=builder --chown=nextjs:nodejs /app/worker/dist ./worker/dist

# Copy supervisor and nginx configs
COPY --chown=root:root docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf
COPY --chown=root:root docker/nginx.conf /etc/nginx/nginx.conf

# Copy startup and validation scripts
COPY --chown=nextjs:nodejs docker/start.sh /app/start.sh
COPY --chown=root:root docker/graceful-shutdown.sh /app/docker/graceful-shutdown.sh

# Make scripts executable
RUN chmod +x /app/start.sh && \
    chmod +x /app/docker/graceful-shutdown.sh

# Create nginx user if it doesn't exist (it should from apk install)
# Ensure nginx can read the config
RUN chmod 644 /etc/nginx/nginx.conf

EXPOSE 80

ENV HOSTNAME="0.0.0.0"

# Configure graceful shutdown signal
# SIGTERM is the standard signal for graceful shutdown
# Supervisord will propagate this to all managed processes
STOPSIGNAL SIGTERM

# Run as root initially to start supervisor (which will manage processes as appropriate users)
CMD ["/app/start.sh"]
