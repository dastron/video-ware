# Phase 2 — Clips and Timelines

## Objectives
- Allow users to create and edit clips from Media, and arrange them into timelines for preview and export planning.
- Represent timelines as ordered clip sequences plus an `editList` blob for rendering/export.
- Provide UI to scrub, preview, and reorder clips with validation on ranges.

## Scope
- Clip CRUD: create ranges on a Media item, assign clipType (manual/object/shot/etc), store clipData (selection metadata).
- Timeline CRUD: timelines belong to a user/workspace and contain ordered clip references with optional transitions/effects (tracked in editList).
- Preview UX: lightweight timeline preview (no final render) using sprites/proxy playback; track timeline duration.
- Export placeholder: generate editList JSON and a render Task request stub (actual rendering can be mocked).
- No AI detection or recommendations yet (comes in Phase 3/4).

## Deliverables
- PocketBase schemas/migrations for Timeline (and TimelineItem if needed) with permissions.
- Next.js UI for clip creation (range selector) and timeline editor (ordering, trimming, metadata).
- editList generator that converts timeline structure into the app-level `editList` format (offsets with seconds/nanos).
- Task type `render_timeline` stub that validates inputs and stores desired output settings (codec, resolution).
- Basic persistence of timeline versions/change history (could be minimal delta log).

## Work Plan
- Data model: decide between embedded order array vs separate TimelineItem collection; include start/end offsets and track associated MediaClip IDs.
- Validation: ensure clip ranges do not exceed Media duration; guard overlapping rules per timeline policy.
- UI: scrubber with sprite hover previews; draggable list for ordering; inline duration display.
- editList: map timeline items to `{ key, inputs, startTimeOffset, endTimeOffset }` entries; support multiple inputs if needed.
- Tasks: when requesting render, create a Task with payload = editList + output settings; worker can no-op or simulate completion.
- QA: unit tests for editList generation and timeline duration calculations; integration for clip CRUD.

## Open Questions
- Do we allow overlapping clips (multitrack) or keep single-track for now?
- Export target: browser-side assembly vs worker FFmpeg render in later phase.
- Do we store transitions/effects now or defer to Phase 4?

## AI Prompt for This Phase
```
You are implementing Phase 2 (clips + timelines) for a Next.js + PocketBase app.
Implement: MediaClip CRUD with range validation; Timeline schema (and TimelineItem if used) to store ordered clip references; UI for selecting clip ranges and arranging a timeline; function to emit an editList array with startTimeOffset/endTimeOffset (seconds + nanos) per entry; Task stub `render_timeline` that stores requested output settings.
Constraints: client-side PocketBase SDK; ensure clips respect Media duration; sprites/proxy assets available for preview; keep timeline single-track unless noted.
Produce: schema/migration snippets, UI/interaction outline, editList generation logic, and validation/tests to ensure clip ordering and durations are correct.
```
