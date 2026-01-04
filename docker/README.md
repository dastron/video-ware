# Docker Deployment

This directory contains Docker configuration for deploying the Next.js + PocketBase monorepo as a monolithic container with Nginx as a reverse proxy and Supervisor for process management.

## Architecture

The container uses:
- **Supervisor**: Manages PocketBase, Next.js, and Nginx processes
- **Nginx**: Reverse proxy that routes requests to the appropriate service
- **PocketBase**: Backend API and admin UI (internal port 8090)
- **Next.js**: Frontend application (internal port 3000)

## Building the Image

From the root of the monorepo:

```bash
docker build -f docker/Dockerfile -t next-pb:latest .
```

Or with build arguments for PocketBase version:

```bash
docker build -f docker/Dockerfile \
  --build-arg POCKETBASE_VERSION=0.32.4 \
  --build-arg POCKETBASE_ARCH=amd64 \
  -t next-pb:latest .
```

## Running the Container

```bash
docker run -p 80:80 next-pb:latest
```

This will start all services behind Nginx:
- **Application**: http://localhost (routes to Next.js)
- **PocketBase API**: http://localhost/api/
- **PocketBase Admin**: http://localhost/_/

## Persistent Data

To persist PocketBase data across container restarts, mount a volume:

```bash
docker run -p 80:80 \
  -v $(pwd)/pb_data:/app/pb/pb_data \
  next-pb:latest
```

## Environment Variables

You can pass environment variables to configure the application:

```bash
docker run -p 80:80 \
  -e NEXT_PUBLIC_POCKETBASE_URL=http://localhost/api \
  -e NODE_ENV=production \
  next-pb:latest
```

## Configuration Files

- **`Dockerfile`**: Multi-stage build configuration
- **`supervisord.conf`**: Supervisor configuration for process management
- **`nginx.conf`**: Nginx reverse proxy configuration
- **`start.sh`**: Startup script that launches Supervisor

## Nginx Routing

The Nginx configuration routes requests as follows:

- `/api/` → PocketBase API (port 8090)
- `/_/` → PocketBase Admin UI (port 8090)
- `/health` → PocketBase health check
- `/` → Next.js application (port 3000)

## Process Management

Supervisor manages three processes:

1. **pocketbase**: Runs PocketBase server
2. **nextjs**: Runs Next.js production server
3. **nginx**: Runs Nginx reverse proxy

All processes are automatically restarted if they crash.

## Ports

- **80**: Nginx (main entry point)
- **3000**: Next.js (internal, proxied by Nginx)
- **8090**: PocketBase (internal, proxied by Nginx)

## Logs

Supervisor logs are available at:
- `/var/log/supervisor/supervisord.log` - Supervisor main log
- `/var/log/supervisor/pocketbase.out.log` - PocketBase stdout
- `/var/log/supervisor/pocketbase.err.log` - PocketBase stderr
- `/var/log/supervisor/nextjs.out.log` - Next.js stdout
- `/var/log/supervisor/nextjs.err.log` - Next.js stderr
- `/var/log/supervisor/nginx.out.log` - Nginx stdout
- `/var/log/supervisor/nginx.err.log` - Nginx stderr

View logs inside the container:
```bash
docker exec <container-id> tail -f /var/log/supervisor/supervisord.log
```

## Notes

- The PocketBase data directory (`pb_data`) is created at runtime and should be persisted via volumes in production
- Services run as appropriate users: `nextjs` for app processes, `nginx` for nginx, `root` for supervisor
- PocketBase hooks and migrations are included in the image
- The shared package is built and included in the final image
- Nginx includes WebSocket support for PocketBase real-time features
- Static files are cached for better performance

