# Environment Prep and Foundations

## Objectives
- Stand up the baseline repo so uploads, processing, and PocketBase schemas can be developed safely.
- Wire core dependencies: FFmpeg, Google Cloud Transcoder + Video Intelligence + Speech-to-Text, and S3-compatible storage.
- Establish a task runner skeleton and shared types for media, clips, labels, files, and tasks.

## Outcomes
- Local dev flows for Next.js + PocketBase + worker run without manual hacks.
- Secrets/config layout for Google Cloud and S3 is documented and validated.
- Core collections exist in PocketBase (Upload, File, Media, MediaClip, MediaLabel, Task) with migrations checked in.
- Worker scaffold can enqueue and process a no-op task, logging progress back to PocketBase.

## Scope
- Tooling/setup only; no user-facing upload UI yet.
- Define schema and task patterns, not full pipelines.
- Basic observability hooks (structured logs, simple health checks).

## Work Plan
- Environment: verify Node/Yarn versions, FFmpeg install, and yarn scripts to start PocketBase + Next.js + worker.
- Credentials: define `.env.local` templates for app, worker, and PocketBase hooks; document required Google service accounts and S3 keys.
- Storage: choose bucket layout (`originals/`, `proxies/`, `thumbnails/`, `sprites/`, `labels/`), plan CDN needs later.
- Collections: add schema definitions and migrations for Upload, File, Media, MediaClip, MediaLabel, Task (fields per overview).
- Task runner: create task types (`process_upload`, `derive_clips`, `detect_labels`, `recommend_clips`), status lifecycle, retry/backoff strategy, and a heartbeat to mark stalled jobs.
- Developer docs: quickstart to run dev stack, seed admin user, and verify a sample task executes.

## Deliverables
- Environment docs and env templates.
- PocketBase migrations for core collections.
- Worker/task runner skeleton with a sample task updating Task.progress.
- Bucket layout doc and naming conventions.

## Risks / Mitigations
- Credential sprawl: use separate env files for frontend/worker/hook; avoid hardcoding bucket names.
- FFmpeg availability: add install check to setup script; pin minimum version.
- Task runner drift: define a shared TaskStatus enum in the shared package to keep UI/worker aligned.

## AI Prompt
```
You are an expert Next.js + PocketBase architect setting up a video processing stack.
Goals: configure FFmpeg, Google Cloud Transcoder + Video Intelligence + Speech-to-Text, and S3-compatible storage; define PocketBase collections (Upload, File, Media, MediaClip, MediaLabel, Task); scaffold a worker that can enqueue and process tasks, updating Task.status/progress.
Deliverables: env templates, migrations for collections, worker skeleton with a sample task, docs to run Next.js + PocketBase + worker locally.
Constraints: client-side PocketBase SDK only; keep tasks idempotent with retry/backoff; bucket layout for originals/proxies/thumbnails/sprites/labels.
Produce: ordered setup steps, sample env files, and minimal code stubs (TypeScript) for schemas and worker entry.
```
