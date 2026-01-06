/**
 * EditList utilities for timeline-to-render conversion
 *
 * EditList is the canonical format for render tasks, containing ordered entries
 * with time offsets and media references.
 */

import type { EditList, EditListEntry } from '../types/video-ware';
import type { TimelineClip } from '../schema/timeline-clip';
import { toTimeOffset } from './time';

/**
 * Validation result for editList validation
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
 * Generate an EditList from timeline clips
 *
 * Converts TimelineClip records into EditListEntry format suitable for rendering.
 * Clips should be pre-sorted by order field.
 *
 * @param timelineClips - Array of TimelineClip records (should be sorted by order)
 * @returns EditList array ready for render task
 *
 * @example
 * const clips = [
 *   { id: 'clip1', MediaRef: 'media1', start: 0, end: 10, order: 0 },
 *   { id: 'clip2', MediaRef: 'media2', start: 5, end: 15, order: 1 },
 * ];
 * const editList = generateEditList(clips);
 * // [
 * //   { key: 'clip1', inputs: ['media1'], startTimeOffset: {...}, endTimeOffset: {...} },
 * //   { key: 'clip2', inputs: ['media2'], startTimeOffset: {...}, endTimeOffset: {...} }
 * // ]
 */
export function generateEditList(timelineClips: TimelineClip[]): EditList {
  return timelineClips.map((clip) => {
    const entry: EditListEntry = {
      key: clip.id,
      inputs: [clip.MediaRef],
      startTimeOffset: toTimeOffset(clip.start),
      endTimeOffset: toTimeOffset(clip.end),
    };
    return entry;
  });
}

/**
 * Validate an EditList structure
 *
 * Checks that all entries have required fields and valid TimeOffset values.
 *
 * @param editList - EditList to validate
 * @returns ValidationResult with any errors found
 *
 * Validation checks:
 * - Each entry has a non-empty key
 * - Each entry has at least one input
 * - TimeOffset.seconds is non-negative integer
 * - TimeOffset.nanos is integer in range [0, 999,999,999]
 * - startTimeOffset < endTimeOffset
 *
 * @example
 * const result = validateEditList(editList);
 * if (!result.valid) {
 *   console.error('Validation errors:', result.errors);
 * }
 */
export function validateEditList(editList: EditList): ValidationResult {
  const errors: ValidationError[] = [];

  editList.forEach((entry, index) => {
    // Validate key
    if (
      !entry.key ||
      typeof entry.key !== 'string' ||
      entry.key.trim() === ''
    ) {
      errors.push({
        code: 'INVALID_KEY',
        message: `Entry at index ${index} has invalid or empty key`,
        field: 'key',
        actual: entry.key,
      });
    }

    // Validate inputs
    if (!Array.isArray(entry.inputs) || entry.inputs.length === 0) {
      errors.push({
        code: 'INVALID_INPUTS',
        message: `Entry at index ${index} has no inputs`,
        field: 'inputs',
        actual: entry.inputs,
      });
    } else {
      entry.inputs.forEach((input, inputIndex) => {
        if (!input || typeof input !== 'string' || input.trim() === '') {
          errors.push({
            code: 'INVALID_INPUT',
            message: `Entry at index ${index}, input at index ${inputIndex} is invalid`,
            field: `inputs[${inputIndex}]`,
            actual: input,
          });
        }
      });
    }

    // Validate startTimeOffset
    const startErrors = validateTimeOffset(
      entry.startTimeOffset,
      `Entry at index ${index}`,
      'startTimeOffset'
    );
    errors.push(...startErrors);

    // Validate endTimeOffset
    const endErrors = validateTimeOffset(
      entry.endTimeOffset,
      `Entry at index ${index}`,
      'endTimeOffset'
    );
    errors.push(...endErrors);

    // Validate start < end
    if (startErrors.length === 0 && endErrors.length === 0) {
      const startTotal =
        entry.startTimeOffset.seconds +
        entry.startTimeOffset.nanos / 1_000_000_000;
      const endTotal =
        entry.endTimeOffset.seconds + entry.endTimeOffset.nanos / 1_000_000_000;

      if (startTotal >= endTotal) {
        errors.push({
          code: 'INVALID_TIME_RANGE',
          message: `Entry at index ${index} has startTimeOffset >= endTimeOffset`,
          field: 'timeRange',
          expected: 'start < end',
          actual: { start: startTotal, end: endTotal },
        });
      }
    }
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

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
