/**
 * Unit tests for TimelineOverlapChecker
 *
 * These tests verify the core overlap detection and filtering logic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineOverlapChecker } from '../timeline-overlap-checker';
import type { TimelineClip, MediaClip } from '@project/shared';
import { RecommendationTargetMode } from '@project/shared';

describe('TimelineOverlapChecker', () => {
  let checker: TimelineOverlapChecker;

  beforeEach(() => {
    checker = new TimelineOverlapChecker();
  });

  describe('buildOccupiedRanges', () => {
    it('should build occupied ranges from timeline clips', () => {
      const timelineClips: TimelineClip[] = [
        {
          id: 'clip1',
          start: 10,
          end: 20,
          order: 0,
        } as TimelineClip,
        {
          id: 'clip2',
          start: 30,
          end: 40,
          order: 1,
        } as TimelineClip,
      ];

      const ranges = checker.buildOccupiedRanges(timelineClips);

      expect(ranges).toHaveLength(2);
      expect(ranges[0]).toEqual({ start: 10, end: 20, clipId: 'clip1' });
      expect(ranges[1]).toEqual({ start: 30, end: 40, clipId: 'clip2' });
    });

    it('should sort ranges by start time', () => {
      const timelineClips: TimelineClip[] = [
        {
          id: 'clip2',
          start: 30,
          end: 40,
          order: 1,
        } as TimelineClip,
        {
          id: 'clip1',
          start: 10,
          end: 20,
          order: 0,
        } as TimelineClip,
      ];

      const ranges = checker.buildOccupiedRanges(timelineClips);

      expect(ranges[0].clipId).toBe('clip1');
      expect(ranges[1].clipId).toBe('clip2');
    });

    it('should handle empty timeline clips', () => {
      const ranges = checker.buildOccupiedRanges([]);
      expect(ranges).toHaveLength(0);
    });
  });

  describe('checkOverlap', () => {
    it('should detect overlap when candidate is within occupied range', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 15,
        end: 18,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(true);
      expect(result.overlappingRanges).toHaveLength(1);
      expect(result.overlappingRanges[0].clipId).toBe('clip1');
    });

    it('should detect overlap when candidate overlaps start of occupied range', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 5,
        end: 15,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(true);
    });

    it('should detect overlap when candidate overlaps end of occupied range', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 15,
        end: 25,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(true);
    });

    it('should detect overlap when candidate completely contains occupied range', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 5,
        end: 25,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(true);
    });

    it('should not detect overlap when candidate is before occupied range', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 0,
        end: 5,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(false);
      expect(result.overlappingRanges).toHaveLength(0);
    });

    it('should not detect overlap when candidate is after occupied range', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 25,
        end: 30,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(false);
    });

    it('should not detect overlap when candidate ends exactly where occupied range starts', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 5,
        end: 10,
      } as MediaClip;

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'clip1' }];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(false);
    });

    it('should detect overlap with multiple occupied ranges', () => {
      const candidateClip: MediaClip = {
        id: 'candidate',
        start: 15,
        end: 35,
      } as MediaClip;

      const occupiedRanges = [
        { start: 10, end: 20, clipId: 'clip1' },
        { start: 30, end: 40, clipId: 'clip2' },
      ];

      const result = checker.checkOverlap(candidateClip, occupiedRanges);

      expect(result.hasOverlap).toBe(true);
      expect(result.overlappingRanges).toHaveLength(2);
    });
  });

  describe('filterNonOverlapping', () => {
    it('should filter out overlapping clips in append mode', () => {
      const candidateClips: MediaClip[] = [
        { id: 'clip1', start: 5, end: 15 } as MediaClip, // overlaps
        { id: 'clip2', start: 25, end: 30 } as MediaClip, // no overlap
        { id: 'clip3', start: 35, end: 45 } as MediaClip, // overlaps
      ];

      const occupiedRanges = [
        { start: 10, end: 20, clipId: 'occupied1' },
        { start: 40, end: 50, clipId: 'occupied2' },
      ];

      const filtered = checker.filterNonOverlapping(
        candidateClips,
        occupiedRanges,
        RecommendationTargetMode.APPEND
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('clip2');
    });

    it('should allow all clips in replace mode', () => {
      const candidateClips: MediaClip[] = [
        { id: 'clip1', start: 5, end: 15 } as MediaClip,
        { id: 'clip2', start: 25, end: 30 } as MediaClip,
        { id: 'clip3', start: 35, end: 45 } as MediaClip,
      ];

      const occupiedRanges = [
        { start: 10, end: 20, clipId: 'occupied1' },
        { start: 40, end: 50, clipId: 'occupied2' },
      ];

      const filtered = checker.filterNonOverlapping(
        candidateClips,
        occupiedRanges,
        RecommendationTargetMode.REPLACE
      );

      expect(filtered).toHaveLength(3);
      expect(filtered).toEqual(candidateClips);
    });

    it('should return all clips when no occupied ranges exist', () => {
      const candidateClips: MediaClip[] = [
        { id: 'clip1', start: 5, end: 15 } as MediaClip,
        { id: 'clip2', start: 25, end: 30 } as MediaClip,
      ];

      const filtered = checker.filterNonOverlapping(
        candidateClips,
        [],
        RecommendationTargetMode.APPEND
      );

      expect(filtered).toHaveLength(2);
      expect(filtered).toEqual(candidateClips);
    });
  });

  describe('filterNonOverlappingIds', () => {
    it('should filter clip IDs based on overlap', () => {
      const clipLookup = new Map<string, MediaClip>([
        ['clip1', { id: 'clip1', start: 5, end: 15 } as MediaClip],
        ['clip2', { id: 'clip2', start: 25, end: 30 } as MediaClip],
        ['clip3', { id: 'clip3', start: 35, end: 45 } as MediaClip],
      ]);

      const occupiedRanges = [
        { start: 10, end: 20, clipId: 'occupied1' },
        { start: 40, end: 50, clipId: 'occupied2' },
      ];

      const filtered = checker.filterNonOverlappingIds(
        ['clip1', 'clip2', 'clip3'],
        clipLookup,
        occupiedRanges,
        RecommendationTargetMode.APPEND
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0]).toBe('clip2');
    });

    it('should exclude clips not found in lookup', () => {
      const clipLookup = new Map<string, MediaClip>([
        ['clip1', { id: 'clip1', start: 5, end: 15 } as MediaClip],
      ]);

      const occupiedRanges = [{ start: 10, end: 20, clipId: 'occupied1' }];

      const filtered = checker.filterNonOverlappingIds(
        ['clip1', 'clip2'], // clip2 not in lookup
        clipLookup,
        occupiedRanges,
        RecommendationTargetMode.APPEND
      );

      expect(filtered).toHaveLength(0); // clip1 overlaps, clip2 not found
    });
  });

  describe('getFilterStats', () => {
    it('should calculate filter statistics', () => {
      const stats = checker.getFilterStats(10, 7);

      expect(stats.total).toBe(10);
      expect(stats.filtered).toBe(3);
      expect(stats.remaining).toBe(7);
      expect(stats.filterRate).toBe(0.3);
    });

    it('should handle zero candidates', () => {
      const stats = checker.getFilterStats(0, 0);

      expect(stats.total).toBe(0);
      expect(stats.filtered).toBe(0);
      expect(stats.remaining).toBe(0);
      expect(stats.filterRate).toBe(0);
    });
  });
});
