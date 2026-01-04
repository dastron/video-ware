# Uploads and Media Ingestion

This stage establishes a reliable upload flow, storage conventions, and a background processing pipeline that produces browser-friendly previews (thumbnail + sprite) and normalized `Media` metadata.

## Desired Outcomes
- Users can upload videos (and later audio/images) via the Next.js app.
- Upload state is tracked in PocketBase and reflected in the UI in real-time.
- Originals and derived assets are stored in S3-compatible storage (either directly or via PocketBase’s S3 storage backend).
- A background task (`process_upload`) turns an uploaded file into:
  - a `Media` record with normalized metadata (duration, codec, dimensions)
  - a thumbnail asset
  - a sprite sheet asset
  - an initial “full-range” `MediaClip`

## Non-Goals
- Detection/labeling, recommendations, and advanced editing.
- Multi-track timelines.
- Full export/render pipeline (only task stubs and editList generation later).

## Reference Architecture (repo-aligned)
The webapp already follows a layered approach:
- `webapp/src/lib/pocketbase.ts` creates the PocketBase client.
- `webapp/src/mutators/*` implement collection CRUD with consistent patterns.
- `webapp/src/services/*` wrap business workflows.
- `webapp/src/contexts/*` and `webapp/src/hooks/*` expose state + subscriptions to components.

Use this same structure for uploads/media.

## Collections (PocketBase)
Create these collections in PocketBase (Admin UI), with rules appropriate to your auth model, but always scoped through a workspace (shared ownership).

Minimum collections:
- `workspaces`: top-level tenant boundary for all operations.
- `workspace_members`: maps users to workspaces and roles.
- `uploads`: tracks the user intent and upload lifecycle.
- `files`: tracks stored assets (original, thumbnail, sprite, proxy, labels json, renders).
- `media`: normalized media object pointing to derived preview assets.
- `media_clips`: ranges within a media object.
- `tasks`: job queue for long-running work (process upload, render, detect, etc.).

### Workspace
Suggested fields:
- `name` (text)
- `slug` (text, unique; optional)
- `settings` (json; optional)

### Workspace Members
Suggested fields:
- `WorkspaceRef` (relation to `workspaces`)
- `UserRef` (relation to auth user)
- `role` (select; `WorkspaceRole` from `@project/shared/enums`)

### Uploads
Suggested fields:
- `name` (text)
- `size` (number)
- `status` (select; use `UploadStatus` from `@project/shared/enums`)
- `originalFile` (file) OR a `fileRef` relation into `files` (pick one; keep it simple initially)
- `WorkspaceRef` (relation to `workspaces`)
- `createdBy` (relation to auth user; optional audit)

### Files
Suggested fields:
- `name` (text)
- `size` (number)
- `status` (select; `FileStatus`)
- `fileType` (select; `FileType`)
- `fileSource` (select; `FileSource`)
- `blob` (file) if using PocketBase as the file gateway
- `s3Key` (text) if storing by key and generating URLs yourself
- `meta` (json) for codec/dimensions/etc
- relations: `WorkspaceRef`, `uploadRef?`, `mediaRef?`, `taskRef?`

### Media
Suggested fields:
- `WorkspaceRef` (relation)
- `UploadRef` (relation)
- `mediaType` (select; `MediaType`)
- `duration` (number; seconds as float or ms as int, choose one and standardize)
- `mediaData` (json) for probe output (codec, fps, width/height)
- `thumbnailURL` (url) or a relation to `files`
- `spriteURL` (url) or a relation to `files`
- `processingVersion` (number; start at 1)

### Media Clips
Suggested fields:
- `WorkspaceRef` (relation)
- `MediaRef` (relation)
- `clipType` (select; `ClipType`)
- `start`, `end`, `duration` (numbers)
- `clipData` (json)

### Tasks
Suggested fields:
- `type` (select; `TaskType`)
- `status` (select; `TaskStatus`)
- `progress` (number 0–100)
- `attempts` (number)
- `payload` (json)
- `result` (json)
- `errorLog` (text)
- relations: `WorkspaceRef`, `UploadRef?`, `MediaRef?`, `createdBy?`

## Storage Strategy 

### PocketBase configured to S3 storage
PocketBase can use S3-compatible storage for file fields:
- Configure in PocketBase Admin UI: `Settings -> Files storage`
- This keeps browser uploads simple (upload to PB), while the bytes end up in S3.
Reference: `docs/PB_UPLOADS.md`

