# Labels, Search, and Label-Derived Clips

This stage makes labels useful in the product. It introduces (1) reliable label ingestion + versioning, (2) a label-driven search UX, and (3) label-derived `MediaClip` generation so editing can be driven by labels.

## Desired Outcomes
- A `detect_labels` task produces versioned `Labelclips` records and stores raw detector JSON for traceability.
- Users can search/browse labels (by type/entity/time/confidence) and jump playback to relevant timestamps.
- Users can convert label ranges into `MediaClip` records (either automatically or via “Create clip from label”).
- The output is testable without recommendations: a user can build a timeline by searching labels and adding resulting clips.

## Non-Goals
- Recommendation ranking while editing (separate stage).
- Multi-provider abstraction (keep Google first, but design with provider fields so it’s extendable).
- Full render/export pipeline.

## Collections (PocketBase)
This stage assumes existing `media`, `media_clips`, `tasks`, and introduces/extends:

### Workspace scoping (required)
Append `WorkspaceRef` to:
- `label_clips`, `media_clips`, `media`, `uploads`, `files`, `tasks`, `timelines`, `clip_recommendations`

All list/search queries should filter by `workspaceRef` by default.


### `label_clips`
Minimum fields (expand as needed):
- `workspaceRef` (relation)
- `mediaRef` (relation)
- `mediaRef` (relation)
- `labelType` (select; `LabelType`)
- `start`, `end`, `duration` (numbers; choose seconds float or ms int and standardize)
- `confidence` (number)
- `version` (number) — corresponds to `Media.processingVersion`
- `provider` (select; `ProcessingProvider`)
- `labelData` (json) — store normalized fragments and any provider payload needed for UI
- `taskRef` (relation to `tasks`)

### `media_clips` (derived clips)
Use `media_clips` as the durable “thing you can edit with”:
- `clipType` should include values like `shot`, `object`, `person`, `speech`, plus `range` for manual.
- `clipData` should include “source” metadata:
  - `labelId` and/or `{ labelType, entityId, entityDescription }`
  - optional per-frame bbox summaries for UI overlays (keep this compact)

### `tasks`
Add task types if needed:
- `detect_labels`
- optional: `derive_label_clips` (creates clips from selected label types)
- optional: `reprocess_labels` (bumps version + reruns ingestion)

## Storage Conventions
Store raw detector JSON in S3-compatible storage:
- `labels/{mediaId}/v{version}/{provider}.json`
This makes reprocessing and debugging possible without bloating PocketBase rows.

## Processing and Versioning Policy
Define a simple, testable versioning rule:
- `Media.processingVersion` is incremented only after a successful `detect_labels`.
- `label_clips.version` matches the `Media.processingVersion` used to generate it.
- UI defaults to the latest successful version but can display prior versions for debugging.
- Re-runs should be idempotent:
  - if labels for `(mediaId, version, provider)` already exist, upsert/update rather than duplicate.

## UX: Label-Driven Search
The key deliverable is a usable search/browse workflow:

### Search filters (minimum)
- label type (object/person/shot/speech)
- text query (matches `entity_description` or provider label names in `labelData`)
- confidence threshold
- time window (optional)

### Search results should include
- label name + type
- time range (start/end) and duration
- confidence
- “Jump to time” action
- “Create clip from label” action (creates a `MediaClip` if not already created)
- “Add to timeline” shortcut if a timeline is open

## Implementation Guide (step-by-step)

### 1) Define a normalized label mapping
Even if you store raw JSON, define a normalized subset for queries:
- `labelType`
- `entity_id` / `entity_description` (when available)
- `start`, `end`, `duration`
- `confidence`

Keep the raw provider response in S3 and store only what the UI needs in `labelData`.

### 2) Implement `detect_labels` task
Worker logic-level steps:
- Fetch media source reference and duration.
- Call Google Video Intelligence features you can afford initially:
  - start with shot detection + object tracking (person tracking optional)
- Write raw JSON to S3 key path.
- Upsert `label_clips` rows.
- Update `tasks.status/progress/result` and bump `Media.processingVersion` on success.

### 3) Implement label-derived clip creation
Two paths (both testable):
- **Manual**: user clicks “Create clip from label” on a search result.
- **Batch**: a `derive_label_clips` task creates clips for:
  - shots (scene boundaries)
  - tracked objects/person segments over confidence threshold

Dedup strategy:
- One derived clip per `(mediaId, labelId, version)` (store `labelId` in `clipData` and check before creating).

### 4) Build the label search UI
Suggested routes:
- `webapp/src/app/media/[id]/labels/page.tsx` (labels for a media)
- optional: `webapp/src/app/search/labels/page.tsx` (global search)

Use repo layering:
- Mutator for `label_clips` queries
- Service that merges filters and pagination and formats results
- Components for search inputs and result list

### 5) Make label search drive timeline building
Minimum “easy timeline build” flow:
- open a timeline
- search labels on a media
- create/add derived clips
- reorder/trim in the timeline editor from the prior stage

## Acceptance Criteria
- Running `detect_labels` for a media results in versioned `label_clips` and a raw JSON blob stored in S3.
- Labels are visible in the UI with filters and “jump to time”.
- User can create `MediaClip` records from labels and add them to a timeline.
- Re-running label detection does not duplicate rows; it produces a new version or updates the same version deterministically.

## Testing Checklist
- Unit: mapping from sample Google responses to normalized label rows (time math, confidence parsing).
- Unit: derived clip creation dedup logic.
- Integration: `detect_labels` task success updates `Media.processingVersion` and writes labels; failure paths keep previous version intact.
- UX: label search filters, pagination, “jump to time”, and “create clip” flows.

## AI Prompt
```
You are implementing label ingestion and label-driven clip search for a Next.js + PocketBase app.
Implement: a `detect_labels` task using Google Video Intelligence that stores raw JSON to S3 under labels/{mediaId}/v{version}/{provider}.json and upserts normalized Labelclips rows with version/provider/confidence/time ranges; a label search UI (filter by type/text/confidence/time, jump-to-time); and the ability to create MediaClip records from label ranges (manual and/or batch) with deduplication.
Constraints: MediaClip is the durable editable unit; keep labelData compact and store raw payloads in S3; tasks must be idempotent and versioned; everything should be testable without any recommendation system.
Produce: collection field checklist, task payload/result shape, dedup/versioning rules, UI route/component plan, and a testing checklist.
```
