import type { MediaProcessor } from '@project/shared';
import { ProcessingProvider } from '@project/shared';
import { FFmpegProcessor } from './ffmpeg';

/**
 * Factory function to get the appropriate media processor based on provider
 * @param provider - The processing provider to use
 * @returns An instance of the appropriate MediaProcessor implementation
 * @throws Error if the provider is not supported
 */
export function getProcessor(provider: ProcessingProvider): MediaProcessor {
  switch (provider) {
    case ProcessingProvider.FFMPEG:
      return new FFmpegProcessor();

    case ProcessingProvider.GOOGLE_TRANSCODER:
      // TODO: Implement GoogleTranscoderProcessor
      throw new Error(
        `Provider ${provider} is not yet implemented. Use ${ProcessingProvider.FFMPEG} instead.`
      );

    case ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE:
      // TODO: Implement GoogleVideoIntelligenceProcessor
      throw new Error(
        `Provider ${provider} is not yet implemented. Use ${ProcessingProvider.FFMPEG} instead.`
      );

    case ProcessingProvider.GOOGLE_SPEECH:
      // TODO: Implement GoogleSpeechProcessor
      throw new Error(
        `Provider ${provider} is not yet implemented. Use ${ProcessingProvider.FFMPEG} instead.`
      );

    default:
      throw new Error(`Unknown processing provider: ${provider}`);
  }
}

// Export processor implementations
export { FFmpegProcessor } from './ffmpeg';
