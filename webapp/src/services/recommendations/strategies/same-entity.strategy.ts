import { RecommendationStrategy, type LabelClip } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';

/**
 * Same Entity Strategy
 *
 * Recommends segments/clips that share the same LabelEntity with the seed clip.
 */
export class SameEntityStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.SAME_ENTITY;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];
    const clipsByEntity = new Map<string, LabelClip[]>();

    for (const lc of context.labelClips) {
      if (!lc.LabelEntityRef) continue;
      if (!clipsByEntity.has(lc.LabelEntityRef)) {
        clipsByEntity.set(lc.LabelEntityRef, []);
      }
      clipsByEntity.get(lc.LabelEntityRef)!.push(lc);
    }

    for (const [entityId, clips] of clipsByEntity.entries()) {
      const entity = context.labelEntities.find((e) => e.id === entityId);
      if (!entity) continue;

      for (const clip of clips) {
        const matchingClip = context.existingClips.find(
          (mc) =>
            Math.abs(mc.start - clip.start) < 0.1 &&
            Math.abs(mc.end - clip.end) < 0.1
        );

        const labelType = Array.isArray(clip.labelType)
          ? clip.labelType[0]
          : clip.labelType;

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

        candidates.push({
          start: clip.start,
          end: clip.end,
          clipId: matchingClip?.id,
          score: clip.confidence,
          reason: `Contains ${entity.canonicalName}`,
          reasonData: {
            entityId: entity.id,
            entityName: entity.canonicalName,
          },
          labelType,
        });
      }
    }
    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];
    if (!context.seedClip) return [];

    const seedLabelClips = context.labelClips.filter(
      (lc) =>
        lc.MediaRef === context.seedClip!.MediaRef &&
        lc.start >= context.seedClip!.start &&
        lc.end <= context.seedClip!.end
    );

    const seedEntityIds = new Set(
      seedLabelClips
        .map((lc) => lc.LabelEntityRef)
        .filter((id): id is string => !!id)
    );
    if (seedEntityIds.size === 0) return [];

    for (const clip of context.availableClips) {
      if (clip.id === context.seedClip.id) continue;

      const candidateLabelClips = context.labelClips.filter(
        (lc) =>
          lc.MediaRef === clip.MediaRef &&
          lc.start >= clip.start &&
          lc.end <= clip.end
      );

      const sharedEntities = candidateLabelClips
        .filter(
          (lc) => lc.LabelEntityRef && seedEntityIds.has(lc.LabelEntityRef)
        )
        .map(
          (lc) =>
            context.labelEntities.find((e) => e.id === lc.LabelEntityRef)
              ?.canonicalName
        )
        .filter((name): name is string => !!name);

      if (sharedEntities.length > 0) {
        candidates.push({
          clipId: clip.id,
          score: 0.5 + Math.min(0.5, sharedEntities.length * 0.1),
          reason: `Shares entities: ${sharedEntities.join(', ')}`,
          reasonData: { sharedEntities },
        });
      }
    }
    return candidates;
  }
}
