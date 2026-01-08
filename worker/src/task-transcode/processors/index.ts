/**
 * Transcode Processors
 *
 * Step processors for the transcode queue.
 * Each processor handles a specific step in the media processing pipeline.
 *
 * Architecture:
 * - Processors orchestrate the step execution
 * - Executors perform the actual media operations
 * - PocketBase service handles database operations
 */

export { TranscodeParentProcessor } from './transcode-parent.processor';
export { ProbeStepProcessor } from './probe-step.processor';
export { ThumbnailStepProcessor } from './thumbnail-step.processor';
export { SpriteStepProcessor } from './sprite-step.processor';
export { TranscodeStepProcessor } from './transcode-step.processor';

// Re-export step types for external use
export type {
  ProbeStepInput,
  ProbeStepOutput,
  ThumbnailStepInput,
  ThumbnailStepOutput,
  SpriteStepInput,
  SpriteStepOutput,
  TranscodeStepInput,
  TranscodeStepOutput,
  FinalizeStepInput,
  FinalizeStepOutput,
  TranscodeStepResult,
} from './step-types';
