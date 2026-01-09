# Video Ware Planning Overview

## Product Vision
- Deliver a Next.js web app where users upload media, get resilient backups to S3-compatible storage, and receive fast previews (thumbnails, sprites) while background workers prepare assets.
- Build on PocketBase for collections, real-time updates, and auth, with a lightweight internal task runner to orchestrate long-running media jobs and external AI calls.
- Evolve toward AI-assisted editing: object/shot/person detection, labels, recommendations, and timeline guidance for clip selection.

## Scope and Principles
- Start simple: solid uploads, storage, previews, and metadata before advanced editing.
- Background-first: every heavy operation (transcode, detect, label, recommend) runs via tasks with progress tracking.
- API-friendly: store raw API responses (JSON) plus normalized tables for querying and versioning.
- Observability: log job states, capture errors, track retries; surface status in UI.
- Extensible: design collections so new providers (beyond Google Cloud) and new media types fit later.

## System Architecture (draft)
- Frontend: Next.js App Router, client-side PocketBase SDK, upload UI, progress, previews, clip/timeline editors (later).
- Backend: PocketBase collections + hooks for validation and task enqueues; shared package defines schemas, mutators, and types.
- Storage: S3-compatible bucket for original uploads, derived assets (thumbs, sprites, proxies), and labeled data blobs.
- Workers: Task processor (Node) consuming a task queue in PocketBase; runs FFmpeg and calls Google Cloud APIs (Transcoder, Video Intelligence/object detection, speech-to-text when needed).
- Media pipeline: upload -> create Upload + File -> enqueue ProcessUpload task -> generate Media, thumbnails, sprites, proxy -> derive clips -> run detection/label tasks -> expose labels for recommendations.

## Tenancy Model (Workspace-Scoped)
- All operations occur under a `workspaceRef` (not directly under a user).
- Users participate in workspaces via membership records and roles; permissions and queries should be scoped by `workspaceRef` by default.
- Optional: keep a `createdBy`/`createdByUserRef` field for audit trails, but do not use it for authorization.

## Data Model (initial draft)
- Workspace: name, slug, settings; top-level scope for all resources.
- WorkspaceMember: workspaceRef, userRef, role; drives shared permissions.
- Upload: workspaceRef, name, size, status; links to File records.
- File: workspaceRef, name, size, status, fileType (original/proxy/thumbnail/sprite), fileSource (s3 path), fileData (dimensions, codec), TaskRef?, MediaRef?, UploadRef?.
- Media: workspaceRef, UploadRef, duration, start, end, mediaType (video/audio/image), thumbnailURL, spriteURL, mediaData (codec, fps, dimensions), processingVersion.
- MediaClip: workspaceRef, MediaRef, parentClipRef?, duration, start, end, clipType (range/ai/object/voice/etc), clipData (selection metadata).
- Labelclips: workspaceRef, MediaRef, duration, start, end, labelType (object/shot/person/speech/etc), labelData (payload from detectors), source (google_videointel/transcoder/etc), version, confidence.
- Task: workspaceRef, type, status, progress, priority, attempts, payload, result, errorLog; relations to Upload/Media/Clip where relevant.
- Timeline (timeline feature): name, MediaRef (target output), ordered clip refs, editList blob (see below), render settings.
- ClipRecommendation: workspaceRef, timelineRef?, seedClipRef?, MediaClipRef, score/rank, reason, queryHash, expiresAt, acceptedAt/dismissedAt.
- EditList blob (app-level type): array of segments with `key`, `inputs[]`, `startTimeOffset`, `endTimeOffset` (seconds + nanos) for export and preview assembly.
- Base detector fragments (from Google): BaseSegmentFragment, BaseFrameFragment, BaseReferenceFragment, BaseEntityFragment; store in labelData and normalized Labelclips rows for fast querying.

## Processing Pipelines (happy path)
1) User uploads file -> Upload + File records created, file stored to S3.
2) Task: `process_upload` downloads/streams file, validates media, generates proxy, thumbnails, sprites, and creates a Media record.
3) Task: `derive_clips` (optional) seeds initial clips (full-range clip, detected shots).
4) Task: `detect_labels` calls Google APIs, stores raw JSON, upserts Labelclips entries, increments processing version.
5) Task: `recommend_clips` generates suggested clips based on labels, similarity, and timeline context.
6) UI surfaces statuses, previews, and allows clip/timeline editing; exports use editList to stitch ranges or trigger render tasks.

## External Dependencies
- Google Cloud: Transcoder, Video Intelligence (object/shot/person), Speech-to-Text (later). Store service configs and credentials per environment.
- FFmpeg: thumbnails, sprites, proxies.
- S3-compatible storage: originals, derivatives, and label JSON blobs.

## Risks and Unknowns
- Large file handling: multipart uploads, resumable support, and browser memory constraints.
- Sprite/thumbnail performance: tune tile sizes and cadence; CDN caching strategy.
- Label versioning: policy for reprocessing media when models change; migration of historic labels.
- Task runner reliability: backoff, deduplication, idempotency, and observability.
- Timeline scale: efficient storage of editList and clip ordering for long videos.

## Milestone Map (alignment)
- Foundations: credentials, FFmpeg/Google API integration scaffolding, storage wiring, task runner skeleton.
- Uploads MVP: upload UI, PocketBase collections, S3 writes, processing task to produce Media + previews + initial clip.
- Clips + timelines: CRUD for clips, timeline composition, editList representation, basic export simulation.
- Detection + labeling: integrate Google detectors, store raw JSON, upsert Labelclips, version jobs, surface metadata.
- Timeline recommendations: recommendation engine tied to labels, assistive UI for clip suggestions.

## Gaps to Clarify
- Authentication/tenancy model (multi-user, access to uploads/media/labels).
- Storage classes and retention policies for originals vs derivatives.
- CDN strategy for media assets and sprites.
- Target max file size/duration and performance budgets for previews.
- Export path: browser-side assembly vs server-side render pipeline.
