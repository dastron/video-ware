/**
 * Property Tests for EditList Utilities
 *
 * Feature: clips-and-timelines
 *
 * Property 11: EditList Entry Structure
 * For any generated EditList entry, the entry SHALL contain: a `key` equal to the
 * TimelineClip.id, an `inputs` array containing the source Media.id, and valid
 * `startTimeOffset` and `endTimeOffset` TimeOffset objects.
 * Validates: Requirements 8.2, 8.3, 8.4
 *
 * Property 13: EditList Determinism
 * For any timeline state, generating the editList multiple times SHALL produce
 * byte-identical JSON output.
 * Validates: Requirements 8.7
 */

import { describe, it, expect } from 'vitest';
import { generateEditList, validateEditList } from '../edit-list';
import type { TimelineClip } from '../../schema/timeline-clip';

/**
 * Create a mock TimelineClip for testing
 */
function createMockTimelineClip(
  id: string,
  mediaRef: string,
  start: number,
  end: number,
  order: number
): TimelineClip {
  return {
    id,
    collectionId: 'timelineclips',
    collectionName: 'TimelineClips',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    TimelineRef: 'timeline-1',
    MediaRef: mediaRef,
    MediaClipRef: undefined,
    order,
    start,
    end,
    duration: end - start,
    meta: undefined,
    expand: {},
  };
}

/**
 * Generate random clip data for testing
 */
function generateRandomClips(count: number): TimelineClip[] {
  const clips: TimelineClip[] = [];

  for (let i = 0; i < count; i++) {
    const start = Math.random() * 50; // 0-50 seconds
    const duration = 0.5 + Math.random() * 10; // 0.5-10.5 seconds
    const end = start + duration;

    clips.push(
      createMockTimelineClip(`clip-${i}`, `media-${i}`, start, end, i)
    );
  }

  return clips;
}

