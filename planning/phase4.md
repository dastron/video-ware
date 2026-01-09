# Recommendations and Assisted Timeline Building

This stage turns label-derived clips into an assistive editing experience. Recommendations must be persisted in a separate table (not as `MediaClip` rows) so they remain lightweight, prunable, and safe to iterate on.

## Desired Outcomes
- While editing a timeline, the UI shows a small, explainable set of recommended clips to add next.
- Recommendations are derived from `Labelclips` + existing `MediaClip` records, but stored separately in a dedicated recommendations table.
- Recommendations have strict size limits (top-N per context ) so tables don’t grow unbounded.
- The system captures basic feedback (accepted/dismissed) so ranking can evolve over time.

## Non-Goals
- Perfect ranking; start rule-based and evolve.
- Multi-track timelines, advanced transitions/effects.
- Full production rendering; keep `render_timeline` as a validated job request unless you explicitly decide to implement rendering here.

## Data Model

### `media_clips` (source of truth)
Recommendations should point to existing `MediaClip` records:
- manual clips (`clipType=range`)
- label-derived clips (`clipType=shot|object|person|speech`)

Avoid creating “recommendation clips” in `media_clips`. The editable unit is `MediaClip`; recommendations are pointers + metadata.

### `label_recommendations` (new)
One record represents “we recommend clip X in context Y”.

Suggested fields:
- `workspaceRef` (relation) — always scope recommendations to a workspace
- `timelineRef` (relation, nullable) — when recommending inside a specific timeline
- `mediaRef` (relation) — media the recommended clip belongs to
- `seedClipRef` (relation, nullable) — the clip the user is currently editing/has just placed (context)
- `recommendedClipRef` (relation to `media_clips`) — the actual clip being suggested
- `score` (number)
- `rank` (number) — precomputed ordering for fast UI
- `reason` (text) — human-readable, short (“same person”, “same scene”, “adjacent shot”)
- `reasonData` (json) — structured explanation (entity ids, matched labels, similarity signals)
- `strategy` (text/select) — e.g. `same_entity`, `adjacent_shot`, `temporal_nearby`
- `queryHash` (text) — identifies the request context and lets you upsert instead of duplicate
- `expiresAt` (date) — TTL for pruning
- `createdBy` (relation to auth user, nullable) — optional audit trail (not for auth)
- `acceptedAt` (date, nullable)
- `dismissedAt` (date, nullable)

### Size limits (required)
Enforce limits at write-time and with scheduled pruning:
- **Top-N per context**: keep only N recommendations per `(timelineRef, seedClipRef)` and/or `(timelineRef, mediaRef)`.
- **TTL**: delete expired recommendations regularly.
- **Dedup**: unique `(queryHash, recommendedClipRef)` behavior via “upsert then reorder ranks”.

Recommended starting values:
- `N = 20` per context
- `TTL = 7 days` (or shorter during heavy iteration)

## Recommendation Generation Strategies (rule-based, testable)
Start with a small set of strategies that are explainable and easy to verify:

1) Same entity (person/object)
- If the seed clip contains `entity_id` / `entity_description`, recommend other clips in the same media with the same entity.

2) Adjacent shots
- If you have shot-derived clips, recommend the next/previous shot in time.

3) Temporal proximity
- Recommend clips whose start is within a time window near the seed clip (e.g. ±30s), optionally gated by label overlap.

4) Confidence + duration compatibility
- Prefer higher confidence labels and clips with similar duration (or user-selected target duration).

Keep spatial similarity (“similar location in frame”) as an optional enhancement once bbox summaries are available in label data.

## UI: Assisted Editing Workflow
The end state is “label-driven clip search + easy timeline build”, with recommendations as a shortcut:

Minimum UI behaviors:
- When a timeline item is selected (or a clip is dropped), show “Suggested next clips”.
- Each suggestion shows:
  - thumbnail/preview (sprite hover)
  - clip label (entity name, shot index, etc.)
  - reason (“same person”, “next shot”, “nearby event”)
  - actions: “Add”, “Replace”, “Dismiss”
- Add “More like this” which triggers recommendation generation with a new `queryHash`.

## Implementation Guide (step-by-step)

### 1) Define recommendation contexts and `queryHash`
Decide contexts that map to deterministic hashes:
- `timeline:{timelineId}:seed:{seedClipId}:labelsV:{labelsVersion}:strategySet:{...}`
- Include `Media.processingVersion` so recommendations refresh when labels change.

### 2) Implement `recommend_clips` as a task (preferred) or an on-demand endpoint
Task payload should include:
- `timelineId`
- `seedClipId` (optional)
- `mediaId`
- `workspaceId`
- `labelsVersion`
- `strategySet` and any parameters (window size, max results)

Task output should include:
- count generated
- pruning summary (how many dropped by top-N/TTL)

This keeps heavy querying out of the UI thread and makes recommendations reproducible.

### 3) Write recommendations safely (size-limited)
Write path rules:
- Compute candidates and scores in memory.
- Sort and take top N.
- Upsert by `(queryHash, recommendedClipRef)` (update score/rank/reason).
- Set `expiresAt = now + TTL`.
- Prune any recommendations beyond top N for the same `queryHash` (or context grouping).

### 4) Add UI integration in the timeline editor
- Subscribe to `label_recommendations` for the current context (`queryHash`) or poll after enqueueing.
- Add “Generate suggestions” (explicit) first; later it can auto-run on selection change with debounce.
- Implement accept/dismiss:
  - Accept: add `recommendedClipRef` into timeline items; set `acceptedAt`.
  - Dismiss: set `dismissedAt` (and optionally hide it immediately).

### 5) Feedback capture
Keep it minimal:
- `acceptedAt` / `dismissedAt` timestamps on `label_recommendations`.
- Optional `recommendation_events` table later if you want richer analytics.

## Acceptance Criteria
- With labels and derived clips present, selecting a clip in a timeline can produce a list of recommendations stored in `label_recommendations`.
- Recommendations are capped to top N and expire via TTL without manual cleanup.
- UI can add a recommended clip to the timeline with one action and shows a short explanation.
- Accept/dismiss updates are persisted and visible for debugging.

## Testing Checklist
- Unit: scoring + ranking determinism for a fixed set of label-derived clips.
- Unit: `queryHash` stability and upsert/dedup behavior.
- Integration: prune behavior keeps table size under limits; TTL deletes expired rows.
- UX: selecting a clip triggers recommendation generation; add/replace/dismiss flows work; recommendations refresh when label version changes.

## AI Prompt
```
You are implementing assistive recommendations for a label-driven timeline editor in a Next.js + PocketBase app.
Implement: a `label_recommendations` collection that stores pointers to existing MediaClip records (do not store recommendations as MediaClip rows); a `recommend_clips` task that computes rule-based recommendations using Labelclips + MediaClip (same entity, adjacent shot, temporal proximity) and writes a strictly size-limited, TTL-expiring top-N set per context using a deterministic queryHash; UI hooks in the timeline editor to request recommendations, display them with short reasons, and support add/replace/dismiss actions while persisting acceptedAt/dismissedAt.
Constraints: recommendations must be prunable and bounded; MediaClip remains the editable unit; explanations must be readable and structured; results must be deterministic and testable for a fixed input dataset.
Produce: collection field checklist, queryHash scheme, scoring strategies, pruning policy, UI interaction plan, and a testing checklist.
```
