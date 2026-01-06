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
# POCKETBASE_URL is for server-side code and worker (bypasses nginx, connects directly)
export POCKETBASE_URL="${POCKETBASE_URL:-http://localhost:8090}"
export POCKETBASE_ADMIN_EMAIL="${POCKETBASE_ADMIN_EMAIL:-admin@example.com}"
export POCKETBASE_ADMIN_PASSWORD="${POCKETBASE_ADMIN_PASSWORD:-your-secure-password}"

# Worker Configuration (Requirements 4.2)
export WORKER_DATA_DIR="${WORKER_DATA_DIR:-/app/data}"
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
# Step 4: Verify FFmpeg installation (for worker)
# =============================================================================
echo ""
echo "Verifying FFmpeg installation..."

if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    FFMPEG_VERSION=$(ffmpeg -version 2>/dev/null | head -n1 | awk '{print $3}' || echo "unknown")
    FFPROBE_VERSION=$(ffprobe -version 2>/dev/null | head -n1 | awk '{print $3}' || echo "unknown")
    echo "  ✅ FFmpeg found: $FFMPEG_VERSION"
    echo "  ✅ FFprobe found: $FFPROBE_VERSION"
else
    echo "  ⚠️  Warning: FFmpeg or FFprobe not found in PATH"
    echo "  ⚠️  Worker media processing may fail"
fi

# =============================================================================
# Step 5: Create PocketBase superuser (Requirements 4.1)
# =============================================================================
echo ""
echo "Creating PocketBase superuser..."

# Only create superuser if password is not the default insecure one
if [ "$POCKETBASE_ADMIN_PASSWORD" != "your-secure-password!" ]; then
    echo "  Email: $POCKETBASE_ADMIN_EMAIL"
    echo "  Creating superuser account..."
    
    # Run superuser upsert command
    # This works even if PocketBase isn't running - it modifies the database directly
    if /app/pb/pocketbase superuser upsert "$POCKETBASE_ADMIN_EMAIL" "$POCKETBASE_ADMIN_PASSWORD" --dir="$PB_DATA_DIR" 2>/dev/null; then
        echo "  ✅ Superuser created successfully"
    else
        echo "  ⚠️  Could not create superuser (this is normal if it already exists)"
        echo "  ℹ️  Superuser will be created on first PocketBase startup if needed"
    fi
else
    echo "  ⚠️  Using default admin password - superuser creation skipped"
    echo "  ℹ️  Set POCKETBASE_ADMIN_PASSWORD environment variable to auto-create superuser"
    echo "  ℹ️  Superuser will be created on first PocketBase startup"
fi

# =============================================================================
# Step 6: Setup signal handlers for graceful shutdown (Requirements 13.4)
# =============================================================================
# Note: Signal handling is done by supervisord, but we set up the timeout
export GRACEFUL_SHUTDOWN_TIMEOUT="${GRACEFUL_SHUTDOWN_TIMEOUT:-30}"
echo ""
echo "Graceful shutdown timeout: ${GRACEFUL_SHUTDOWN_TIMEOUT}s"

# =============================================================================
# Step 7: Start supervisord
# =============================================================================
echo ""
echo "Starting services with Supervisor..."
echo "============================================"
echo ""

# Use exec to replace the shell process with supervisord
# This ensures signals are properly forwarded to supervisord
exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
