/**
 * Track generation utilities for timeline-to-render conversion
 *
 * Generates the tracks array for render tasks from timeline clips.
 */

import type { TimelineTrack, TimelineSegment } from '../types/task-contracts';
import type { TimelineClip } from '../schema/timeline-clip';

/**
 * Validation result for validation
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validation error details
 */
export interface ValidationError {
  code: string;
  message: string;
  itemId?: string;
  itemType?: 'timeline' | 'timelineClip' | 'mediaClip' | 'media';
  field?: string;
  expected?: unknown;
  actual?: unknown;
}

/**
 * Generate Tracks from timeline clips
 *
 * Converts TimelineClip records into a multi-track structure suitable for rendering.
 * Currently maps all clips to a single video track (Layer 0).
 * Future updates can separate tracks based on clip metadata (e.g. audio clips, overlay clips).
 *
 * @param timelineClips - Array of TimelineClip records (should be sorted by order)
 * @returns Array of TimelineTrack objects
 */
export function generateTracks(timelineClips: TimelineClip[]): TimelineTrack[] {
  // For now, we assume all clips are sequential video segments on one track.
  // In the future, we can look at clip.type or other metadata to distribute to multiple tracks.

  const videoSegments: TimelineSegment[] = timelineClips.map((clip) => ({
    id: clip.id,
    assetId: clip.MediaRef,
    type: 'video', // Defaulting to video for standard clips
    time: {
      start: clip.start, // Absolute timeline start time
      duration: clip.end - clip.start,
      sourceStart: 0, // Assuming we use the start of the source asset for now, or clip.start if it represents trimmed source.
                      // IMPORTANT: In the current simple model, 'start' usually means timeline position.
                      // If clips are sequential, 'start' is the cumulative duration.
                      // If the frontend stores 'start' and 'end' as timeline positions, we use them directly.
                      // If 'start' and 'end' meant source trimming, we'd need a different mapping.
                      // Based on context (validateTimeRange checked against media duration), 'start' and 'end' in `addClipToTimeline`
                      // seem to refer to Source Trimming if it's "offset" based, or Timeline Position?
                      // Looking at `addClipToTimeline`: checks `validateTimeRange(start, end, media.duration)`.
                      // This implies `start` and `end` are SOURCE timestamps.

                      // However, `timeline.clips` usually implies placement on timeline.
                      // `TimelineService.addClipToTimeline` sets `start` and `end`.
                      // `validateTimeRange` checks against media duration.
                      // So `start` and `end` are definitely Source Trimming times.

                      // But where is the timeline position stored?
                      // `order` is stored. Sequential playback implies timeline position is calculated from previous clip durations.
                      //
                      // The current `TimelineService` uses `order` to sort.
                      // `duration` calculation sums (end - start).
                      // This confirms they are played sequentially.

                      // So:
                      // Segment Duration = clip.end - clip.start
                      // Segment Source Start = clip.start
                      // Segment Timeline Start = Sum of previous segments' durations
    },
  }));

  // Calculate timeline start times for sequential playback
  let currentTimelineTime = 0;
  const positionedSegments = videoSegments.map(seg => {
      const duration = seg.time.duration;
      const positionedSeg = {
          ...seg,
          time: {
              ...seg.time,
              start: currentTimelineTime,
              sourceStart: seg.time.start // Map the original 'start' to sourceStart
          }
      };
      currentTimelineTime += duration;
      return positionedSeg;
  });

  const mainTrack: TimelineTrack = {
    id: 'main-video-track',
    type: 'video',
    layer: 0,
    segments: positionedSegments,
  };

  return [mainTrack];
}

/**
 * Legacy EditList function for backward compatibility until refactor is complete
 * @deprecated Use generateTracks instead
 */
export function generateEditList(timelineClips: TimelineClip[]): any[] {
    // This function acts as a placeholder or bridge if needed,
    // but we are migrating away from EditList type.
    // We return an empty array or throw to signal deprecation if called.
    return [];
}

// We no longer strictly need validateEditList if we validate tracks differently,
// but we might keep `validateTracks` in future.

/**
 * Validate a TimeOffset object
 *
 * @param offset - TimeOffset to validate
 * @param context - Context string for error messages
 * @param field - Field name for error messages
 * @returns Array of validation errors (empty if valid)
 */
function validateTimeOffset(
  offset: unknown,
  context: string,
  field: string
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!offset || typeof offset !== 'object') {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field}`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Type guard: check if offset has required properties
  if (!('seconds' in offset) || !('nanos' in offset)) {
    errors.push({
      code: 'INVALID_TIME_OFFSET',
      message: `${context} has invalid ${field} (missing required properties)`,
      field,
      actual: offset,
    });
    return errors;
  }

  // Validate seconds
  if (typeof offset.seconds !== 'number') {
    errors.push({
      code: 'INVALID_SECONDS_TYPE',
      message: `${context} ${field}.seconds is not a number`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (!Number.isInteger(offset.seconds)) {
    errors.push({
      code: 'INVALID_SECONDS_INTEGER',
      message: `${context} ${field}.seconds is not an integer`,
      field: `${field}.seconds`,
      actual: offset.seconds,
    });
  } else if (offset.seconds < 0) {
    errors.push({
      code: 'INVALID_SECONDS_NEGATIVE',
      message: `${context} ${field}.seconds is negative`,
      field: `${field}.seconds`,
      expected: '>= 0',
      actual: offset.seconds,
    });
  }

  // Validate nanos
  if (typeof offset.nanos !== 'number') {
    errors.push({
      code: 'INVALID_NANOS_TYPE',
      message: `${context} ${field}.nanos is not a number`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (!Number.isInteger(offset.nanos)) {
    errors.push({
      code: 'INVALID_NANOS_INTEGER',
      message: `${context} ${field}.nanos is not an integer`,
      field: `${field}.nanos`,
      actual: offset.nanos,
    });
  } else if (offset.nanos < 0 || offset.nanos > 999_999_999) {
    errors.push({
      code: 'INVALID_NANOS_RANGE',
      message: `${context} ${field}.nanos is out of range [0, 999999999]`,
      field: `${field}.nanos`,
      expected: '[0, 999999999]',
      actual: offset.nanos,
    });
  }

  return errors;
}
