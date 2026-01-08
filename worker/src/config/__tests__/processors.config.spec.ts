import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ProcessorsConfigService } from '../processors.config';

describe('ProcessorsConfigService', () => {
  let service: ProcessorsConfigService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProcessorsConfigService,
        {
          provide: ConfigService,
          useValue: {
            get: vi.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ProcessorsConfigService>(ProcessorsConfigService);
    configService = module.get<ConfigService>(ConfigService);
  });

  describe('processor enablement', () => {
    it('should return true for enableLabelDetection by default', () => {
      vi.spyOn(configService, 'get').mockReturnValue('true');
      expect(service.enableLabelDetection).toBe(true);
    });

    it('should return false for enableObjectTracking by default', () => {
      vi.spyOn(configService, 'get').mockReturnValue('false');
      expect(service.enableObjectTracking).toBe(false);
    });

    it('should return false for enableFaceDetection by default', () => {
      vi.spyOn(configService, 'get').mockReturnValue('false');
      expect(service.enableFaceDetection).toBe(false);
    });

    it('should return false for enablePersonDetection by default', () => {
      vi.spyOn(configService, 'get').mockReturnValue('false');
      expect(service.enablePersonDetection).toBe(false);
    });

    it('should return true for enableSpeechTranscription by default', () => {
      vi.spyOn(configService, 'get').mockReturnValue('true');
      expect(service.enableSpeechTranscription).toBe(true);
    });
  });

  describe('getEnabledProcessors', () => {
    it('should return only enabled processors', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_LABEL_DETECTION') return 'true';
        if (key === 'ENABLE_SPEECH_TRANSCRIPTION') return 'true';
        return 'false';
      });

      const enabled = service.getEnabledProcessors();
      expect(enabled).toEqual(['LABEL_DETECTION', 'SPEECH_TRANSCRIPTION']);
    });

    it('should return empty array when all processors are disabled', () => {
      vi.spyOn(configService, 'get').mockReturnValue('false');

      const enabled = service.getEnabledProcessors();
      expect(enabled).toEqual([]);
    });

    it('should return all processors when all are enabled', () => {
      vi.spyOn(configService, 'get').mockReturnValue('true');

      const enabled = service.getEnabledProcessors();
      expect(enabled).toEqual([
        'LABEL_DETECTION',
        'OBJECT_TRACKING',
        'FACE_DETECTION',
        'PERSON_DETECTION',
        'SPEECH_TRANSCRIPTION',
      ]);
    });
  });

  describe('validateConfiguration', () => {
    it('should not throw when no processors are enabled and GCVI is disabled', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_GOOGLE_VIDEO_INTELLIGENCE') return 'false';
        return 'false';
      });

      expect(() => service.validateConfiguration()).not.toThrow();
    });

    it('should throw when GCVI is enabled but no processors are enabled', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_GOOGLE_VIDEO_INTELLIGENCE') return 'true';
        return 'false';
      });

      expect(() => service.validateConfiguration()).toThrow(
        'Google Video Intelligence is enabled but no GCVI processors are enabled'
      );
    });

    it('should throw when processors are enabled but GOOGLE_PROJECT_ID is missing', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_LABEL_DETECTION') return 'true';
        if (key === 'GOOGLE_PROJECT_ID') return undefined;
        return 'false';
      });

      expect(() => service.validateConfiguration()).toThrow(
        'GOOGLE_PROJECT_ID is required when GCVI processors are enabled'
      );
    });

    it('should throw when processors are enabled but credentials are missing', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_LABEL_DETECTION') return 'true';
        if (key === 'GOOGLE_PROJECT_ID') return 'test-project';
        if (key === 'GOOGLE_CLOUD_KEY_FILE') return undefined;
        if (key === 'GOOGLE_CLOUD_CREDENTIALS') return undefined;
        return 'false';
      });

      expect(() => service.validateConfiguration()).toThrow(
        'Either GOOGLE_CLOUD_KEY_FILE or GOOGLE_CLOUD_CREDENTIALS is required'
      );
    });

    it('should throw when processors are enabled but GCS_BUCKET is missing', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_LABEL_DETECTION') return 'true';
        if (key === 'GOOGLE_PROJECT_ID') return 'test-project';
        if (key === 'GOOGLE_CLOUD_KEY_FILE') return '/path/to/key.json';
        if (key === 'GCS_BUCKET') return undefined;
        return 'false';
      });

      expect(() => service.validateConfiguration()).toThrow(
        'GCS_BUCKET is required when GCVI processors are enabled'
      );
    });

    it('should not throw when all required configuration is present', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_LABEL_DETECTION') return 'true';
        if (key === 'GOOGLE_PROJECT_ID') return 'test-project';
        if (key === 'GOOGLE_CLOUD_KEY_FILE') return '/path/to/key.json';
        if (key === 'GCS_BUCKET') return 'test-bucket';
        return 'false';
      });

      expect(() => service.validateConfiguration()).not.toThrow();
    });
  });

  describe('hasEnabledProcessors', () => {
    it('should return true when at least one processor is enabled', () => {
      vi.spyOn(configService, 'get').mockImplementation((key: string) => {
        if (key === 'ENABLE_LABEL_DETECTION') return 'true';
        return 'false';
      });

      expect(service.hasEnabledProcessors).toBe(true);
    });

    it('should return false when no processors are enabled', () => {
      vi.spyOn(configService, 'get').mockReturnValue('false');

      expect(service.hasEnabledProcessors).toBe(false);
    });
  });
});
