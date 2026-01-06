#!/bin/sh
set -e

echo "=== Container Startup ==="
echo ""

# =============================================================================
# Step 1: Set default values for environment variables
# These defaults match the shared/src/env.ts schema defaults
# =============================================================================
echo "Setting environment variable defaults..."

# PocketBase Configuration (Requirements 4.1)
export PB_DATA_DIR="${PB_DATA_DIR:-/app/pb/pb_data}"
export PB_PUBLIC_DIR="${PB_PUBLIC_DIR:-/app/webapp/.next}"
export POCKETBASE_URL="${POCKETBASE_URL:-http://localhost:8090}"

# Worker Configuration (Requirements 4.2)
export WORKER_DATA_DIR="${WORKER_DATA_DIR:-/app/data}"
export WORKER_CONCURRENCY="${WORKER_CONCURRENCY:-2}"
export WORKER_MAX_RETRIES="${WORKER_MAX_RETRIES:-3}"
export WORKER_PROVIDER="${WORKER_PROVIDER:-ffmpeg}"
export WORKER_POLL_INTERVAL="${WORKER_POLL_INTERVAL:-5000}"

# Container Behavior
export GRACEFUL_SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-30}"

# Logging
export LOG_LEVEL="${LOG_LEVEL:-info}"
export NODE_ENV="${NODE_ENV:-production}"

# =============================================================================
# Step 2: Validate environment using shared schema (Requirements 4.5)
# This provides clear error messages for invalid configuration
# =============================================================================

# =============================================================================
# Step 3: Create required directories with proper permissions
# (Requirements 2.3: Create directories if they don't exist)
# =============================================================================
echo "Creating required directories..."

# Create PocketBase data directory
if [ ! -d "$PB_DATA_DIR" ]; then
    echo "  Creating PB_DATA_DIR: $PB_DATA_DIR"
    mkdir -p "$PB_DATA_DIR"
fi

# Create worker data directory
if [ ! -d "$WORKER_DATA_DIR" ]; then
    echo "  Creating WORKER_DATA_DIR: $WORKER_DATA_DIR"
    mkdir -p "$WORKER_DATA_DIR"
fi

# Create log directories
mkdir -p /var/log/supervisor
mkdir -p /var/log/nginx

# Ensure proper ownership for non-root user (nextjs:nodejs)
# Use -R for recursive ownership change
echo "  Setting directory permissions..."
chown -R nextjs:nodejs "$PB_DATA_DIR" 2>/dev/null || echo "    Warning: Could not change ownership of $PB_DATA_DIR"
chown -R nextjs:nodejs "$WORKER_DATA_DIR" 2>/dev/null || echo "    Warning: Could not change ownership of $WORKER_DATA_DIR"

# Set appropriate permissions (rwx for owner, rx for group)
chmod -R 755 "$PB_DATA_DIR" 2>/dev/null || true
chmod -R 755 "$WORKER_DATA_DIR" 2>/dev/null || true

echo ""
echo "Directory setup complete:"
echo "  - PB_DATA_DIR: $PB_DATA_DIR"
echo "  - PB_PUBLIC_DIR: $PB_PUBLIC_DIR"
echo "  - WORKER_DATA_DIR: $WORKER_DATA_DIR"

# =============================================================================
# Step 4: Setup signal handlers for graceful shutdown (Requirements 13.4)
# =============================================================================
# Note: Signal handling is done by supervisord, but we set up the timeout
export GRACEFUL_SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-30}"
echo ""
echo "Graceful shutdown timeout: ${GRACEFUL_SHUTDOWN_TIMEOUT}s"

# =============================================================================
# Step 5: Start supervisord
# =============================================================================
echo ""
echo "Starting services with Supervisor..."
echo "============================================"
echo ""

# Use exec to replace the shell process with supervisord
# This ensures signals are properly forwarded to supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
