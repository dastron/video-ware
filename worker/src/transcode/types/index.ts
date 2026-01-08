/**
 * Transcode types index
 * Re-exports all transcode-related types and defines step result types
 */

// Re-export step input types
export type {
  ProbeStepInput,
  ThumbnailStepInput,
  SpriteStepInput,
  TranscodeStepInput,
  FinalizeStepInput,
} from './step-inputs';

// Import shared types for result definitions
import type { ProbeOutput, ProcessUploadResult } from '@project/shared';

/**
 * Output from the PROBE step
 */
export interface ProbeStepOutput {
  /** Probe metadata extracted from the media file */
  probeOutput: ProbeOutput;
}

/**
 * Output from the THUMBNAIL step
 */
export interface ThumbnailStepOutput {
  /** Path to the generated thumbnail file */
  thumbnailPath: string;
}

/**
 * Output from the SPRITE step
 */
export interface SpriteStepOutput {
  /** Path to the generated sprite sheet file */
  spritePath: string;
}

/**
 * Output from the TRANSCODE step
 */
export interface TranscodeStepOutput {
  /** Path to the transcoded proxy file */
  proxyPath: string;
}

/**
 * Output from the FINALIZE step
 */
export interface FinalizeStepOutput {
  /** Result containing IDs of created records */
  result: ProcessUploadResult;
}

/**
 * Union type of all transcode step outputs
 */
export type TranscodeStepResult =
  | ProbeStepOutput
  | ThumbnailStepOutput
  | SpriteStepOutput
  | TranscodeStepOutput
  | FinalizeStepOutput;
