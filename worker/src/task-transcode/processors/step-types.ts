/**
 * Transcode step input and output types
 * Used by step processors to define their contracts
 */

import type {
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  FilmstripConfig,
  TranscodeConfig,
  ProcessUploadResult,
  ProcessingProvider,
} from '@project/shared';

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
  /** ID of the Media record being processed */
  mediaId: string;
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
  /** ID of the Media record being processed */
  mediaId: string;
  /** Sprite sheet generation configuration */
  config: SpriteConfig;
}

/**
 * Input for the FILMSTRIP step
 * Generates a filmstrip from the media file
 */
export interface FilmstripStepInput {
  type: 'filmstrip';
  /** Path to the media file */
  filePath: string;
  /** ID of the Upload record being processed */
  uploadId: string;
  /** ID of the Media record being processed */
  mediaId: string;
  /** Filmstrip generation configuration */
  config: FilmstripConfig;
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
  /** ID of the Media record being processed */
  mediaId: string;
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
  /** Path to the generated filmstrip file (optional) */
  filmstripPath?: string;
  /** Path to the transcoded proxy file (optional) */
  proxyPath?: string;
}

/**
 * Output from the PROBE step
 */
export interface ProbeStepOutput {
  /** Probe metadata extracted from the media file */
  probeOutput: ProbeOutput;
  /** ID of the created Media record */
  mediaId: string;
}

/**
 * Output from the THUMBNAIL step
 */
export interface ThumbnailStepOutput {
  /** Path to the generated thumbnail file */
  thumbnailPath: string;
  /** ID of the created File record */
  thumbnailFileId: string;
}

/**
 * Output from the SPRITE step
 */
export interface SpriteStepOutput {
  /** Path to the generated sprite sheet file */
  spritePath: string;
  /** ID of the created File record */
  spriteFileId: string;
}

/**
 * Output from the FILMSTRIP step
 */
export interface FilmstripStepOutput {
  /** Path to the generated filmstrip file */
  filmstripPath: string;
  /** ID of the created File record */
  filmstripFileId: string;
  /** IDs of all generated filmstrip file records */
  allFilmstripFileIds?: string[];
}

/**
 * Output from the TRANSCODE step
 */
export interface TranscodeStepOutput {
  /** Path to the transcoded proxy file */
  proxyPath: string;
  /** ID of the created File record */
  proxyFileId: string;
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
  | FilmstripStepOutput
  | TranscodeStepOutput
  | FinalizeStepOutput;
