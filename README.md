# Video Ware

A modern media upload and processing platform built with Next.js, PocketBase, and background workers. Upload media files, get resilient backups to S3-compatible storage, and receive fast previews (thumbnails, sprites) while background workers prepare assets using FFmpeg and Google Cloud APIs.

## 🎯 Product Vision

Video Ware delivers a Next.js web app where users can:
- **Upload media** with progress tracking and validation
- **Get resilient backups** to S3-compatible storage
- **Receive fast previews** (thumbnails, sprites) while processing happens in the background
- **Process media** using FFmpeg and Google Cloud APIs (Transcoder, Video Intelligence)
- **Create and edit clips** with timeline composition
- **Get AI-assisted recommendations** for object/shot/person detection and clip suggestions

## 🏗️ Architecture

- **Frontend**: Next.js 16 with React 19, TypeScript, and Tailwind CSS
- **Backend**: PocketBase for collections, real-time updates, authentication, and API
- **Workers**: Node.js background task processor for media processing (FFmpeg, Google Cloud APIs)
- **Storage**: S3-compatible bucket for originals, derivatives, and metadata
- **Shared Package**: TypeScript types, Zod schemas, and utilities used across the monorepo

## 📦 Monorepo Structure

This is a Yarn v4 workspace monorepo:

```
video-ware/
├── webapp/          # Next.js application (@project/webapp)
├── worker/          # Background worker for media processing
├── shared/          # Shared types, schemas, and utilities (@project/shared)
├── pb/              # PocketBase instance and migrations
└── docker/          # Docker configuration for deployment
```

## 🚀 Quick Start

### Prerequisites

- Node.js >= 22.0.0
- Yarn 4.12.0
- FFmpeg (for media processing)
- Google Cloud credentials (for AI features)

### Installation

1. **Clone and install dependencies:**
   ```bash
   git clone <repository-url>
   cd video-ware
   yarn install
   ```

2. **Setup PocketBase:**
   ```bash
   yarn setup
   ```

3. **Create admin account (optional):**
   ```bash
   export POCKETBASE_ADMIN_EMAIL=admin@example.com
   export POCKETBASE_ADMIN_PASSWORD=your-secure-password
   yarn setup
   ```
   Or create manually:
   ```bash
   yarn pb:admin
   ```

4. **Build shared package:**
   ```bash
   yarn workspace @project/shared build
   ```

5. **Start development:**
   ```bash
   yarn dev
   ```

   This starts:
   - Next.js: http://localhost:3000
   - PocketBase: http://localhost:8090
   - Worker: Background task processor

## 📚 Documentation

- **[Development Guide](docs/DEVELOPMENT.md)** - Comprehensive development documentation
- **[GCVI Configuration Guide](docs/GCVI_CONFIGURATION.md)** - Google Cloud Video Intelligence processor configuration and cost optimization
- **[Planning Overview](planning/overview.md)** - Product vision and architecture details
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Production deployment instructions
- **[PocketBase Docs](docs/)** - PocketBase-specific documentation

## 🛠️ Key Features

### Media Processing Pipeline

1. **Upload** → User uploads file, creates Upload + File records, stores to S3
2. **Process** → Background worker validates media, generates proxy, thumbnails, sprites
3. **Detect** → Google Cloud APIs detect objects, shots, persons, speech
4. **Label** → Store detection results as MediaLabel entries with versioning
5. **Recommend** → Generate clip suggestions based on labels and timeline context

### Workspace-Scoped Tenancy

All operations occur under a `workspaceRef`:
- Users participate in workspaces via membership records
- Permissions and queries are scoped by workspace
- Supports multi-user collaboration

### Background Task Processing

- Resilient task queue in PocketBase
- Progress tracking and error handling
- Retry logic with exponential backoff
- Observability for job states and errors

## 📋 Common Commands

```bash
# Development
yarn dev                              # Start all services
yarn workspace @project/webapp dev    # Next.js only
yarn workspace @project/pb dev        # PocketBase only
yarn workspace @project/worker dev  # Worker only

# Building
yarn build                           # Build all packages
yarn workspace @project/shared build # Build shared package

# Code Quality
yarn lint                            # Lint all workspaces
yarn lint:fix                        # Auto-fix lint issues
yarn typecheck                       # Type check all workspaces
yarn format                          # Format all code

# Testing
yarn test                            # Run all tests
yarn test:watch                      # Watch mode

# Type Generation
yarn typegen                         # Generate types from PocketBase

# Maintenance
yarn clean                           # Clean all build artifacts
yarn setup                           # Reinstall PocketBase
```

## 🔧 Tech Stack

- **Frontend**: Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: PocketBase (Go-based backend-as-a-service)
- **Validation**: Zod schemas
- **Storage**: S3-compatible (configurable)
- **Media Processing**: FFmpeg
- **AI Services**: Google Cloud (Transcoder, Video Intelligence, Speech-to-Text)
- **Package Manager**: Yarn 4.12.0
- **Testing**: Vitest

## 🗂️ Data Model

Key collections:
- **Workspace**: Top-level scope for all resources
- **WorkspaceMember**: User membership and roles
- **Upload**: Upload metadata and status
- **File**: File records (original/proxy/thumbnail/sprite)
- **Media**: Processed media with metadata
- **MediaClip**: Clips derived from media
- **MediaLabel**: AI detection results (objects, shots, persons, etc.)
- **Task**: Background job tracking
- **Timeline**: Composition of clips for editing

See [Planning Overview](planning/overview.md) for detailed schema.

## 🚧 Development Status

This project is in active development. Current focus areas:

- ✅ Monorepo setup and workspace configuration
- ✅ PocketBase integration with shared schemas
- ✅ Basic upload and file management
- 🚧 Media processing pipeline (FFmpeg integration)
- 🚧 Google Cloud API integration
- 🚧 Clip and timeline editing
- 🚧 AI-assisted recommendations

See [Planning Overview](planning/overview.md) for milestone details.

## 🤝 Contributing

1. Read the [Development Guide](docs/DEVELOPMENT.md)
2. Set up your development environment
3. Create a feature branch
4. Make your changes
5. Run tests and linting: `yarn precommit`
6. Submit a pull request

## 📝 License

See [LICENSE](pb/LICENSE.md) for details.

## 🔗 Links

- [PocketBase Documentation](https://pocketbase.io/docs/)
- [Next.js Documentation](https://nextjs.org/docs)
- [Yarn Workspaces](https://yarnpkg.com/features/workspaces)
