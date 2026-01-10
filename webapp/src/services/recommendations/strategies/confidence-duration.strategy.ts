import { RecommendationStrategy } from '@project/shared';
import { BaseRecommendationStrategy } from './base-strategy';
import type {
  MediaStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
  TimelineStrategyContext,
} from '../types';
import { LabelType } from '@project/shared';

/**
 * Confidence Duration Strategy
 *
 * Recommends segments/clips with high confidence labels and similar duration to the seed.
 */
export class ConfidenceDurationStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.CONFIDENCE_DURATION;

  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.7;
  private readonly MAX_DURATION_DELTA = 5.0;

  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

    const highConfidenceClips = context.labelClips.filter(
      (lc) => lc.confidence >= this.HIGH_CONFIDENCE_THRESHOLD
    );

    for (const clip of highConfidenceClips) {
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

      const matchingClip = context.existingClips.find(
        (mc) =>
          Math.abs(mc.start - clip.start) < 0.1 &&
          Math.abs(mc.end - clip.end) < 0.1
      );

      candidates.push({
        start: clip.start,
        end: clip.end,
        clipId: matchingClip?.id,
        score: clip.confidence,
        reason: `High confidence detection`,
        reasonData: { confidence: clip.confidence },
        labelType: labelType as LabelType,
      });
    }

    return candidates;
  }

  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];
    const seedDuration = context.seedClip
      ? context.seedClip.end - context.seedClip.start
      : null;

    for (const clip of context.availableClips) {
      if (context.seedClip && clip.id === context.seedClip.id) continue;

      const candidateLabelClips = context.labelClips.filter(
        (lc) =>
          lc.MediaRef === clip.MediaRef &&
          lc.start >= clip.start &&
          lc.end <= clip.end
      );

      if (candidateLabelClips.length === 0) continue;

      const avgConfidence =
        candidateLabelClips.reduce((sum, lc) => sum + lc.confidence, 0) /
        candidateLabelClips.length;
      if (avgConfidence < this.HIGH_CONFIDENCE_THRESHOLD) continue;

      let durationScore = 1.0;
      if (seedDuration !== null) {
        const clipDuration = clip.end - clip.start;
        const durationDelta = Math.abs(clipDuration - seedDuration);
        durationScore = Math.max(
          0,
          1 - durationDelta / this.MAX_DURATION_DELTA
        );
      }

      candidates.push({
        clipId: clip.id,
        score: (avgConfidence + durationScore) / 2,
        reason: `High confidence and similar duration`,
        reasonData: { confidence: avgConfidence, durationScore },
      });
    }

    return candidates;
  }
}
