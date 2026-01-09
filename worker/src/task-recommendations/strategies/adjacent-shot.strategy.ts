/**
 * Adjacent Shot Strategy
 *
 * Recommends segments/clips that are temporally adjacent (immediately before or after)
 * in the shot sequence. This strategy is useful for finding contextually related shots
 * in video editing workflows.
 */

import { RecommendationStrategy, LabelType } from '@project/shared';
import {
  BaseRecommendationStrategy,
  MediaStrategyContext,
  TimelineStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './base-strategy';

export class AdjacentShotStrategy extends BaseRecommendationStrategy {
  readonly name = RecommendationStrategy.ADJACENT_SHOT;

  /**
   * Execute adjacent_shot strategy for media recommendations
   *
   * Finds shot-type segments that are immediately before or after other shots.
   * Scores based on temporal proximity and shot confidence.
   */
  async executeForMedia(
    context: MediaStrategyContext,
  ): Promise<ScoredMediaCandidate[]> {
    const candidates: ScoredMediaCandidate[] = [];

    // Filter for shot-type label clips only
    const shotClips = context.labelClips.filter(
      (lc) => lc.labelType === LabelType.SHOT,
    );

    if (shotClips.length === 0) {
      return candidates;
    }

    // Sort shots by start time to establish sequence
    const sortedShots = [...shotClips].sort((a, b) => a.start - b.start);

    // For each shot, recommend adjacent shots
    for (let i = 0; i < sortedShots.length; i++) {
      const currentShot = sortedShots[i];

      // Normalize labelType to a single value (PocketBase SelectField can return array)
      const labelType = Array.isArray(currentShot.labelType)
        ? currentShot.labelType[0]
        : currentShot.labelType;

      // Apply filters to current shot
      if (
        !this.passesFilters(
          {
            start: currentShot.start,
            end: currentShot.end,
            confidence: currentShot.confidence,
            labelType,
          },
          context.filterParams,
        )
      ) {
        continue;
      }

      // Previous shot
      if (i > 0) {
        const prevShot = sortedShots[i - 1];
        
        // Check if previous shot matches an existing MediaClip
        const matchingClip = context.existingClips.find(
          (mc) =>
            mc.MediaRef === context.media.id &&
            Math.abs(mc.start - prevShot.start) < 0.1 &&
            Math.abs(mc.end - prevShot.end) < 0.1,
        );

        // Score based on confidence and temporal proximity
        const timeDelta = currentShot.start - prevShot.end;
        const proximityScore = Math.max(0, 1 - timeDelta / 10); // Closer = higher score
        const score = (prevShot.confidence + proximityScore) / 2;

        candidates.push({
          startTime: prevShot.start,
          endTime: prevShot.end,
          clipId: matchingClip?.id,
          score,
          reason: `Shot immediately before (shot ${i})`,
          reasonData: {
            shotIndex: i - 1,
            direction: 'previous',
            timeDelta,
            confidence: prevShot.confidence,
            labelClipIds: [prevShot.id],
          },
          labelType: LabelType.SHOT,
        });
      }

      // Next shot
      if (i < sortedShots.length - 1) {
        const nextShot = sortedShots[i + 1];
        
        // Check if next shot matches an existing MediaClip
        const matchingClip = context.existingClips.find(
          (mc) =>
            mc.MediaRef === context.media.id &&
            Math.abs(mc.start - nextShot.start) < 0.1 &&
            Math.abs(mc.end - nextShot.end) < 0.1,
        );

        // Score based on confidence and temporal proximity
        const timeDelta = nextShot.start - currentShot.end;
        const proximityScore = Math.max(0, 1 - timeDelta / 10); // Closer = higher score
        const score = (nextShot.confidence + proximityScore) / 2;

        candidates.push({
          startTime: nextShot.start,
          endTime: nextShot.end,
          clipId: matchingClip?.id,
          score,
          reason: `Shot immediately after (shot ${i + 2})`,
          reasonData: {
            shotIndex: i + 1,
            direction: 'next',
            timeDelta,
            confidence: nextShot.confidence,
            labelClipIds: [nextShot.id],
          },
          labelType: LabelType.SHOT,
        });
      }
    }

    return candidates;
  }

  /**
   * Execute adjacent_shot strategy for timeline recommendations
   *
   * Finds clips containing shots that are adjacent to the seed clip's shots.
   * Prioritizes shots immediately before or after in the sequence.
   */
  async executeForTimeline(
    context: TimelineStrategyContext,
  ): Promise<ScoredTimelineCandidate[]> {
    const candidates: ScoredTimelineCandidate[] = [];

    // If no seed clip, we can't find adjacent shots
    if (!context.seedClip) {
      return candidates;
    }

    // Find shot-type label clips for the seed clip
    const seedShotClips = context.labelClips.filter(
      (lc) =>
        lc.labelType === LabelType.SHOT &&
        lc.MediaRef === context.seedClip!.MediaRef &&
        lc.start >= context.seedClip!.start &&
        lc.end <= context.seedClip!.end,
    );

    if (seedShotClips.length === 0) {
      return candidates;
    }

    // Get all shot clips from the same media, sorted by time
    const allShotClips = context.labelClips
      .filter(
        (lc) =>
          lc.labelType === LabelType.SHOT &&
          lc.MediaRef === context.seedClip!.MediaRef,
      )
      .sort((a, b) => a.start - b.start);

    // For each seed shot, find adjacent shots
    for (const seedShot of seedShotClips) {
      const shotIndex = allShotClips.findIndex((s) => s.id === seedShot.id);
      if (shotIndex === -1) continue;

      // Check previous shot
      if (shotIndex > 0) {
        const prevShot = allShotClips[shotIndex - 1];
        await this.addAdjacentShotCandidate(
          prevShot,
          shotIndex - 1,
          'previous',
          context,
          candidates,
        );
      }

      // Check next shot
      if (shotIndex < allShotClips.length - 1) {
        const nextShot = allShotClips[shotIndex + 1];
        await this.addAdjacentShotCandidate(
          nextShot,
          shotIndex + 1,
          'next',
          context,
          candidates,
        );
      }
    }

    return candidates;
  }

  /**
   * Helper method to add an adjacent shot candidate
   */
  private async addAdjacentShotCandidate(
    shotClip: any,
    shotIndex: number,
    direction: 'previous' | 'next',
    context: TimelineStrategyContext,
    candidates: ScoredTimelineCandidate[],
  ): Promise<void> {
    // Find clips that contain this shot
    for (const clip of context.availableClips) {
      if (
        clip.MediaRef === shotClip.MediaRef &&
        clip.start <= shotClip.start &&
        clip.end >= shotClip.end
      ) {
        // Skip if clip is already in timeline
        const alreadyInTimeline = context.timelineClips.some(
          (tc) => tc.MediaClipRef === clip.id,
        );
        if (alreadyInTimeline) continue;

        // Skip if already added
        if (candidates.some((c) => c.clipId === clip.id)) continue;

        // Calculate score based on confidence and temporal proximity
        const timeDelta = Math.abs(shotClip.start - context.seedClip!.start);
        const proximityScore = Math.max(0, 1 - timeDelta / 60); // Within 60 seconds
        const score = (shotClip.confidence + proximityScore) / 2;

        candidates.push({
          clipId: clip.id,
          score,
          reason: `Contains ${direction} shot in sequence (shot ${shotIndex + 1})`,
          reasonData: {
            shotIndex,
            direction,
            timeDelta,
            confidence: shotClip.confidence,
            sourceClipId: context.seedClip!.id,
            labelClipIds: [shotClip.id],
          },
        });
      }
    }
  }
}
