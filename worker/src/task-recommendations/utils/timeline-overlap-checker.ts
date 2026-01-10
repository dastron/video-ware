/**
 * Timeline Overlap Checker
 *
 * This module provides utilities for checking and filtering timeline recommendations
 * to avoid overlapping timecode ranges with existing TimelineClips.
 *
 * Requirements: 5.3, 5.5
 */

import { Logger } from '@nestjs/common';
import type {
  TimelineClip,
  MediaClip,
  RecommendationTargetMode,
} from '@project/shared';

/**
 * Represents an occupied timecode range in a timeline
 */
export interface OccupiedRange {
  start: number;
  end: number;
  clipId: string; // TimelineClip ID for reference
}

/**
 * Result of overlap check for a candidate clip
 */
export interface OverlapCheckResult {
  hasOverlap: boolean;
  overlappingRanges: OccupiedRange[];
}

/**
 * TimelineOverlapChecker handles overlap detection and filtering for timeline recommendations.
 *
 * Key responsibilities:
 * - Build occupied timecode ranges from existing TimelineClips
 * - Check if candidate clips overlap with occupied ranges
 * - Filter candidates to exclude overlapping clips
 * - Support both append and replace target modes
 *
 * Requirements: 5.3, 5.5
 */
export class TimelineOverlapChecker {
  private readonly logger = new Logger(TimelineOverlapChecker.name);

  /**
   * Build occupied timecode ranges from existing timeline clips.
   *
   * Each TimelineClip occupies a range [start, end) in the source media.
   * This method extracts all occupied ranges for overlap checking.
   *
   * @param timelineClips - Existing clips in the timeline
   * @returns Array of occupied ranges sorted by start time
   */
  buildOccupiedRanges(timelineClips: TimelineClip[]): OccupiedRange[] {
    const ranges: OccupiedRange[] = timelineClips.map((clip) => ({
      start: clip.start,
      end: clip.end,
      clipId: clip.id,
    }));

    // Sort by start time for efficient overlap checking
    ranges.sort((a, b) => a.start - b.start);

    return ranges;
  }

  /**
   * Check if a candidate clip overlaps with any occupied ranges.
   *
   * Two ranges overlap if they share any timecode:
   * - Range A: [startA, endA)
   * - Range B: [startB, endB)
   * - Overlap if: startA < endB AND startB < endA
   *
   * @param candidateClip - MediaClip to check for overlap
   * @param occupiedRanges - Occupied ranges in the timeline
   * @returns Overlap check result with details
   */
  checkOverlap(
    candidateClip: MediaClip,
    occupiedRanges: OccupiedRange[]
  ): OverlapCheckResult {
    const candidateStart = candidateClip.start;
    const candidateEnd = candidateClip.end;

    const overlapping: OccupiedRange[] = [];

    for (const range of occupiedRanges) {
      // Check for overlap: candidateStart < range.end AND range.start < candidateEnd
      if (candidateStart < range.end && range.start < candidateEnd) {
        overlapping.push(range);
      }
    }

    const hasOverlap = overlapping.length > 0;

    return {
      hasOverlap,
      overlappingRanges: overlapping,
    };
  }

  /**
   * Filter candidate clips to exclude those that overlap with occupied ranges.
   *
   * In append mode: exclude all overlapping clips
   * In replace mode: allow overlaps (user will replace existing clip)
   *
   * @param candidateClips - Array of MediaClips to filter
   * @param occupiedRanges - Occupied ranges in the timeline
   * @param targetMode - Target mode (append or replace)
   * @returns Filtered array of non-overlapping clips
   */
  filterNonOverlapping(
    candidateClips: MediaClip[],
    occupiedRanges: OccupiedRange[],
    targetMode: RecommendationTargetMode
  ): MediaClip[] {
    // In replace mode, allow overlaps (user will replace existing clip)
    if (targetMode === 'replace') {
      return candidateClips;
    }

    // In append mode, exclude overlapping clips
    const nonOverlapping = candidateClips.filter((clip) => {
      const result = this.checkOverlap(clip, occupiedRanges);
      return !result.hasOverlap;
    });

    return nonOverlapping;
  }

  /**
   * Filter candidate clip IDs to exclude those that overlap with occupied ranges.
   *
   * This is a convenience method for when you have clip IDs and need to look up
   * the full MediaClip objects.
   *
   * @param candidateClipIds - Array of MediaClip IDs to filter
   * @param clipLookup - Map of clip ID to MediaClip for lookup
   * @param occupiedRanges - Occupied ranges in the timeline
   * @param targetMode - Target mode (append or replace)
   * @returns Filtered array of non-overlapping clip IDs
   */
  filterNonOverlappingIds(
    candidateClipIds: string[],
    clipLookup: Map<string, MediaClip>,
    occupiedRanges: OccupiedRange[],
    targetMode: RecommendationTargetMode
  ): string[] {
    // In replace mode, allow all candidates
    if (targetMode === 'replace') {
      return candidateClipIds;
    }

    // In append mode, filter by overlap
    return candidateClipIds.filter((clipId) => {
      const clip = clipLookup.get(clipId);
      if (!clip) {
        this.logger.warn(`Clip ${clipId} not found in lookup, excluding`);
        return false;
      }

      const result = this.checkOverlap(clip, occupiedRanges);
      return !result.hasOverlap;
    });
  }

  /**
   * Get statistics about overlap filtering.
   *
   * @param totalCandidates - Total number of candidates before filtering
   * @param filteredCandidates - Number of candidates after filtering
   * @returns Statistics object
   */
  getFilterStats(
    totalCandidates: number,
    filteredCandidates: number
  ): {
    total: number;
    filtered: number;
    remaining: number;
    filterRate: number;
  } {
    const filtered = totalCandidates - filteredCandidates;
    const filterRate = totalCandidates > 0 ? filtered / totalCandidates : 0;

    return {
      total: totalCandidates,
      filtered,
      remaining: filteredCandidates,
      filterRate,
    };
  }
}