describe('EditList Property Tests', () => {
  /**
   * Property 11: EditList Entry Structure
   * For any generated EditList entry, the entry SHALL contain: a `key` equal to the
   * TimelineClip.id, an `inputs` array containing the source Media.id, and valid
   * `startTimeOffset` and `endTimeOffset` TimeOffset objects.
   * Validates: Requirements 8.2, 8.3, 8.4
   */
  describe('Property 11: EditList Entry Structure', () => {
    it('should generate entries with key equal to TimelineClip.id', () => {
      // Test with 100 random clips
      const clips = generateRandomClips(100);
      const editList = generateEditList(clips);

      for (let i = 0; i < clips.length; i++) {
        expect(editList[i].key).toBe(clips[i].id);
      }
    });

    it('should generate entries with inputs array containing MediaRef', () => {
      // Test with 100 random clips
      const clips = generateRandomClips(100);
      const editList = generateEditList(clips);

      for (let i = 0; i < clips.length; i++) {
        expect(editList[i].inputs).toEqual([clips[i].MediaRef]);
        expect(editList[i].inputs.length).toBe(1);
      }
    });

    it('should generate entries with valid TimeOffset objects', () => {
      // Test with 100 random clips
      const clips = generateRandomClips(100);
      const editList = generateEditList(clips);

      for (const entry of editList) {
        // Validate startTimeOffset
        expect(typeof entry.startTimeOffset.seconds).toBe('number');
        expect(Number.isInteger(entry.startTimeOffset.seconds)).toBe(true);
        expect(entry.startTimeOffset.seconds).toBeGreaterThanOrEqual(0);

        expect(typeof entry.startTimeOffset.nanos).toBe('number');
        expect(Number.isInteger(entry.startTimeOffset.nanos)).toBe(true);
        expect(entry.startTimeOffset.nanos).toBeGreaterThanOrEqual(0);
        expect(entry.startTimeOffset.nanos).toBeLessThanOrEqual(999_999_999);

        // Validate endTimeOffset
        expect(typeof entry.endTimeOffset.seconds).toBe('number');
        expect(Number.isInteger(entry.endTimeOffset.seconds)).toBe(true);
        expect(entry.endTimeOffset.seconds).toBeGreaterThanOrEqual(0);

        expect(typeof entry.endTimeOffset.nanos).toBe('number');
        expect(Number.isInteger(entry.endTimeOffset.nanos)).toBe(true);
        expect(entry.endTimeOffset.nanos).toBeGreaterThanOrEqual(0);
        expect(entry.endTimeOffset.nanos).toBeLessThanOrEqual(999_999_999);
      }
    });

    it('should generate entries where startTimeOffset < endTimeOffset', () => {
      // Test with 100 random clips
      const clips = generateRandomClips(100);
      const editList = generateEditList(clips);

      for (const entry of editList) {
        const startTotal =
          entry.startTimeOffset.seconds +
          entry.startTimeOffset.nanos / 1_000_000_000;
        const endTotal =
          entry.endTimeOffset.seconds +
          entry.endTimeOffset.nanos / 1_000_000_000;

        expect(startTotal).toBeLessThan(endTotal);
      }
    });

    it('should pass validation for all generated editLists', () => {
      // Test with 100 random clips
      const clips = generateRandomClips(100);
      const editList = generateEditList(clips);

      const result = validateEditList(editList);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  /**
   * Property 13: EditList Determinism
   * For any timeline state, generating the editList multiple times SHALL produce
   * byte-identical JSON output.
   * Validates: Requirements 8.7
   */
  describe('Property 13: EditList Determinism', () => {
    it('should produce identical JSON output for same input', () => {
      // Test with 100 different clip sets
      for (let test = 0; test < 100; test++) {
        const clips = generateRandomClips(5);

        // Generate editList multiple times
        const editList1 = generateEditList(clips);
        const editList2 = generateEditList(clips);
        const editList3 = generateEditList(clips);

        // Convert to JSON and compare
        const json1 = JSON.stringify(editList1);
        const json2 = JSON.stringify(editList2);
        const json3 = JSON.stringify(editList3);

        expect(json1).toBe(json2);
        expect(json2).toBe(json3);
      }
    });

    it('should produce identical output for empty clip arrays', () => {
      const clips: TimelineClip[] = [];

      const editList1 = generateEditList(clips);
      const editList2 = generateEditList(clips);

      const json1 = JSON.stringify(editList1);
      const json2 = JSON.stringify(editList2);

      expect(json1).toBe(json2);
      expect(editList1).toEqual([]);
    });

    it('should produce identical output for single clip', () => {
      // Test with 100 different single clips
      for (let test = 0; test < 100; test++) {
        const clips = generateRandomClips(1);

        const editList1 = generateEditList(clips);
        const editList2 = generateEditList(clips);

        const json1 = JSON.stringify(editList1);
        const json2 = JSON.stringify(editList2);

        expect(json1).toBe(json2);
      }
    });

    it('should produce different output for different inputs', () => {
      // Generate two different clip sets
      const clips1 = generateRandomClips(5);
      const clips2 = generateRandomClips(5);

      const editList1 = generateEditList(clips1);
      const editList2 = generateEditList(clips2);

      const json1 = JSON.stringify(editList1);
      const json2 = JSON.stringify(editList2);

      // They should be different (unless by extreme coincidence)
      expect(json1).not.toBe(json2);
    });
  });

  /**
   * Additional validation tests
   */
  describe('EditList Validation', () => {
    it('should reject editList with empty key', () => {
      const editList = [
        {
          key: '',
          inputs: ['media-1'],
          startTimeOffset: { seconds: 0, nanos: 0 },
          endTimeOffset: { seconds: 10, nanos: 0 },
        },
      ];

      const result = validateEditList(editList);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_KEY')).toBe(true);
    });

    it('should reject editList with empty inputs', () => {
      const editList = [
        {
          key: 'clip-1',
          inputs: [],
          startTimeOffset: { seconds: 0, nanos: 0 },
          endTimeOffset: { seconds: 10, nanos: 0 },
        },
      ];

      const result = validateEditList(editList);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_INPUTS')).toBe(true);
    });

    it('should reject editList with negative seconds', () => {
      const editList = [
        {
          key: 'clip-1',
          inputs: ['media-1'],
          startTimeOffset: { seconds: -1, nanos: 0 },
          endTimeOffset: { seconds: 10, nanos: 0 },
        },
      ];

      const result = validateEditList(editList);
      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.code === 'INVALID_SECONDS_NEGATIVE')
      ).toBe(true);
    });

    it('should reject editList with nanos out of range', () => {
      const editList = [
        {
          key: 'clip-1',
          inputs: ['media-1'],
          startTimeOffset: { seconds: 0, nanos: 1_000_000_000 },
          endTimeOffset: { seconds: 10, nanos: 0 },
        },
      ];

      const result = validateEditList(editList);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_NANOS_RANGE')).toBe(
        true
      );
    });

    it('should reject editList with start >= end', () => {
      const editList = [
        {
          key: 'clip-1',
          inputs: ['media-1'],
          startTimeOffset: { seconds: 10, nanos: 0 },
          endTimeOffset: { seconds: 5, nanos: 0 },
        },
      ];

      const result = validateEditList(editList);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'INVALID_TIME_RANGE')).toBe(
        true
      );
    });
  });
});
