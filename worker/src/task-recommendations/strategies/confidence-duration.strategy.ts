/**
 * Confidence Duration Strategy
 *
 * Recommends segments/clips with high confidence labels and similar duration to the seed.
 * This strategy prioritizes quality (confidence) and consistency (duration similarity).
 * Useful for finding clips that match the pacing and quality of the seed clip.
 */

import { RecommendationStrategy } from '@project/shared';
import {
  BaseRecommendationStrategy,
  MediaStrategyContext,
  TimelineStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './base-strategy';

export class ConfidenceDurationStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.CONFIDENCE_DURATION;

  // Threshold for high confidence
  private readonly HIGH_CONFIDENCE_THRESHOLD = 0.7;

  // Maximum duration difference (in seconds) for similarity
  private readonly MAX_DURATION_DELTA = 5.0;

  /**
   * Execute confidence_duration strategy for media recommendations
   *
   * Finds segments with high confidence labels. Since there's no seed clip for media,
   * we recommend segments with the highest confidence scores.
   */
  async executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

    // Filter for high confidence clips
    const highConfidenceClips = context.labelClips.filter(
      (lc) => lc.confidence >= this.HIGH_CONFIDENCE_THRESHOLD
    );

    for (const clip of highConfidenceClips) {
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

      const duration = clip.end - clip.start;

      // Score primarily based on confidence
      const score = clip.confidence;

      candidates.push({
        start: clip.start,
        end: clip.end,
        clipId: matchingClip?.id,
        score,
        reason: `High confidence detection (${Math.round(clip.confidence * 100)}%)`,
        reasonData: {
          confidence: clip.confidence,
          duration,
          labelClipIds: [clip.id],
        },
        labelType,
      });
    }

    return candidates;
  }

  /**
   * Execute confidence_duration strategy for timeline recommendations
   *
   * Finds clips with high confidence labels and similar duration to the seed clip.
   * Prioritizes both quality and duration consistency.
   */
  async executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];

    // If no seed clip, fall back to high confidence only
    const seedDuration = context.seedClip
      ? context.seedClip.end - context.seedClip.start
      : null;

    // For each available clip, evaluate confidence and duration
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

      // Skip if no label clips
      if (candidateLabelClips.length === 0) continue;

      // Calculate average confidence
      const avgConfidence =
        candidateLabelClips.reduce((sum, lc) => sum + lc.confidence, 0) /
        candidateLabelClips.length;

      // Skip if confidence is too low
      if (avgConfidence < this.HIGH_CONFIDENCE_THRESHOLD) continue;

      // Calculate duration similarity if seed clip exists
      const clipDuration = clip.end - clip.start;
      let durationScore = 1.0;
      let durationDelta = 0;

      if (seedDuration !== null) {
        durationDelta = Math.abs(clipDuration - seedDuration);

        // Score based on duration similarity
        if (durationDelta <= this.MAX_DURATION_DELTA) {
          durationScore = 1 - durationDelta / this.MAX_DURATION_DELTA;
        } else {
          // Penalize clips with very different durations
          durationScore = Math.max(
            0,
            0.5 - (durationDelta - this.MAX_DURATION_DELTA) / 20
          );
        }
      }

      // Combined score: weighted average of confidence and duration similarity
      const score = avgConfidence * 0.6 + durationScore * 0.4;

      // Skip if score is too low
      if (score < 0.5) continue;

      const reason = seedDuration
        ? `High confidence (${Math.round(avgConfidence * 100)}%), similar duration (${Math.round(clipDuration)}s vs ${Math.round(seedDuration)}s)`
        : `High confidence (${Math.round(avgConfidence * 100)}%)`;

      candidates.push({
        clipId: clip.id,
        score,
        reason,
        reasonData: {
          confidence: avgConfidence,
          durationDelta,
          sourceClipId: context.seedClip?.id,
          labelClipIds: candidateLabelClips.map((lc) => lc.id),
        },
      });
    }

    return candidates;
  }
}
