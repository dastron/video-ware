import { ProcessingProvider } from '@project/shared';

/**
 * Generate storage path for cached label data
 *
 * @param mediaId - Media record ID
 * @param version - Data version number
 * @param provider - Processing provider (e.g., google_video_intelligence, google_speech)
 * @returns Storage path in format: labels/{mediaId}/v{version}/{provider}.json
 *
 * @example
 * getLabelCachePath('abc123', 1, ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE)
 * // Returns: 'labels/abc123/v1/google_video_intelligence.json'
 */
export function getLabelCachePath(
  mediaId: string,
  version: number,
  provider: ProcessingProvider
): string {
  return `labels/${mediaId}/v${version}/${provider}.json`;
}
