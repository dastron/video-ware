# Next.js + PocketBase Monorepo

A modern full-stack monorepo template combining Next.js frontend with PocketBase backend, managed with Yarn v4 workspaces.

## Project Structure

```
next-pb/
├── app/                       # Next.js frontend application
│   ├── app/                   # Next.js 14+ app directory
│   ├── components/            # React components (shadcn/ui)
│   ├── lib/                   # Utility functions
│   └── hooks/                 # Custom React hooks
├── shared/                    # Shared types, schemas, and utilities
│   ├── src/
│   │   ├── schemas/          # Zod validation schemas
│   │   ├── types/            # TypeScript type definitions
│   │   ├── utils/            # Utility functions
│   │   └── pocketbase/       # PocketBase client configuration
│   └── dist/                 # Compiled JavaScript (generated)
├── pb/                        # PocketBase backend
│   ├── pocketbase*            # PocketBase binary (auto-downloaded)
│   ├── pb_data/              # Database and files (auto-created)
│   └── pb_hooks/             # PocketBase JavaScript hooks
├── scripts/                   # Setup and utility scripts
└── package.json              # Monorepo configuration
```

## Quick Start

### Prerequisites

- Node.js 18+ 
- Yarn v4 (configured via packageManager)

### Setup

1. **Clone and install dependencies:**
   ```bash
   git clone <your-repo>
   cd next-pb
   yarn install
   ```

2. **Setup PocketBase:**
   ```bash
   yarn setup
   ```
   This downloads and configures PocketBase for your platform automatically.
   
   **Optional:** Set environment variables to auto-create a superuser:
   ```bash
   export POCKETBASE_ADMIN_EMAIL=admin@example.com
   export POCKETBASE_ADMIN_PASSWORD=your-secure-password
   yarn setup
   ```
   If credentials are provided, the superuser will be created automatically.

3. **Start development servers:**
   ```bash
   yarn dev
   ```
   This starts both Next.js (port 3000) and PocketBase (port 8090) concurrently.

4. **Create PocketBase admin account (if not auto-created):**
   ```bash
   yarn pb:admin
   ```
   Follow the prompts to create your admin account, then visit http://localhost:8090/_/

## Available Scripts

### Root Level Commands

- `yarn setup` - Download and setup PocketBase binary
- `yarn dev` - Start both Next.js and PocketBase in development mode
- `yarn build` - Build the shared package and Next.js application for production
- `yarn lint` - Run ESLint on all workspaces
- `yarn lint:fix` - Run ESLint with auto-fix on all workspaces
- `yarn lint:app` - Run ESLint on app workspace only
- `yarn lint:shared` - Run ESLint on shared workspace only
- `yarn clean` - Clean build artifacts and PocketBase data
- `yarn install:all` - Install all dependencies
- `yarn typegen` - Generate TypeScript types from PocketBase schema

### PocketBase Commands

- `yarn pb:dev` - Start PocketBase in development mode (auto-restart)
- `yarn pb:serve` - Start PocketBase in production mode
- `yarn pb:admin` - Create/manage admin accounts

### Next.js Commands

- `yarn lint:app` - Run ESLint on Next.js app (recommended)
- `yarn workspace webapp dev` - Start Next.js dev server only
- `yarn workspace webapp build` - Build Next.js app

### Shared Package Commands

- `yarn lint:shared` - Run ESLint on shared package (recommended)
- `yarn workspace shared build` - Build shared TypeScript package
- `yarn workspace shared dev` - Watch mode for shared package
- `yarn workspace shared typegen` - Generate types from PocketBase schema
- `yarn workspace shared migrate:generate` - Generate database migration
- `yarn workspace shared migrate:status` - Check migration status

## Configuration

### ESLint

The monorepo uses a centralized ESLint configuration (`eslint.config.mjs`) that:
- Supports TypeScript across all workspaces
- Provides React/Next.js specific rules for the app workspace
- Allows console usage in the shared workspace
- Handles browser and Node.js globals appropriately

Run linting commands:
```bash
yarn lint          # Lint all workspaces
yarn lint:fix      # Auto-fix issues across all workspaces
yarn lint:app      # Lint only the Next.js app
yarn lint:shared   # Lint only the shared package
```

### PocketBase

- **Admin UI:** http://localhost:8090/_/
- **API Base:** http://localhost:8090/api/
- **Data Directory:** `./pb/pb_data/`
- **Hooks Directory:** `./pb/pb_hooks/`

### Next.js

- **Dev Server:** http://localhost:3000
- **Built with:** App Router, TypeScript, Tailwind CSS, shadcn/ui
- **Components:** Pre-configured with shadcn/ui component library

## Development Workflow

1. **Backend Development:**
   - Modify database schema via PocketBase Admin UI
   - Add custom logic in `./pb/pb_hooks/main.pb.js`
   - Use PocketBase's built-in auth, file storage, and real-time features

2. **Frontend Development:**
   - Build React components in `./webapp/components/`
   - Create pages in `./webapp/app/`
   - Use mutators from `@project/shared` for all PocketBase data operations
   - All PocketBase operations are client-side only (no SSR)

