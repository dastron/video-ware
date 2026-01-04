# Phase 3 — Detection, Labeling, and Media Processing

## Objectives
- Integrate Google Cloud detection services (object/shot/person tracking, speech when needed) to extract metadata from Media.
- Store raw API JSON responses and upsert normalized MediaLabel rows with versioning per Media.
- Track long-running detection jobs via Tasks, with retry/backoff and observability.
- Expose labels in the UI for search/filter and for future recommendations.

## Scope
- Task types: `detect_labels` (primary), `derive_clips` (from shots/objects if desired), `reprocess_labels` (version bump).
- Data: persist raw detector JSON under `labels/{mediaId}/{version}.json`; upsert MediaLabel rows (labelType, ranges, confidence, labelData with Base* fragments).
- UI: basic label browser per Media (list, time ranges), filter by labelType/confidence, jump-to-time preview using sprites/proxy.
- Versioning: increment processingVersion on Media; store TaskRef on labels for traceability; keep last successful version.
- Optional: auto-create clips from shot/scene boundaries.

## Deliverables
- Worker handlers to call Google APIs (Video Intelligence, Transcoder if needed) and map responses to MediaLabel records.
- PocketBase schema updates: MediaLabel versioning fields, source/provider fields, TaskRef relations; Task enhancements for retries and error logs.
- Storage conventions for raw JSON detector output in S3.
- UI surfacing labels with filtering and timestamp scrubbing.
- Docs for adding new detector providers later.

## Work Plan
- API integration: configure service accounts/keys; define request payloads per detector; wrap in idempotent worker functions.
- Mapping: translate detector frames/segments to MediaLabel rows using BaseSegmentFragment/BaseFrameFragment/BaseEntityFragment/BaseReferenceFragment; ensure offsets stored in consistent units.
- Versioning policy: define when to overwrite vs append; keep latest version pointer on Media; mark stale labels when reprocessing.
- Performance: batch inserts/updates to PocketBase; limit per-media concurrency; paginate label queries in UI.
- Observability: task metrics (duration, retry count), structured logs with mediaId/taskId/provider.
- QA: fixtures from Google responses, unit tests for mapping to MediaLabel, integration tests for task success/failure.

## Open Questions
- Minimum confidence threshold per labelType?
- How to handle overlapping label segments (keep all vs collapse)?
- Should shot detection always create MediaClips automatically?
- Rate limits and cost controls for API calls.

## AI Prompt for This Phase
```
You are implementing Phase 3 (detection/labeling) for the Next.js + PocketBase app.
Implement: worker task `detect_labels` that calls Google Video Intelligence (object/shot/person, speech optional), stores raw JSON in S3 under labels/{mediaId}/{version}.json, and upserts MediaLabel rows with labelType/duration/start/end/confidence/labelData and provider info; bump Media.processingVersion and link TaskRef; add simple UI to list labels and scrub to time ranges.
Constraints: idempotent tasks with retry/backoff; consistent time units; keep previous label versions accessible; client-side PocketBase SDK for UI.
Produce: handler outline for API calls and mapping, schema/migration snippets for MediaLabel/Task updates, storage layout, and tests/fixtures to verify mapping from sample Google responses.
```
