# Docker Deployment

This directory contains Docker configuration for deploying the Next.js + PocketBase + Worker monorepo as a monolithic container with Nginx as a reverse proxy and Supervisor for process management.

## Architecture

The container uses:
- **Supervisor**: Manages PocketBase, Next.js, Worker, and Nginx processes
- **Nginx**: Reverse proxy that routes requests to the appropriate service
- **PocketBase**: Backend API and admin UI (internal port 8090)
- **Next.js**: Frontend application (internal port 3000)
- **Worker**: Background task processor for media processing

## Building the Image

From the root of the monorepo:

```bash
docker build -f docker/Dockerfile -t next-pb:latest .
```

Or with build arguments for PocketBase version:

```bash
docker build -f docker/Dockerfile \
  --build-arg POCKETBASE_VERSION=0.35.0 \
  -t next-pb:latest .
```

### Multi-Architecture Builds

The Dockerfile supports building for multiple architectures using Docker's `TARGETARCH` build argument. This is automatically set when using `docker buildx` for multi-platform builds.

#### Building for a Specific Architecture

```bash
# Build for AMD64 (x86_64)
docker build -f docker/Dockerfile \
  --build-arg TARGETARCH=amd64 \
  -t next-pb:amd64 .

# Build for ARM64 (Apple Silicon, AWS Graviton)
docker build -f docker/Dockerfile \
  --build-arg TARGETARCH=arm64 \
  -t next-pb:arm64 .
```

#### Building Multi-Platform Images with Docker Buildx

For building and pushing multi-architecture images to a registry:

```bash
# Create a buildx builder (one-time setup)
docker buildx create --name multiarch --use

# Build and push multi-platform image
docker buildx build -f docker/Dockerfile \
  --platform linux/amd64,linux/arm64 \
  --build-arg POCKETBASE_VERSION=0.35.0 \
  -t ghcr.io/your-org/next-pb:latest \
  --push .
```

#### Supported Architectures

| Architecture | Docker Platform | Use Case |
|-------------|-----------------|----------|
| `amd64` | `linux/amd64` | Standard x86_64 servers, Intel/AMD CPUs |
| `arm64` | `linux/arm64` | Apple Silicon Macs, AWS Graviton, Raspberry Pi 4+ |

The PocketBase binary is automatically downloaded for the target architecture during the build process.

## Running the Container

```bash
docker run -p 8888:80 next-pb:latest
```

This will start all services behind Nginx:
- **Application**: http://localhost:8888 (routes to Next.js)
- **PocketBase API**: http://localhost:8888/api/
- **PocketBase Admin**: http://localhost:8888/_/

## Persistent Data

To persist PocketBase data and worker temporary files across container restarts, mount volumes:

```bash
docker run -p 8888:80 \
  -v $(pwd)/pb_data:/app/pb/pb_data \
  -v $(pwd)/worker_data:/app/data \
  next-pb:latest
```

### Staging with Docker Volumes

For staging environments, the project uses named Docker volumes for persistent data. This provides better portability and easier management compared to bind mounts.

**Available staging volume commands:**

```bash
# Create staging volumes (run once, or they'll be auto-created on first run)
yarn staging:volumes:create

# List staging volumes
yarn staging:volumes:ls

# Inspect staging volumes (see mount points, size, etc.)
yarn staging:volumes:inspect

# Remove staging volumes (data will be lost)
yarn staging:volumes:rm
```

**Staging workflow:**

```bash
# Build and run staging (volumes are auto-created if they don't exist)
yarn staging:up

# View logs
yarn staging:logs

# Stop staging container
yarn staging:stop

# Clean up everything (container, image, and volumes)
yarn staging:clean:all
```

The staging setup uses two named volumes:
- `next-pb-staging-pb-data`: Stores PocketBase database and files
- `next-pb-staging-worker-data`: Stores worker temporary processing files

**Note:** Volumes persist data even when containers are removed. Use `yarn staging:volumes:rm` to delete volumes and start fresh.

## Environment Variables

The container supports extensive configuration through environment variables. All variables have sensible defaults.

### PocketBase Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `POCKETBASE_URL` | `http://localhost:8090` | PocketBase server URL |
| `POCKETBASE_ADMIN_EMAIL` | `admin@example.com` | Admin email for PocketBase superuser |
| `POCKETBASE_ADMIN_PASSWORD` | `your-secure-password` | Admin password for PocketBase superuser |
| `PB_DATA_DIR` | `/app/pb/pb_data` | Directory for PocketBase data storage |
| `PB_PUBLIC_DIR` | `/app/webapp/.next` | Directory for PocketBase public/static files |

