import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleCloudService } from '../google-cloud.service';
import { createMockConfigService } from '@/__mocks__/config.service';

// Hoisted mocks (vi.mock is hoisted, so any referenced bindings must be hoisted too)
const {
  mockVideoIntelligenceClient,
  mockSpeechClient,
  mockTranscoderClient,
  VideoIntelligenceServiceClientMock,
  SpeechClientMock,
  TranscoderServiceClientMock,
} = vi.hoisted(() => {
  const mockVideoIntelligenceClient = {
    initialize: vi.fn(),
    annotateVideo: vi.fn(),
  };

  const mockSpeechClient = {
    initialize: vi.fn(),
    longRunningRecognize: vi.fn(),
  };

  const mockTranscoderClient = {
    initialize: vi.fn(),
    createJob: vi.fn(),
    getJob: vi.fn(),
  };

  const VideoIntelligenceServiceClientMock = vi
    .fn()
    .mockImplementation(function () {
      return mockVideoIntelligenceClient;
    });
  const SpeechClientMock = vi.fn().mockImplementation(function () {
    return mockSpeechClient;
  });
  const TranscoderServiceClientMock = vi.fn().mockImplementation(function () {
    return mockTranscoderClient;
  });

  return {
    mockVideoIntelligenceClient,
    mockSpeechClient,
    mockTranscoderClient,
    VideoIntelligenceServiceClientMock,
    SpeechClientMock,
    TranscoderServiceClientMock,
  };
});

// Mock the Google Cloud modules
vi.mock('@google-cloud/video-intelligence', () => ({
  VideoIntelligenceServiceClient: VideoIntelligenceServiceClientMock,
  protos: {
    google: {
      cloud: {
        videointelligence: {
          v1: {
            Feature: {
              LABEL_DETECTION: 'LABEL_DETECTION',
              OBJECT_TRACKING: 'OBJECT_TRACKING',
              SHOT_CHANGE_DETECTION: 'SHOT_CHANGE_DETECTION',
            },
          },
        },
      },
    },
  },
}));

vi.mock('@google-cloud/speech', () => ({
  SpeechClient: SpeechClientMock,
}));

vi.mock('@google-cloud/video-transcoder', () => ({
  TranscoderServiceClient: TranscoderServiceClientMock,
}));

// Mock NestJS Logger to suppress console output during tests
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