3. **Full-Stack Features:**
   - Authentication (built into PocketBase)
   - File uploads and storage
   - Real-time subscriptions
   - Custom business logic via hooks

## Tech Stack

### Frontend (Next.js)
- **Framework:** Next.js 14+ with App Router
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4
- **Components:** shadcn/ui (Radix UI primitives)
- **Forms:** React Hook Form + Zod validation
- **Icons:** Lucide React

### Backend (PocketBase)
- **Database:** SQLite (built-in)
- **Auth:** Multi-provider authentication
- **API:** Auto-generated REST + Real-time
- **Admin:** Web-based admin dashboard
- **Hooks:** JavaScript/TypeScript custom logic

### Development
- **Package Manager:** Yarn v4 with workspaces
- **Monorepo:** Yarn workspaces
- **Linting:** ESLint
- **Concurrent:** Run multiple services simultaneously

## Connecting Frontend to Backend

### ⚠️ Important: Use Mutators for All Data Operations

**All PocketBase data operations should use mutators, not direct PocketBase SDK calls.** Mutators provide:
- Type-safe data access
- Automatic validation
- Consistent error handling
- Built-in filtering, sorting, and expansion options

See the [Shared Package README](./shared/README.md) for mutator documentation.

### ⚠️ Important: Client-Side Only (No SSR)

**This project does NOT use Server-Side Rendering (SSR) for PocketBase data.** All PocketBase operations are performed client-side only. This avoids security issues with shared SDK instances and simplifies the architecture.

See [PB_SSR.md](./docs/PB_SSR.md) for detailed information about why SSR is not recommended.

### Using the Shared Package

The monorepo includes a shared workspace with:
- **Collection Definitions**: Type-safe PocketBase collections using `defineCollection()`
- **Mutators**: Type-safe data access classes (use these for all data operations)
- **Schemas**: Zod validation schemas with field helpers
- **Types**: TypeScript type definitions
- **Migrations**: Automatic database migration generation

```typescript
// In your Next.js app - Use mutators for data operations
import { UserMutator } from '@project/shared';
import { pb } from '@/lib/pocketbase'; // Client-side PocketBase instance

// Create a mutator instance
const userMutator = new UserMutator(pb);

// Type-safe data operations
const user = await userMutator.getById('user-id');
const users = await userMutator.getList(1, 10);
const newUser = await userMutator.create({ email, password });
```

**Collection Definition Pattern:**
```typescript
// shared/src/schema/myCollection.ts
import { defineCollection, TextField, baseSchema } from 'pocketbase-zod-schema';

export const MySchema = z.object({
  name: TextField().min(1),
  // ... other fields
}).extend(baseSchema);

export const MyCollection = defineCollection({
  collectionName: 'MyCollection',
  schema: MySchema,
  permissions: { /* ... */ },
});
```

### Database Migrations

The `shared` workspace uses `pocketbase-zod-schema` to generate type-safe migrations:

```bash
# Generate a migration from schema changes
yarn workspace shared migrate:generate

# Check migration status
yarn workspace shared migrate:status
```

**How it works:**
1. Define collections using `defineCollection()` in `shared/src/schema/`
2. Run `migrate:generate` to create migration files
3. Migrations auto-apply when PocketBase restarts
4. Collections, permissions, and indexes are managed from code

See the [Shared Package README](./shared/README.md) for detailed `defineCollection` documentation.

## Adding New Features

### Backend (PocketBase)
1. **Define collections** using `defineCollection()` in `shared/src/schema/`:
   ```typescript
   // shared/src/schema/post.ts
   import { defineCollection, TextField, RelationField, baseSchema } from 'pocketbase-zod-schema';
   
   export const PostSchema = z.object({
     title: TextField().min(1).max(200),
     content: TextField(),
     author: RelationField({ collection: 'Users' }),
   }).extend(baseSchema);
   
   export const PostCollection = defineCollection({
     collectionName: 'Posts',
     schema: PostSchema,
     permissions: {
       listRule: '',
       viewRule: '',
       createRule: '@request.auth.id != "" && author = @request.auth.id',
       updateRule: '@request.auth.id != "" && author = @request.auth.id',
       deleteRule: '@request.auth.id != "" && author = @request.auth.id',
     },
   });
   ```

2. **Generate migrations**: `yarn workspace shared migrate:generate`
3. **Add custom hooks** in `pb_hooks/main.pb.js` for business logic

### Frontend (Next.js)
1. Create API functions in `lib/`
2. Build components in `components/`
3. Add pages in `app/`

## Deployment

### PocketBase
- Deploy binary to your server
- Set environment variables for production
- Configure domain and SSL

### Next.js
- Build: `yarn build`
- Deploy to Vercel, Netlify, or your preferred platform
- Update API URLs for production

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally with `yarn dev`
5. Submit a pull request

## License

MIT License - see LICENSE file for details

---

**Happy coding!**