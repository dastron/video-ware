/**
 * Same Entity Strategy
 *
 * Recommends segments/clips that share the same LabelEntity with the seed clip.
 * This strategy is useful for finding related content based on detected objects,
 * people, or other labeled entities.
 */

import { RecommendationStrategy } from '@project/shared';
import {
  BaseRecommendationStrategy,
  MediaStrategyContext,
  TimelineStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './base-strategy';

export class SameEntityStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.SAME_ENTITY;

  /**
   * Execute same_entity strategy for media recommendations
   *
   * Finds segments within the media that share LabelEntities with high confidence.
   * Scores based on entity match confidence and number of shared entities.
   */
  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

    // Group label clips by entity
    const clipsByEntity = new Map<string, typeof context.labelClips>();
    for (const labelClip of context.labelClips) {
      if (!labelClip.LabelEntityRef) continue;

      const entityId = labelClip.LabelEntityRef;
      if (!clipsByEntity.has(entityId)) {
        clipsByEntity.set(entityId, []);
      }
      clipsByEntity.get(entityId)?.push(labelClip);
    }

    // For each entity with multiple occurrences, create recommendations
    for (const [entityId, clips] of clipsByEntity.entries()) {
      if (clips.length < 2) continue; // Need at least 2 occurrences to recommend

      // Find the entity details
      const entity = context.labelEntities.find((e) => e.id === entityId);
      if (!entity) continue;

      // Create a candidate for each clip
      for (const clip of clips) {
        // Normalize labelType to a single value (PocketBase SelectField can return array)
        const labelType = Array.isArray(clip.labelType)
          ? clip.labelType[0]
          : clip.labelType;

        // Apply filters
        if (
          !this.passesFilters(
            {
              start: clip.start,
              end: clip.end,
              confidence: clip.confidence,
              labelType,
            },
            context.filterParams
          )
        ) {
          continue;
        }

        // Check if this segment matches an existing MediaClip
        const matchingClip = context.existingClips.find(
          (mc) =>
            mc.MediaRef === context.media.id &&
            Math.abs(mc.start - clip.start) < 0.1 &&
            Math.abs(mc.end - clip.end) < 0.1
        );

        // Score based on confidence and entity occurrence count
        const baseScore = clip.confidence;
        const occurrenceBonus = Math.min(0.2, clips.length * 0.05); // Up to 0.2 bonus
        const score = Math.min(1, baseScore + occurrenceBonus);

        candidates.push({
          startTime: clip.start,
          endTime: clip.end,
          clipId: matchingClip?.id,
          score,
          reason: `Contains ${entity.canonicalName} (appears ${clips.length} times)`,
          reasonData: {
            entityId: entity.id,
            entityName: entity.canonicalName,
            matchedLabels: [entity.canonicalName],
            confidence: clip.confidence,
            labelClipIds: [clip.id],
          },
          labelType,
        });
      }
    }

    return candidates;
  }

  /**
   * Execute same_entity strategy for timeline recommendations
   *
   * Finds clips that share LabelEntities with the seed clip.
   * Prioritizes clips with multiple shared entities and high confidence.
   */
  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];

    // If no seed clip, we can't find related entities
    if (!context.seedClip) {
      return candidates;
    }

    // Find all label clips for the seed clip
    const seedLabelClips = context.labelClips.filter(
      (lc) =>
        lc.MediaRef === context.seedClip?.MediaRef &&
        lc.start >= context.seedClip?.start &&
        lc.end <= context.seedClip?.end
    );

    // Extract entity IDs from seed clip
    const seedEntityIds = new Set(
      seedLabelClips
        .map((lc) => lc.LabelEntityRef)
        .filter((id): id is string => !!id)
    );

    if (seedEntityIds.size === 0) {
      return candidates;
    }

    // For each available clip, check for shared entities
    for (const clip of context.availableClips) {
      // Skip if clip is already in timeline
      const alreadyInTimeline = context.timelineClips.some(
        (tc) => tc.MediaClipRef === clip.id
      );
      if (alreadyInTimeline) continue;

      // Find label clips for this candidate
      const candidateLabelClips = context.labelClips.filter(
        (lc) =>
          lc.MediaRef === clip.MediaRef &&
          lc.start >= clip.start &&
          lc.end <= clip.end
      );

      // Find shared entities
      const sharedEntityIds: string[] = [];
      const sharedEntities: string[] = [];
      let totalConfidence = 0;

      for (const labelClip of candidateLabelClips) {
        if (
          labelClip.LabelEntityRef &&
          seedEntityIds.has(labelClip.LabelEntityRef)
        ) {
          if (!sharedEntityIds.includes(labelClip.LabelEntityRef)) {
            sharedEntityIds.push(labelClip.LabelEntityRef);

            // Find entity name
            const entity = context.labelEntities.find(
              (e) => e.id === labelClip.LabelEntityRef
            );
            if (entity) {
              sharedEntities.push(entity.canonicalName);
            }
          }
          totalConfidence += labelClip.confidence;
        }
      }

      // Skip if no shared entities
      if (sharedEntityIds.length === 0) continue;

      // Calculate score based on number of shared entities and confidence
      const entityMatchScore = Math.min(1, sharedEntityIds.length * 0.3);
      const avgConfidence =
        totalConfidence / Math.max(1, sharedEntityIds.length);
      const score = (entityMatchScore + avgConfidence) / 2;

      candidates.push({
        clipId: clip.id,
        score,
        reason: `Shares ${sharedEntityIds.length} ${sharedEntityIds.length === 1 ? 'entity' : 'entities'} with seed clip: ${sharedEntities.join(', ')}`,
        reasonData: {
          entityId: sharedEntityIds[0], // Primary entity
          entityName: sharedEntities[0],
          matchedLabels: sharedEntities,
          seedClipEntityMatch: true,
          confidence: avgConfidence,
          sourceClipId: context.seedClip.id,
          labelClipIds: candidateLabelClips.map((lc) => lc.id),
        },
      });
    }

    return candidates;
  }
}
