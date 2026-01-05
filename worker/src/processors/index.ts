import {
  type MediaProcessor,
  ProcessingProvider,
  type TypedPocketBase
} from '@project/shared';
import { FFmpegProcessor } from './transcode/ffmpeg.js';
import { GoogleTranscoderProcessor } from './transcode/google-transcoder.js';
import { GoogleVideoIntelligenceProcessor } from './intelligence/google-intelligence.js';
import { processorConfig } from '../config.js';

/**
 * Factory function to get the appropriate media processor based on provider
 * @param provider - The processing provider to use
 * @param pb - Optional PocketBase client for file resolution
 * @returns An instance of the appropriate MediaProcessor implementation
 * @throws Error if the provider is not supported or disabled
 */
export function getProcessor(
  provider: ProcessingProvider,
  pb?: TypedPocketBase
): MediaProcessor {
  switch (provider) {
    case ProcessingProvider.FFMPEG:
      if (!processorConfig.ENABLE_FFMPEG) {
        throw new Error(`Provider ${provider} is disabled in configuration.`);
      }
      return new FFmpegProcessor(pb);

    case ProcessingProvider.GOOGLE_TRANSCODER:
      if (!processorConfig.ENABLE_GOOGLE_TRANSCODER) {
        throw new Error(`Provider ${provider} is disabled in configuration.`);
      }
      return new GoogleTranscoderProcessor(pb);

    case ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE:
      if (!processorConfig.ENABLE_GOOGLE_VIDEO_INTELLIGENCE) {
        throw new Error(`Provider ${provider} is disabled in configuration.`);
      }
      return new GoogleVideoIntelligenceProcessor(pb);

    case ProcessingProvider.GOOGLE_SPEECH:
      if (!processorConfig.ENABLE_GOOGLE_SPEECH) {
        throw new Error(`Provider ${provider} is disabled in configuration.`);
      }
      // TODO: Implement GoogleSpeechProcessor
      throw new Error(
        `Provider ${provider} is not yet implemented. Use ${ProcessingProvider.FFMPEG} instead.`
      );

    default:
      throw new Error(`Unknown processing provider: ${provider}`);
  }
}

// Export processor implementations
export { FFmpegProcessor } from './transcode/ffmpeg';
export { GoogleTranscoderProcessor } from './transcode/google-transcoder';
export { GoogleVideoIntelligenceProcessor } from './intelligence/google-intelligence';
