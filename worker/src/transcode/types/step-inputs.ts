import type {
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  TranscodeConfig,
} from '@project/shared';
import type { ProcessingProvider } from '@project/shared';

/**
 * Input for the PROBE step
 * Extracts metadata from the uploaded media file
 */
export interface ProbeStepInput {
  type: 'probe';
  /** Path to the media file to probe */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
}

/**
 * Input for the THUMBNAIL step
 * Generates a thumbnail image from the media file
 */
export interface ThumbnailStepInput {
  type: 'thumbnail';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** Probe output from the PROBE step */
  probeOutput: ProbeOutput;
  /** Thumbnail generation configuration */
  config: ThumbnailConfig;
}

/**
 * Input for the SPRITE step
 * Generates a sprite sheet from the media file
 */
export interface SpriteStepInput {
  type: 'sprite';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** Probe output from the PROBE step */
  probeOutput: ProbeOutput;
  /** Sprite sheet generation configuration */
  config: SpriteConfig;
}

/**
 * Input for the TRANSCODE step
 * Creates a proxy/transcoded version of the media file
 */
export interface TranscodeStepInput {
  type: 'transcode';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** Probe output from the PROBE step */
  probeOutput: ProbeOutput;
  /** Processing provider to use (ffmpeg or google-transcoder) */
  provider: ProcessingProvider;
  /** Transcoding configuration */
  config: TranscodeConfig;
}

/**
 * Input for the FINALIZE step
 * Creates the Media record with references to all generated files
 */
export interface FinalizeStepInput {
  type: 'finalize';
  /** ID of the Upload record being processed */
  uploadId: string;
  /** Probe output from the PROBE step */
  probeOutput: ProbeOutput;
  /** Path to the generated thumbnail file (optional) */
  thumbnailPath?: string;
  /** Path to the generated sprite sheet file (optional) */
  spritePath?: string;
  /** Path to the transcoded proxy file (optional) */
  proxyPath?: string;
}