describe('GoogleCloudService', () => {
  let service: GoogleCloudService;
  let configService: ReturnType<typeof createMockConfigService>;

  const mockConfig: Record<string, any> = {
    'google.projectId': 'test-project-id',
    'google.keyFilename': '/path/to/key.json',
    'processors.enableGoogleVideoIntelligence': true,
    'processors.enableGoogleSpeech': true,
    'processors.enableGoogleTranscoder': true,
  };

  beforeEach(() => {
    configService = createMockConfigService(mockConfig);
    service = new GoogleCloudService(configService);

    // Reset mocks
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should be defined', () => {
      expect(service).toBeDefined();
    });

    it('should initialize clients when project ID is configured', async () => {
      await service.onModuleInit();

      expect(mockVideoIntelligenceClient.initialize).not.toHaveBeenCalled();
      expect(mockSpeechClient.initialize).not.toHaveBeenCalled();
      expect(mockTranscoderClient.initialize).not.toHaveBeenCalled();
    });

    it('should not initialize clients when project ID is missing', async () => {
      const configServiceWithoutProjectId = createMockConfigService({
        ...mockConfig,
        'google.projectId': undefined,
      });
      const serviceWithoutProjectId = new GoogleCloudService(
        configServiceWithoutProjectId
      );
      const loggerWarnSpy = vi.spyOn(
        (serviceWithoutProjectId as any)['logger'],
        'warn'
      );

      await serviceWithoutProjectId.onModuleInit();

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        'Google Cloud Project ID not configured. Google Cloud services will be disabled.'
      );
    });

    it('should handle client initialization errors', async () => {
      const error = new Error('Authentication failed');
      VideoIntelligenceServiceClientMock.mockImplementationOnce(function () {
        throw error;
      });

      // Suppress logger errors for this test
      const loggerErrorSpy = vi
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      await expect(service.onModuleInit()).rejects.toThrow(
        'Authentication failed'
      );

      loggerErrorSpy.mockRestore();
    });
  });

  describe('analyzeVideo', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should analyze video successfully', async () => {
      const mockOperation = {
        name: 'operation-123',
        promise: vi.fn().mockResolvedValue([
          {
            annotationResults: [
              {
                segmentLabelAnnotations: [
                  {
                    entity: { description: 'person' },
                    segments: [
                      {
                        confidence: 0.9,
                        segment: {
                          startTimeOffset: { seconds: '0', nanos: '0' },
                          endTimeOffset: { seconds: '10', nanos: '0' },
                        },
                      },
                    ],
                  },
                ],
                objectAnnotations: [
                  {
                    entity: { description: 'car' },
                    confidence: 0.8,
                    frames: [
                      {
                        timeOffset: { seconds: '5', nanos: '0' },
                        normalizedBoundingBox: {
                          left: 0.1,
                          top: 0.2,
                          right: 0.9,
                          bottom: 0.8,
                        },
                      },
                    ],
                  },
                ],
                shotAnnotations: [
                  {
                    startTimeOffset: { seconds: '0', nanos: '0' },
                  },
                ],
              },
            ],
          },
        ]),
      };

      mockVideoIntelligenceClient.annotateVideo.mockResolvedValue([
        mockOperation,
      ]);

      const result = await service.analyzeVideo('gs://bucket/video.mp4');

      expect(result).toEqual({
        labels: [
          {
            entity: 'person',
            confidence: 0.9,
            segments: [
              {
                startTime: 0,
                endTime: 10,
                confidence: 0.9,
              },
            ],
          },
        ],
        objects: [
          {
            entity: 'car',
            confidence: 0.8,
            frames: [
              {
                timeOffset: 5,
                boundingBox: {
                  left: 0.1,
                  top: 0.2,
                  right: 0.9,
                  bottom: 0.8,
                },
              },
            ],
          },
        ],
        sceneChanges: [
          {
            timeOffset: 0,
          },
        ],
      });

      expect(mockVideoIntelligenceClient.annotateVideo).toHaveBeenCalledWith({
        inputUri: 'gs://bucket/video.mp4',
        features: [
          'LABEL_DETECTION',
          'OBJECT_TRACKING',
          'SHOT_CHANGE_DETECTION',
        ],
        videoContext: {
          labelDetectionConfig: {
            labelDetectionMode: 'SHOT_AND_FRAME_MODE',
            stationaryCamera: false,
          },
          objectTrackingConfig: {
            model: 'builtin/latest',
          },
          shotChangeDetectionConfig: {
            model: 'builtin/latest',
          },
        },
      });
    });

    it('should throw error when client not initialized', async () => {
      (service as any)['videoIntelligenceClient'] = null;

      await expect(
        service.analyzeVideo('gs://bucket/video.mp4')
      ).rejects.toThrow('Video Intelligence client not initialized');
    });

    it('should handle analysis errors', async () => {
      const error = new Error('Analysis failed');
      mockVideoIntelligenceClient.annotateVideo.mockRejectedValue(error);

      // Suppress logger errors for this test
      const loggerErrorSpy = vi
        .spyOn(service['logger'], 'error')
        .mockImplementation(() => undefined);

      await expect(
        service.analyzeVideo('gs://bucket/video.mp4')
      ).rejects.toThrow('Video Intelligence analysis failed: Analysis failed');

      loggerErrorSpy.mockRestore();
    });
  });

  describe('transcribeSpeech', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should transcribe speech successfully', async () => {
      const mockOperation = {
        name: 'operation-456',
        promise: vi.fn().mockResolvedValue([
          {
            results: [
              {
                alternatives: [
                  {
                    transcript: 'Hello world',
                    confidence: 0.95,
                    words: [
                      {
                        word: 'Hello',
                        startTime: { seconds: '0', nanos: '0' },
                        endTime: { seconds: '1', nanos: '0' },
                      },
                      {
                        word: 'world',
                        startTime: { seconds: '1', nanos: '0' },
                        endTime: { seconds: '2', nanos: '0' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]),
      };

      mockSpeechClient.longRunningRecognize.mockResolvedValue([mockOperation]);

      const result = await service.transcribeSpeech('gs://bucket/audio.wav');

      expect(result).toEqual({
        transcript: 'Hello world',
        confidence: 0.95,
        words: [
          {
            word: 'Hello',
            startTime: 0,
            endTime: 1,
            confidence: 0.95,
          },
          {
            word: 'world',
            startTime: 1,
            endTime: 2,
            confidence: 0.95,
          },
        ],
        languageCode: 'en-US',
      });

      expect(mockSpeechClient.longRunningRecognize).toHaveBeenCalledWith({
        audio: { uri: 'gs://bucket/audio.wav' },
        config: {
          encoding: 'LINEAR16',
          languageCode: 'en-US',
          enableWordTimeOffsets: true,
          enableAutomaticPunctuation: true,
          model: 'video',
          useEnhanced: true,
        },
      });
    });

    it('should handle empty transcription results', async () => {
      const mockOperation = {
        name: 'operation-456',
        promise: vi.fn().mockResolvedValue([{ results: [] }]),
      };

      mockSpeechClient.longRunningRecognize.mockResolvedValue([mockOperation]);

      const result = await service.transcribeSpeech('gs://bucket/audio.wav');

      expect(result).toEqual({
        transcript: '',
        confidence: 0,
        words: [],
        languageCode: 'en-US',
      });
    });

    it('should throw error when client not initialized', async () => {
      (service as any)['speechClient'] = null;

      await expect(
        service.transcribeSpeech('gs://bucket/audio.wav')
      ).rejects.toThrow('Speech client not initialized');
    });
  });

  describe('createTranscodeJob', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should create transcode job successfully', async () => {
      const mockJob = {
        name: 'projects/test-project/locations/us-central1/jobs/job-123',
        state: 'PENDING',
      };

      mockTranscoderClient.createJob.mockResolvedValue([mockJob]);

      const result = await service.createTranscodeJob(
        'gs://input/video.mp4',
        'gs://output/video.mp4'
      );

      expect(result).toEqual({
        jobId: 'projects/test-project/locations/us-central1/jobs/job-123',
        state: 'PENDING',
        outputUri: 'gs://output/video.mp4',
      });

      expect(mockTranscoderClient.createJob).toHaveBeenCalledWith({
        parent: 'projects/test-project-id/locations/us-central1',
        job: {
          inputUri: 'gs://input/video.mp4',
          outputUri: 'gs://output/video.mp4',
          templateId: 'preset/web-hd',
        },
      });
    });

    it('should throw error when client not initialized', async () => {
      service['transcoderClient'] = null as any;

      await expect(
        service.createTranscodeJob('input', 'output')
      ).rejects.toThrow('Transcoder client not initialized');
    });
  });

  describe('getTranscodeJobStatus', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should get job status successfully', async () => {
      const mockJob = {
        name: 'job-123',
        state: 'SUCCEEDED',
        config: { output: { uri: 'gs://output/video.mp4' } },
        progress: 100,
      };

      mockTranscoderClient.getJob.mockResolvedValue([mockJob]);

      const result = await service.getTranscodeJobStatus('job-123');

      expect(result).toEqual({
        jobId: 'job-123',
        state: 'SUCCEEDED',
        outputUri: 'gs://output/video.mp4',
        progress: 100,
        error: undefined,
      });
    });

    it('should throw error when client not initialized', async () => {
      service['transcoderClient'] = null as any;

      await expect(service.getTranscodeJobStatus('job-123')).rejects.toThrow(
        'Transcoder client not initialized'
      );
    });
  });

  describe('health checks', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should return true for healthy Video Intelligence service', async () => {
      mockVideoIntelligenceClient.initialize.mockResolvedValue(undefined);

      const result = await service.isVideoIntelligenceHealthy();

      expect(result).toBe(true);
    });

    it('should return false when Video Intelligence service is unhealthy', async () => {
      mockVideoIntelligenceClient.initialize.mockRejectedValue(
        new Error('Connection failed')
      );

      const result = await service.isVideoIntelligenceHealthy();

      expect(result).toBe(false);
    });

    it('should return false when Video Intelligence is disabled', async () => {
      const disabledConfigService = createMockConfigService({
        ...mockConfig,
        'processors.enableGoogleVideoIntelligence': false,
      });
      const disabledService = new GoogleCloudService(disabledConfigService);
      await disabledService.onModuleInit();

      const result = await disabledService.isVideoIntelligenceHealthy();

      expect(result).toBe(false);
    });

    it('should return overall health status', async () => {
      mockVideoIntelligenceClient.initialize.mockResolvedValue(undefined);
      mockSpeechClient.initialize.mockResolvedValue(undefined);
      mockTranscoderClient.initialize.mockResolvedValue(undefined);

      const result = await service.isHealthy();

      expect(result).toBe(true);
    });

    it('should return false if any service is unhealthy', async () => {
      mockVideoIntelligenceClient.initialize.mockResolvedValue(undefined);
      mockSpeechClient.initialize.mockRejectedValue(new Error('Failed'));
      mockTranscoderClient.initialize.mockResolvedValue(undefined);

      const result = await service.isHealthy();

      expect(result).toBe(false);
    });
  });

  describe('utility methods', () => {
    it('should get enabled services', () => {
      const services = service.getEnabledServices();

      expect(services).toEqual([
        'Video Intelligence',
        'Speech-to-Text',
        'Transcoder',
      ]);
    });

    it('should parse time offset correctly', () => {
      const timeOffset = { seconds: '10', nanos: '500000000' };
      const result = service['parseTimeOffset'](timeOffset);

      expect(result).toBe(10.5);
    });

    it('should handle null time offset', () => {
      const result = service['parseTimeOffset'](null);

      expect(result).toBe(0);
    });
  });
});
