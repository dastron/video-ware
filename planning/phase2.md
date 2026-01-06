# Clips and Timelines

This stage introduces clip creation and timeline composition. The goal is to move from “a processed media item” to “an editable sequence of clip ranges” represented by a stable `editList` format.

## Desired Outcomes
- Users can create clips (time ranges) from a `Media` item and manage clip metadata.
- Users can assemble clips into a single-track timeline with ordering, trimming, and total duration.
- The timeline can be exported to an `editList` JSON blob (`TimeOffset` seconds) that is suitable for later rendering tasks.
- A `render_timeline` task can be created as a stub to validate payloads and represent an eventual render pipeline.

## Non-Goals
- Multi-track editing, transitions/effects, audio mixing.
- Recommendation systems and automated labeling (those come after timeline fundamentals).
- Full production rendering; only validate and enqueue.

## Data Types (shared package)
Use the app-level types already prepared in `@project/shared/types`:
- `EditList`, `EditListEntry`, `TimeOffset`

Keep one consistent time unit policy:
- UI can display seconds, but persisted offsets should be either:
  - `seconds` in `editList`, and
  - numeric seconds (float) or milliseconds (int) for clip fields.
Pick one and keep it consistent across collections and UI helpers.

## Collections (PocketBase)

### Timelines
Suggested fields:
- `name` (text)
- `WorkspaceRef` (relation to `workspaces`)
- `createdBy` (relation to auth user; optional audit)
- `clips` (json array) OR relation to `timeline_clips` (choose one model)
- `editList` (json) generated from clips
- `duration` (number)
- `version` (number; increment on edits)
- `renderTaskRef?` (relation)

### Timeline Clips (recommended)
If you want stable ordering and editing:
- `TimelineRef` (relation)
- `ClipRef` (relation to `MediaClips`)
- `order` (number) or `position` (number)
- `startOffset` / `endOffset` (numbers; in timeline space)
- `trimStart` / `trimEnd` (numbers; in source clip space)
- `itemData` (json) for future transitions/effects without schema churn

## UI/UX Guidance (repo-aligned)
Follow the existing webapp layering described in `webapp/README.md`:
- add a `TimelineMutator` and `MediaClipMutator` in `webapp/src/mutators/`
- add orchestration in `webapp/src/services/timeline.ts`
- optional contexts/hooks for subscriptions and derived state

Suggested screens:
- `webapp/src/app/media/[id]/page.tsx`: media viewer with clip creation panel
- `webapp/src/app/timelines/page.tsx`: timeline list
- `webapp/src/app/timelines/[id]/page.tsx`: timeline editor

## Implementation Guide (step-by-step)

### 1) Clip creation (from a media viewer)
UI behaviors:
- show playable preview (proxy or native video) and sprite hover preview (where available)
- allow selecting a start/end range
- validate:
  - 0 <= start < end <= media.duration
  - enforce a minimum clip length (e.g. 0.5s) to avoid junk
- write to PocketBase:
  - create `media_clips` record with `clipType=range` and `clipData` (e.g. label, notes)

Suggested UX:
- “Add clip” action creates a clip and immediately displays it in a clip list for the media.

### 2) Timeline persistence model (choose early)
Option A (fast): `timelines.clips` JSON array containing ordered references and trims.
- Pros: fewer tables, easiest to implement.
- Cons: harder to query and reorder concurrently, brittle for future features.

Option B (recommended): `timeline_clips` collection.
- Pros: stable ordering, incremental edits, easier diffing/versioning.
- Cons: more records, more queries.

If unsure, start with Option A and migrate to Option B once editing complexity grows.

### 3) Timeline editor behavior (single-track)
Minimum interactions:
- add clips to timeline (from media clip list)
- reorder clips (drag/drop)
- trim clips (adjust in/out)
- compute derived values:
  - timeline duration
  - per-item `startOffset`/`endOffset`

Persistence strategy:
- save on explicit “Save” button initially (simpler than autosave)
- bump `timeline.version` on save
- store `editList` snapshot as the canonical render input for that version

### 4) editList generation
Define a deterministic mapping from timeline clips -> `EditListEntry`:
- `key`: stable identifier (e.g. `timelineItemId` or `clipId + order`)
- `inputs`: source IDs (initially `[mediaId]` or `[clip.mediaRef]`; keep consistent with your eventual render pipeline)
- `startTimeOffset` / `endTimeOffset`: represent the trimmed segment in the source media timeline

Important: decide what `inputs` refer to:
- simplest: `inputs = [mediaId]` and offsets are in the media’s time space.
- if you support clips referencing clips later, store enough info in each entry to resolve to the underlying media.

### 5) Render task stub (`render_timeline`)
Goal: validate the timeline is renderable and create a durable job request.

On “Render”:
- generate the `editList` (from current timeline clips)
- create a `tasks` record:
  - `type=render_timeline`
  - `status=queued`
  - `payload` includes `timelineId`, `version`, `editList`, and desired output settings (resolution/codec/container)
- set `timelines.renderTaskRef` to the task id

No actual rendering is required yet; a worker can later pick this up.

### 6) Validation rules
Backend-side validation should enforce:
- every timeline item references an existing clip/media
- offsets are within the source media duration
- clips are ordered and do not violate single-track constraints (no overlaps in timeline space)
- editList uses valid `TimeOffset` values:
  - `seconds` integer >= 0
  - `nanos` integer in [0, 999,999,999]

## Acceptance Criteria
- A user can create at least one clip from a media item and see it persisted.
- A user can create a timeline, add clips, reorder, trim, and save.
- The timeline persists an `editList` that matches the timeline state and remains stable across reloads.
- Clicking “Render” creates a valid `render_timeline` Task with a validated payload.

## Testing Checklist
- Unit: editList generation (ordering, trimming, duration math, nanos bounds).
- Integration: clip CRUD, timeline save/load, reorder persistence.
- UX: trimming edge cases at 0 and at media duration; timeline reorder; page reload consistency.

## AI Prompt
```
You are implementing clip creation and timeline composition for a Next.js + PocketBase app.
Implement: MediaClip CRUD with strict range validation; timeline persistence (either timelines.clips JSON or a timeline_clips collection); a single-track timeline editor UI that supports add/reorder/trim; deterministic `editList` generation using seconds TimeOffsets; and a `render_timeline` task stub that validates the payload and stores output settings.
Constraints: align with existing webapp layering (mutators/services/contexts/hooks/components); keep time units consistent; avoid multi-track complexity; ensure editList generation is stable and testable.
Produce: collection setup checklist, file/route structure, editList mapping rules, validation rules, and a testing checklist.
```