**Automatic Superuser Creation:**

The container automatically creates a PocketBase superuser on startup if `POCKETBASE_ADMIN_PASSWORD` is set to a non-default value. This prevents the need to manually create the first admin account through the web interface.

- If `POCKETBASE_ADMIN_PASSWORD` is set to a secure password, the superuser is created automatically using `POCKETBASE_ADMIN_EMAIL`
- If using the default password (`your-secure-password`), PocketBase will prompt for manual superuser creation on first startup
- The superuser is created using PocketBase's `superuser upsert` command, which works even when PocketBase isn't running

### Worker Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WORKER_DATA_DIR` | `/app/data` | Directory for worker temporary data |
| `WORKER_MAX_RETRIES` | `3` | Maximum retry attempts for failed tasks (0-10) |
| `WORKER_PROVIDER` | `ffmpeg` | Media processing provider (`ffmpeg` or `google`) |
| `WORKER_POLL_INTERVAL` | `5000` | Task queue poll interval in ms (1000-60000) |

### S3 Storage Configuration (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `S3_ENDPOINT` | - | S3-compatible storage endpoint URL |
| `S3_ACCESS_KEY` | - | S3 access key ID |
| `S3_SECRET_KEY` | - | S3 secret access key |
| `S3_BUCKET` | - | S3 bucket name |
| `S3_REGION` | `us-east-1` | S3 region |

### Monitoring & Logging

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Log level (`debug`, `info`, `warn`, `error`) |
| `METRICS_ENABLED` | `false` | Enable Prometheus metrics endpoint |
| `HEALTH_CHECK_PORT` | `8090` | Port for health check endpoint |

### Container Behavior

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Node environment |
| `GRACEFUL_SHUTDOWN_TIMEOUT` | `30` | Shutdown timeout in seconds (5-300) |

### Example with All Options

```bash
docker run -p 8888:80 \
  -e POCKETBASE_URL=http://localhost:8090 \
  -e POCKETBASE_ADMIN_EMAIL=admin@example.com \
  -e POCKETBASE_ADMIN_PASSWORD=your-secure-password \
  -e PB_DATA_DIR=/app/pb/pb_data \
  -e WORKER_PROVIDER=ffmpeg \
  -e LOG_LEVEL=debug \
  -e GRACEFUL_SHUTDOWN_TIMEOUT=60 \
  -v $(pwd)/pb_data:/app/pb/pb_data \
  -v $(pwd)/worker_data:/app/data \
  next-pb:latest
```

**Note:** Set `POCKETBASE_ADMIN_PASSWORD` to a secure password to automatically create the PocketBase superuser on first startup. If not set or using the default, you'll need to create the superuser manually through the web interface.

## Configuration Files

- **`Dockerfile`**: Multi-stage build configuration
- **`supervisord.conf`**: Supervisor configuration for process management
- **`nginx.conf`**: Nginx reverse proxy configuration
- **`start.sh`**: Startup script that launches Supervisor
- **`graceful-shutdown.sh`**: Script for graceful container shutdown

## Environment Validation

The container validates environment variables on startup using the shared schema from `shared/src/env.ts`. If validation fails, the container will exit with clear error messages indicating which variables are invalid.

### Validation Features

- **Type checking**: Ensures values match expected types (string, number, boolean, enum)
- **Range validation**: Validates numeric ranges (e.g., WORKER_MAX_RETRIES: 1-10)
- **Default values**: Applies sensible defaults for optional variables
- **Clear error messages**: Provides helpful hints for fixing configuration issues

### Example Validation Output

```
=== Environment Validation ===

✓ Environment validation passed

Configuration Summary:
  PocketBase:
    - Data Directory: /app/pb/pb_data
    - Public Directory: /app/webapp/.next
    - URL: http://localhost:8090

  Worker:
    - Data Directory: /app/data
    - Concurrency: 2
    - Max Retries: 3
    - Provider: ffmpeg
    - Poll Interval: 5000ms

  Container:
    - Node Environment: production
    - Log Level: info
    - Graceful Shutdown Timeout: 30s
    - Metrics Enabled: false
```

## Graceful Shutdown

The container supports graceful shutdown when receiving SIGTERM or SIGINT signals. This ensures:

