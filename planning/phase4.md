# Phase 4 — Timeline Editing with Recommendations

## Objectives
- Assist users while building timelines by recommending clips based on label data and spatial/temporal similarity.
- Integrate recommendations into the timeline UI (suggestions panel, drag/drop), leveraging MediaLabel metadata and clip context.
- Close the loop with render/export task that uses editList, and ensure recommendations remain explainable.

## Scope
- Recommendation engine: heuristics using object locations, label types, durations, and proximity; start simple (rule-based) with room for ML later.
- UI: suggestion tray when a clip is selected or dropped; inline reasons (e.g., "same person near timestamp", "similar location"); accept/ignore interactions.
- Tasking: `recommend_clips` task per Media/Timeline that writes suggested clips (as MediaClip with clipType=recommendation or separate table) and attaches scores/rationale.
- Rendering: implement real render path using editList with FFmpeg (or browser assembly if preferred) triggered by Task `render_timeline`.
- Feedback loop: capture user actions on suggestions to improve scoring (record accept/ignore).

## Deliverables
- Recommendation module (rule-based) using MediaLabel data (object positions, shot boundaries, durations, confidence).
- Data model: store recommendations with scores, rationale, source provider, and linked MediaClip; optionally a `ClipRecommendation` collection.
- Timeline UI updates to show suggestions, allow quick add/replace, and display explanation.
- Render task that consumes editList and outputs a merged file to S3, updating Task + File records.
- Analytics/telemetry hooks for accepted vs rejected suggestions.

## Work Plan
- Recommendation rules: start with location/label similarity (same object/person within time window), shot adjacency, and duration compatibility.
- Data fetching: efficient queries on MediaLabel and existing MediaClips; cache popular recommendations per Media.
- UI interactions: accept/add to timeline, replace clip, or dismiss; keyboard shortcuts optional.
- Rendering: finalize FFmpeg command generation from editList; handle audio; validate timestamps and clip ordering before render; write output to `renders/{timelineId}/`.
- Observability: log recommendation generation and render attempts; surface failure states in UI.
- QA: tests for recommendation scoring, render command assembly, and end-to-end happy path from timeline -> render.

## Open Questions
- Do we need multi-track timelines now, or stay single-track?
- Performance budget for render (max duration/complexity)?
- How to persist user feedback to tune recommendation weights?

## AI Prompt for This Phase
```
You are implementing Phase 4 (timeline recommendations + rendering) for the Next.js + PocketBase app.
Implement: rule-based recommendation engine using MediaLabel data (object/shot/person positions) to propose MediaClips with scores/rationale; task `recommend_clips` that writes recommendations to PocketBase; UI hooks in timeline editor to show suggestions with reasons and allow add/replace/dismiss; Task `render_timeline` that consumes editList to render via FFmpeg to S3.
Constraints: single-track timelines for now; store recommendations with score/source/explanation; keep tasks idempotent with progress updates; update File/Task records on render completion.
Produce: algorithm outline, schema/migration snippets (ClipRecommendation or similar), UI interaction plan, and render command generation with validation.
```
