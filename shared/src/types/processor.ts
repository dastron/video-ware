import type { ProcessingProvider } from '../enums.js';
import type {
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  TranscodeConfig,
} from './task-contracts.js';

/**
 * Media processor interface
 * All media processing backends (FFmpeg, Google Cloud, etc.) must implement this interface
 */
export interface MediaProcessor {
  /** The processing provider this processor implements */
  readonly provider: ProcessingProvider;

  /** Version identifier for this processor (e.g., "7.0.1" for FFmpeg) */
  readonly version: string;

  /**
   * Probe a media file to extract metadata
   * @param fileRef - Reference to the file (PocketBase file path or File record ID)
   * @returns Metadata about the media file
   */
  probe(fileRef: string): Promise<ProbeOutput>;

  /**
   * Generate a thumbnail image from the media file
   * @param fileRef - Reference to the source media file
   * @param config - Thumbnail generation configuration
   * @returns Path or URL to the generated thumbnail file
   */
  generateThumbnail(fileRef: string, config: ThumbnailConfig): Promise<string>;

  /**
   * Generate a sprite sheet from the media file
   * @param fileRef - Reference to the source media file
   * @param config - Sprite sheet generation configuration
   * @returns Path or URL to the generated sprite sheet file
   */
  generateSprite(fileRef: string, config: SpriteConfig): Promise<string>;

  /**
   * Transcode the media file to a different format (optional)
   * @param fileRef - Reference to the source media file
   * @param config - Transcoding configuration
   * @returns Path or URL to the transcoded file
   */
  transcode?(fileRef: string, config: TranscodeConfig): Promise<string>;
}
