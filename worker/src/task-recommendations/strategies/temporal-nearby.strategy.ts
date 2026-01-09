/**
 * Temporal Nearby Strategy
 *
 * Recommends segments/clips within a configurable time window of the seed clip.
 * Scores based on temporal distance - closer segments receive higher scores.
 * This strategy is useful for finding contextually related content based on time proximity.
 */

import { RecommendationStrategy } from '@project/shared';
import {
  BaseRecommendationStrategy,
  MediaStrategyContext,
  TimelineStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './base-strategy';

export class TemporalNearbyStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.TEMPORAL_NEARBY;

  // Default time window in seconds
  private readonly DEFAULT_TIME_WINDOW = 60;

  /**
   * Execute temporal_nearby strategy for media recommendations
   *
   * Finds segments within a time window. Since there's no seed clip for media recommendations,
   * this strategy recommends segments that are temporally close to each other,
   * creating clusters of related content.
   */
  async executeForMedia(
    context: MediaStrategyContext,
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

    // Get time window from filter params or use default
    const timeWindow =
      (context.filterParams as any).timeWindow || this.DEFAULT_TIME_WINDOW;

    // Group label clips by temporal proximity
    const sortedClips = [...context.labelClips].sort((a, b) => a.start - b.start);

    for (let i = 0; i < sortedClips.length; i++) {
      const clip = sortedClips[i];

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
          context.filterParams,
        )
      ) {
        continue;
      }

      // Find nearby clips within time window
      const nearbyClips = sortedClips.filter((other, j) => {
        if (i === j) return false;
        const timeDelta = Math.abs(other.start - clip.start);
        return timeDelta <= timeWindow;
      });

      // Only recommend if there are nearby clips (indicates a cluster)
      if (nearbyClips.length > 0) {
        // Check if this segment matches an existing MediaClip
        const matchingClip = context.existingClips.find(
          (mc) =>
            mc.MediaRef === context.media.id &&
            Math.abs(mc.start - clip.start) < 0.1 &&
            Math.abs(mc.end - clip.end) < 0.1,
        );

        // Calculate average time delta to nearby clips
        const avgTimeDelta =
          nearbyClips.reduce(
            (sum, other) => sum + Math.abs(other.start - clip.start),
            0,
          ) / nearbyClips.length;

        // Score based on confidence and proximity to cluster
        const proximityScore = Math.max(0, 1 - avgTimeDelta / timeWindow);
        const clusterBonus = Math.min(0.2, nearbyClips.length * 0.05); // Up to 0.2 bonus
        const score = Math.min(
          1,
          (clip.confidence + proximityScore + clusterBonus) / 2,
        );

        candidates.push({
          startTime: clip.start,
          endTime: clip.end,
          clipId: matchingClip?.id,
          score,
          reason: `Part of temporal cluster with ${nearbyClips.length} nearby ${nearbyClips.length === 1 ? 'segment' : 'segments'}`,
          reasonData: {
            timeDelta: avgTimeDelta,
            confidence: clip.confidence,
            labelClipIds: [clip.id, ...nearbyClips.map((c) => c.id)],
          },
          labelType,
        });
      }
    }

    return candidates;
  }

  /**
   * Execute temporal_nearby strategy for timeline recommendations
   *
   * Finds clips within a configurable time window of the seed clip.
   * Closer clips receive higher scores.
   */
  async executeForTimeline(
    context: TimelineStrategyContext,
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];

    // If no seed clip, we can't find nearby clips
    if (!context.seedClip) {
      return candidates;
    }

    // Get time window from search params or use default
    const timeWindow =
      context.searchParams.timeWindow || this.DEFAULT_TIME_WINDOW;

    // For each available clip, check if it's within the time window
    for (const clip of context.availableClips) {
      // Skip if clip is already in timeline
      const alreadyInTimeline = context.timelineClips.some(
        (tc) => tc.MediaClipRef === clip.id,
      );
      if (alreadyInTimeline) continue;

      // Skip if not from the same media
      if (clip.MediaRef !== context.seedClip.MediaRef) continue;

      // Calculate temporal distance
      const timeDeltaStart = Math.abs(clip.start - context.seedClip.start);
      const timeDeltaEnd = Math.abs(clip.end - context.seedClip.end);
      const timeDelta = Math.min(timeDeltaStart, timeDeltaEnd);

      // Skip if outside time window
      if (timeDelta > timeWindow) continue;

      // Find label clips for this candidate to get confidence
      const candidateLabelClips = context.labelClips.filter(
        (lc) =>
          lc.MediaRef === clip.MediaRef &&
          lc.start >= clip.start &&
          lc.end <= clip.end,
      );

      // Calculate average confidence
      const avgConfidence =
        candidateLabelClips.length > 0
          ? candidateLabelClips.reduce((sum, lc) => sum + lc.confidence, 0) /
            candidateLabelClips.length
          : 0.5;

      // Score based on temporal proximity
      const proximityScore = Math.max(0, 1 - timeDelta / timeWindow);
      const score = (proximityScore + avgConfidence) / 2;

      candidates.push({
        clipId: clip.id,
        score,
        reason: `Within ${Math.round(timeDelta)}s of seed clip`,
        reasonData: {
          timeDelta,
          confidence: avgConfidence,
          sourceClipId: context.seedClip.id,
          labelClipIds: candidateLabelClips.map((lc) => lc.id),
        },
      });
    }

    return candidates;
  }
}