## Implementation Guide (step-by-step)

### 1) Add upload feature scaffolding in the webapp
- Create feature folders:
  - `webapp/src/components/uploads/*` (UI)
  - `webapp/src/mutators/upload.ts`, `webapp/src/mutators/file.ts`, `webapp/src/mutators/media.ts`, `webapp/src/mutators/task.ts`
  - `webapp/src/services/upload.ts` for orchestration (create upload record, attach file, watch task)
  - Optional: `webapp/src/contexts/upload-context.tsx` + hook for state + realtime subscription
- Reuse the patterns used by `webapp/src/mutators/todo.ts` and `webapp/src/services/auth.ts`.

### 2) Upload UI behavior
Minimal UI requirements:
- file picker + drag/drop
- client-side validation (type, max size)
- progress (bytes uploaded) + server-side status (`Upload.status`)
- post-upload state:
  - show thumbnail/sprite once available
  - show processing progress + error details on failure

Recommended route:
- Create a page: `webapp/src/app/uploads/page.tsx` with an upload panel and a list view.

### 3) Write records and bytes
If using PocketBase file fields:
- Create `uploads` record with `status=uploading`.
- Upload bytes using FormData to the `uploads` record (or create with file on initial create).
- On success:
  - set `status=uploaded`
  - enqueue a `tasks` record of type `process_upload` with payload pointing at the upload/file identifiers.

### 4) Task enqueue location
Choose one:
- **Webapp service**: after upload completes, create the Task from the client.
- **PocketBase hook**: when an Upload changes to `uploaded`, a hook creates the Task.

Hook-based enqueue is more reliable (harder to forget and easier to enforce), but client-based is faster to iterate initially.

### 5) Processing worker contract (even before implementation)
Define the `process_upload` contract in `Task.payload` and `Task.result`:
- payload:
  - `uploadId`
  - `originalFileRef` or PB file path
  - `sprite` config (fps/cadence, cols/rows, tile size)
  - `thumbnail` config (timestamp selection)
- result:
  - `mediaId`
  - derived `fileIds` and/or `thumbnailURL`/`spriteURL`
  - probe output summary

Worker steps (logic-level, not code):
- Probe with FFmpeg/ffprobe (duration, dimensions, codec).
- Generate:
  - `thumbnail` (single frame, mid-point or configurable timestamp)
  - `sprite sheet` (fixed cadence; keep it small enough for hover previews)
  - optional `proxy` (lower bitrate/resolution) if needed for playback
- Store assets (S3 via PB storage or direct S3).
- Create/Update:
  - `media` record with metadata + preview URLs/refs
  - `media_clips` full-range clip
  - `files` records for each derived artifact (if using a file table)
- Update `upload.status` to `ready` (or `failed` with error details).

### 6) Idempotency and retries
Tasks must be re-runnable without duplication:
- If a `Media` already exists for an Upload, update it rather than creating a second.
- Name derived outputs deterministically (based on uploadId + config + version).
- If thumbnails/sprites exist, skip regeneration unless configuration changed.
- Use `Task.attempts` + exponential backoff; persist a readable `errorLog`.

## Acceptance Criteria
- Uploading a video creates an Upload record and stores bytes in S3-compatible storage.
- A Task is created automatically when upload completes.
- Once processing completes, the UI shows:
  - media metadata (duration, dimensions)
  - thumbnail image
  - sprite sheet available for hover/scrub preview
- Failure states are visible and actionable (retry or re-upload).

## Testing Checklist
- Unit: input validation, task payload formatting, status transition helpers.
- Integration: upload -> task created -> records updated (can be mocked if worker is not implemented yet).
- UX: upload cancel, network failure, large file, unsupported codec.

## AI Prompt
```
You are building a Next.js + PocketBase app for media uploads and ingestion.
Implement: upload UI with progress; PocketBase mutators/services that create Upload/File/Task records; automatic enqueue of a `process_upload` task after upload completes; a worker contract for `process_upload` that probes media and generates thumbnail + sprite outputs; persistence of a Media record and an initial full-range MediaClip.
Constraints: align with existing webapp layering (lib -> mutators -> services -> contexts/hooks -> components); store assets in S3-compatible storage (prefer PocketBase S3 storage backend); tasks must be idempotent and report progress/status/errors.
Produce: file/route structure, PocketBase collection setup checklist, task payload/result shapes, and a testing checklist.
```
