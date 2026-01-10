import { RecommendationStrategy } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
  SearchParams,
} from '../types';
import { LabelType } from '@project/shared';

/**
 * Temporal Nearby Strategy
 *
 * Recommends segments/clips within a configurable time window of the seed clip.
 */
export class TemporalNearbyStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.TEMPORAL_NEARBY;

  private readonly DEFAULT_TIME_WINDOW = 60;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];
    const timeWindow =
      (context.filterParams as SearchParams).timeWindow ||
      this.DEFAULT_TIME_WINDOW;

    const sortedClips = [...context.labelClips].sort(
      (a, b) => a.start - b.start
    );

    for (let i = 0; i < sortedClips.length; i++) {
      const clip = sortedClips[i];
      const labelType = Array.isArray(clip.labelType)
        ? clip.labelType[0]
        : clip.labelType;

      if (
        !this.passesFilters(
          {
            start: clip.start,
            end: clip.end,
            confidence: clip.confidence,
            labelType: labelType as LabelType,
          },
          context.filterParams
        )
      ) {
        continue;
      }

      const nearbyClips = sortedClips.filter((other, j) => {
        if (i === j) return false;
        const timeDelta = Math.abs(other.start - clip.start);
        return timeDelta <= timeWindow;
      });

      if (nearbyClips.length > 0) {
        const matchingClip = context.existingClips.find(
          (mc) =>
            Math.abs(mc.start - clip.start) < 0.1 &&
            Math.abs(mc.end - clip.end) < 0.1
        );

        const avgTimeDelta =
          nearbyClips.reduce(
            (sum, other) => sum + Math.abs(other.start - clip.start),
            0
          ) / nearbyClips.length;
        const score = Math.min(
          1,
          (clip.confidence + (1 - avgTimeDelta / timeWindow)) / 2
        );

        candidates.push({
          start: clip.start,
          end: clip.end,
          clipId: matchingClip?.id,
          score,
          reason: `Part of temporal cluster`,
          reasonData: {
            timeDelta: avgTimeDelta,
            nearbyCount: nearbyClips.length,
          },
          labelType: labelType as LabelType,
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

    const timeWindow =
      context.searchParams.timeWindow || this.DEFAULT_TIME_WINDOW;

    for (const clip of context.availableClips) {
      if (clip.id === context.seedClip.id) continue;
      if (clip.MediaRef !== context.seedClip.MediaRef) continue;

      const timeDelta = Math.min(
        Math.abs(clip.start - context.seedClip.start),
        Math.abs(clip.end - context.seedClip.end)
      );

      if (timeDelta > timeWindow) continue;

      candidates.push({
        clipId: clip.id,
        score: 1 - timeDelta / timeWindow,
        reason: `Within ${Math.round(timeDelta)}s of seed clip`,
        reasonData: { timeDelta },
      });
    }

    return candidates;
  }
}
