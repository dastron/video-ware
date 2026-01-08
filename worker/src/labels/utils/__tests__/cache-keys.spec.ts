import { describe, it, expect } from 'vitest';
import { ProcessingProvider } from '@project/shared';
import { getLabelCachePath } from '../cache-keys';

describe('getLabelCachePath', () => {
  it('should generate correct cache path format', () => {
    const path = getLabelCachePath(
      'media123',
      1,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );

    expect(path).toBe('labels/media123/v1/google_video_intelligence.json');
  });

  it('should handle different versions', () => {
    const path = getLabelCachePath(
      'media456',
      5,
      ProcessingProvider.GOOGLE_SPEECH
    );

    expect(path).toBe('labels/media456/v5/google_speech.json');
  });

  it('should handle different providers', () => {
    const videoPath = getLabelCachePath(
      'media789',
      2,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );
    const speechPath = getLabelCachePath(
      'media789',
      2,
      ProcessingProvider.GOOGLE_SPEECH
    );

    expect(videoPath).toBe('labels/media789/v2/google_video_intelligence.json');
    expect(speechPath).toBe('labels/media789/v2/google_speech.json');
  });

  it('should create unique paths for different media IDs', () => {
    const path1 = getLabelCachePath(
      'media1',
      1,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );
    const path2 = getLabelCachePath(
      'media2',
      1,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );

    expect(path1).not.toBe(path2);
    expect(path1).toBe('labels/media1/v1/google_video_intelligence.json');
    expect(path2).toBe('labels/media2/v1/google_video_intelligence.json');
  });
});
