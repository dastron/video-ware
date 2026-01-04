# Phase 1 — Uploads and Media Ingestion MVP

## Objectives
- Let users upload media through the Next.js app, persist uploads to S3-compatible storage, and track status in PocketBase.
- Automatically enqueue processing to validate media, create previews (thumbnail + sprite), and produce a Media record with at least one initial clip.
- Provide visibility in the UI for upload/progress states and errors.

## Scope
- Single-user/multi-user support using PocketBase auth; simple access control on Upload/Media/File.
- Upload flows (browser) with resumable/multipart support if available; fall back to chunked upload.
- Background task: `process_upload` to probe media, generate thumbnail/sprite, create Media, seed initial MediaClip (full duration).
- No advanced editing, detection, or recommendations yet.

## Deliverables
- Next.js upload UI with progress, error handling, and post-upload success state.
- PocketBase mutations (mutators) for Upload and File creation; hooks to enqueue `process_upload`.
- Worker implementation for `process_upload` with FFmpeg-driven thumbnail + sprite generation, proxy handling optional.
- Media record persisted with mediaData (duration, codec, dimensions), thumbnailURL, spriteURL, and initial MediaClip.
- Basic activity/status feed showing Upload and Task states.

## Work Plan
- Frontend: build upload component, progress polling via PocketBase real-time; handle drag-drop and file picker.
- Storage: write originals to S3 under `originals/{uploadId}/{filename}`; capture ETag/metadata.
- PocketBase: finalize schemas for Upload/File/Media/MediaClip; validation rules and permissions.
- Worker: FFmpeg probe for duration/dimensions; generate thumbnail (frame at mid), sprite sheet (configurable cadence/cols/rows), and optional proxy; write assets to `thumbnails/` and `sprites/`.
- Task lifecycle: Task.status transitions (queued -> running -> success/failure), progress updates, error logging stored on Task.
- UX: surface statuses, retries, and links to generated previews.
- QA: tests for upload flow, task success/failure paths, and schema validation (unit/integration where feasible).

## Open Questions
- Required max upload size/duration for phase 1.
- Minimum sprite cadence and dimensions (impacts storage and UI).
- Should proxy generation be mandatory or only on certain codecs?

## AI Prompt for This Phase
```
You are building Phase 1 of a Next.js + PocketBase app focused on uploads.
Implement: browser upload UI with progress; PocketBase mutators for Upload + File creation; hook to enqueue a `process_upload` Task; worker code to probe media with FFmpeg, generate thumbnail and sprite, store assets to S3, and create Media + initial MediaClip.
Constraints: use client-side PocketBase SDK; keep Task lifecycle queued/running/success/failure with progress updates; store asset URLs in Media.thumbnailURL and Media.spriteURL; originals live under originals/{uploadId}/.
Produce: component and API interaction outline, schema/migration snippets, worker task handler outline, and testing notes for upload + processing paths.
```