1. **Nginx** stops accepting new connections first
2. **Worker** completes current tasks before stopping
3. **Next.js** drains existing connections
4. **PocketBase** closes database connections cleanly

### Shutdown Timeout

Configure the graceful shutdown timeout via environment variable:

```bash
docker run -p 8888:80 \
  -e GRACEFUL_SHUTDOWN_TIMEOUT=60 \
  next-pb:latest
```

Default timeout is 30 seconds. Range: 5-300 seconds.

## Nginx Routing

The Nginx configuration routes requests as follows:

- `/api/` → PocketBase API (port 8090)
- `/_/` → PocketBase Admin UI (port 8090)
- `/health` → PocketBase health check
- `/` → Next.js application (port 3000)

## Process Management

Supervisor manages four processes:

1. **pocketbase**: Runs PocketBase server
2. **nextjs**: Runs Next.js production server
3. **worker**: Runs background task processor
4. **nginx**: Runs Nginx reverse proxy

All processes are automatically restarted if they crash.

## Ports

- **8888** (host) → **80** (container): Nginx (main entry point, default host port is 8888)
- **3000**: Next.js (internal, proxied by Nginx)
- **8090**: PocketBase (internal, proxied by Nginx)

## Logs

Supervisor logs are available at:
- `/var/log/supervisor/supervisord.log` - Supervisor main log
- `/var/log/supervisor/pocketbase.out.log` - PocketBase stdout
- `/var/log/supervisor/pocketbase.err.log` - PocketBase stderr
- `/var/log/supervisor/nextjs.out.log` - Next.js stdout
- `/var/log/supervisor/nextjs.err.log` - Next.js stderr
- `/var/log/supervisor/worker.out.log` - Worker stdout
- `/var/log/supervisor/worker.err.log` - Worker stderr
- `/var/log/supervisor/nginx.out.log` - Nginx stdout
- `/var/log/supervisor/nginx.err.log` - Nginx stderr

View logs inside the container:
```bash
docker exec <container-id> tail -f /var/log/supervisor/supervisord.log
```

## CI/CD Pipeline

The project includes automated Docker image building and publishing via GitHub Actions.

### Automated Builds

Docker images are automatically built and published when:

1. **Release Published**: When a new release is created via release-please
2. **Version Tags**: When a version tag (e.g., `v1.0.0`) is pushed
3. **Manual Trigger**: Via workflow dispatch for testing

### Image Registry

Images are published to GitHub Container Registry (ghcr.io):

```bash
# Pull the latest release
docker pull ghcr.io/YOUR_ORG/YOUR_REPO:latest

# Pull a specific version
docker pull ghcr.io/YOUR_ORG/YOUR_REPO:1.0.0
```

### Image Tags

Each release produces multiple tags:

| Tag Pattern | Example | Description |
|-------------|---------|-------------|
| `{version}` | `1.0.0` | Full semantic version |
| `{major}.{minor}` | `1.0` | Major.minor version |
| `{major}` | `1` | Major version only |
| `latest` | `latest` | Latest stable release |
| `sha-{commit}` | `sha-abc1234` | Git commit SHA |

### Security Scanning

All published images are automatically scanned for vulnerabilities using Trivy:

- **Container Image Scan**: Scans the built Docker image for OS and library vulnerabilities
- **Filesystem Scan**: Scans the source code for security issues
- **Results**: Uploaded to GitHub Security tab for review

### Workflow Files

- `.github/workflows/docker-build.yml` - Main Docker build and publish workflow
- `.github/workflows/release-please.yml` - Release automation with deployment instructions

### Manual Build Trigger

To manually trigger a Docker build (for testing):

1. Go to Actions → Docker Build and Publish
2. Click "Run workflow"
3. Optionally enable "Push image to registry"
4. Click "Run workflow"

## Notes

- The PocketBase data directory (`pb_data`) is created at runtime and should be persisted via volumes in production
- The worker data directory (`data`) stores temporary processing files and should be persisted for reliability
- Services run as appropriate users: `nextjs` for app processes, `nginx` for nginx, `root` for supervisor
- PocketBase hooks and migrations are included in the image
- The shared package is built and included in the final image
- Nginx includes WebSocket support for PocketBase real-time features
- Static files are cached for better performance
- FFmpeg is included for media processing by the worker service
- Multi-architecture builds are supported for linux/amd64 and linux/arm64

