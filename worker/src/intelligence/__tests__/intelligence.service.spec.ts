import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { IntelligenceService } from '../intelligence.service';
import { type Task, type DetectLabelsPayload, ProcessingProvider, TaskStatus } from '@project/shared';

describe('IntelligenceService', () => {
  let service: IntelligenceService;
  let configService: any;
  let pocketbaseService: any;
  let storageService: any;
  let videoIntelligenceStrategy: any;
  let speechToTextStrategy: any;

  // Mock NestJS Logger to suppress console output during tests
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

  beforeEach(() => {
    // Create mock services
    configService = {
      get: vi.fn().mockReturnValue('test-bucket'),
    };

    pocketbaseService = {
      mediaMutator: {
        getById: vi.fn(),
        update: vi.fn(),
      },
      fileMutator: {
        getById: vi.fn(),
      },
    };

    storageService = {
      resolveFilePath: vi.fn(),
    };

    videoIntelligenceStrategy = {
      detectLabels: vi.fn(),
    };

    speechToTextStrategy = {
      transcribe: vi.fn(),
    };

    // Directly instantiate the service with mocked dependencies
    service = new IntelligenceService(
      configService,
      pocketbaseService,
      storageService,
      videoIntelligenceStrategy,
      speechToTextStrategy,
    );

    // Reset mocks
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processTask', () => {
    const mockTask: Task = {
      id: 'task-123',
      type: 'detect_labels',
      sourceType: 'media',
      sourceId: 'media-123',
      status: TaskStatus.QUEUED,
      progress: 0,
      attempts: 1,
      priority: 0,
      payload: {
        mediaId: 'media-123',
        fileRef: 'file-123',
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        config: {
          detectLabels: true,
          detectObjects: true,
          confidenceThreshold: 0.5,
        },
      } as DetectLabelsPayload,
      WorkspaceRef: 'workspace-1',
      UserRef: 'user-1',
      collectionId: 'tasks',
      collectionName: 'Tasks',
      expand: {},
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };

    const mockMedia = {
      id: 'media-123',
      name: 'test-video.mp4',
    };

    const mockFile = {
      id: 'file-123',
      name: 'test-video.mp4',
      path: '/path/to/test-video.mp4',
    };

    const mockProgressCallback = vi.fn();

    beforeEach(() => {
      configService.get.mockReturnValue('test-bucket');
      pocketbaseService.mediaMutator.getById.mockResolvedValue(mockMedia);
      pocketbaseService.fileMutator.getById.mockResolvedValue(mockFile);
      storageService.resolveFilePath.mockResolvedValue('/local/path/test-video.mp4');
    });

    it('should process intelligence task successfully', async () => {
      // Arrange
      const mockVideoIntelligenceResult = {
        labels: [
          {
            entity: 'person',
            confidence: 0.9,
            segments: [{ startTime: 0, endTime: 10, confidence: 0.9 }],
          },
        ],
        objects: [
          {
            entity: 'car',
            confidence: 0.8,
            frames: [
              {
                timeOffset: 5,
                boundingBox: { left: 0.1, top: 0.1, right: 0.9, bottom: 0.9 },
              },
            ],
          },
        ],
        sceneChanges: [{ timeOffset: 15 }],
      };

      const mockSpeechResult = {
        transcript: 'Hello world',
        confidence: 0.95,
        words: [
          { word: 'Hello', startTime: 1, endTime: 1.5, confidence: 0.95 },
          { word: 'world', startTime: 1.6, endTime: 2.1, confidence: 0.95 },
        ],
        languageCode: 'en-US',
        hasAudio: true,
      };

      videoIntelligenceStrategy.detectLabels.mockResolvedValue(mockVideoIntelligenceResult);
      speechToTextStrategy.transcribe.mockResolvedValue(mockSpeechResult);
      pocketbaseService.mediaMutator.update.mockResolvedValue({});

      // Act
      const result = await service.processTask(mockTask, mockProgressCallback);

      // Assert
      expect(result).toEqual({
        summary: {
          labelCount: 1,
          objectCount: 1,
        },
        processorVersion: 'google-cloud-intelligence:1.0.0',
      });

      expect(pocketbaseService.mediaMutator.getById).toHaveBeenCalledWith('media-123');
      expect(pocketbaseService.fileMutator.getById).toHaveBeenCalledWith('file-123');
      expect(storageService.resolveFilePath).toHaveBeenCalledWith(mockFile);
      expect(videoIntelligenceStrategy.detectLabels).toHaveBeenCalled();
      expect(speechToTextStrategy.transcribe).toHaveBeenCalledWith('/local/path/test-video.mp4');
      expect(pocketbaseService.mediaMutator.update).toHaveBeenCalledWith('media-123', {
        labels: mockVideoIntelligenceResult.labels,
        objects: mockVideoIntelligenceResult.objects,
        sceneChanges: mockVideoIntelligenceResult.sceneChanges,
        transcription: mockSpeechResult,
        intelligenceProcessedAt: expect.any(String),
      });
      expect(mockProgressCallback).toHaveBeenCalledWith(100);
    });

    it('should handle video intelligence failure gracefully', async () => {
      // Arrange
      const mockSpeechResult = {
        transcript: 'Hello world',
        confidence: 0.95,
        words: [],
        languageCode: 'en-US',
        hasAudio: true,
      };

      videoIntelligenceStrategy.detectLabels.mockRejectedValue(new Error('Video intelligence failed'));
      speechToTextStrategy.transcribe.mockResolvedValue(mockSpeechResult);
      pocketbaseService.mediaMutator.update.mockResolvedValue({});

      // Act
      const result = await service.processTask(mockTask, mockProgressCallback);

      // Assert
      expect(result).toEqual({
        summary: {
          labelCount: 0,
          objectCount: 0,
        },
        processorVersion: 'google-cloud-intelligence:1.0.0',
      });

      expect(pocketbaseService.mediaMutator.update).toHaveBeenCalledWith('media-123', {
        labels: [],
        objects: [],
        sceneChanges: [],
        transcription: mockSpeechResult,
        intelligenceProcessedAt: expect.any(String),
      });
    });

    it('should handle speech transcription failure gracefully', async () => {
      // Arrange
      const mockVideoIntelligenceResult = {
        labels: [
          {
            entity: 'person',
            confidence: 0.9,
            segments: [{ startTime: 0, endTime: 10, confidence: 0.9 }],
          },
        ],
        objects: [],
        sceneChanges: [],
      };

      videoIntelligenceStrategy.detectLabels.mockResolvedValue(mockVideoIntelligenceResult);
      speechToTextStrategy.transcribe.mockRejectedValue(new Error('Speech transcription failed'));
      pocketbaseService.mediaMutator.update.mockResolvedValue({});

      // Act
      const result = await service.processTask(mockTask, mockProgressCallback);

      // Assert
      expect(result).toEqual({
        summary: {
          labelCount: 1,
          objectCount: 0,
        },
        processorVersion: 'google-cloud-intelligence:1.0.0',
      });

      expect(pocketbaseService.mediaMutator.update).toHaveBeenCalledWith('media-123', {
        labels: mockVideoIntelligenceResult.labels,
        objects: mockVideoIntelligenceResult.objects,
        sceneChanges: mockVideoIntelligenceResult.sceneChanges,
        transcription: {
          transcript: '',
          confidence: 0,
          words: [],
          languageCode: 'en-US',
          hasAudio: false,
        },
        intelligenceProcessedAt: expect.any(String),
      });
    });

    it('should throw error when media not found', async () => {
      // Arrange
      pocketbaseService.mediaMutator.getById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.processTask(mockTask, mockProgressCallback)).rejects.toThrow(
        'Intelligence processing failed: Media media-123 not found'
      );
    });

    it('should throw error when file not found', async () => {
      // Arrange
      pocketbaseService.fileMutator.getById.mockResolvedValue(null);

      // Act & Assert
      await expect(service.processTask(mockTask, mockProgressCallback)).rejects.toThrow(
        'Intelligence processing failed: File file-123 not found'
      );
    });

    it('should skip processing if intelligence data already exists', async () => {
      // Arrange
      const existingMedia = {
        ...mockMedia,
        labels: [{ entity: 'existing', confidence: 0.9, segments: [] }],
        objects: [{ entity: 'existing', confidence: 0.9, frames: [] }],
        transcription: { transcript: 'existing', confidence: 0.9, words: [], languageCode: 'en-US', hasAudio: true },
      };

      pocketbaseService.mediaMutator.getById.mockResolvedValue(existingMedia);

      // Act
      const result = await service.processTask(mockTask, mockProgressCallback);

      // Assert
      expect(result).toEqual({
        summary: {
          labelCount: 1,
          objectCount: 1,
        },
        processorVersion: 'google-cloud-intelligence:1.0.0',
      });

      expect(videoIntelligenceStrategy.detectLabels).not.toHaveBeenCalled();
      expect(speechToTextStrategy.transcribe).not.toHaveBeenCalled();
      expect(mockProgressCallback).toHaveBeenCalledWith(100);
    });
  });

  describe('Property 10: Intelligence Data Extraction', () => {
    /**
     * Property: For any intelligence task with valid input, the system should extract 
     * labels, objects, and scene changes from video content.
     *
     * Validates: Requirements 10.3
     */
    it('should extract intelligence data for any valid video input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            mediaId: fc.string({ minLength: 1 }),
            fileRef: fc.string({ minLength: 1 }),
            provider: fc.constantFrom('google_video_intelligence', 'google_speech'),
            config: fc.record({
              detectLabels: fc.boolean(),
              detectObjects: fc.boolean(),
              confidenceThreshold: fc.float({ min: Math.fround(0.1), max: Math.fround(1.0) }),
            }),
          }),
          async (payload) => {
            // Reset mocks for each property test iteration
            vi.clearAllMocks();

            const task: Task = {
              id: `task-${payload.mediaId}`,
              type: 'detect_labels',
              sourceType: 'media',
              sourceId: payload.mediaId,
              status: TaskStatus.QUEUED,
              progress: 0,
              attempts: 1,
              priority: 0,
              payload,
              WorkspaceRef: 'workspace-1',
              UserRef: 'user-1',
              collectionId: 'tasks',
              collectionName: 'Tasks',
              expand: {},
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            };

            const mockMedia = {
              id: payload.mediaId,
              name: 'test-video.mp4',
            };

            const mockFile = {
              id: payload.fileRef,
              name: 'test-video.mp4',
              path: `/path/to/${payload.fileRef}.mp4`,
            };

            // Generate random intelligence results
            const mockVideoIntelligenceResult = {
              labels: fc.sample(
                fc.array(
                  fc.record({
                    entity: fc.string({ minLength: 1 }),
                    confidence: fc.float({ min: Math.fround(0.1), max: Math.fround(1.0) }),
                    segments: fc.array(
                      fc.record({
                        startTime: fc.integer({ min: 0, max: 3600 }),
                        endTime: fc.integer({ min: 0, max: 3600 }),
                        confidence: fc.float({ min: Math.fround(0.1), max: Math.fround(1.0) }),
                      })
                    ),
                  }),
                  { minLength: 0, maxLength: 10 }
                ),
                1
              )[0],
              objects: fc.sample(
                fc.array(
                  fc.record({
                    entity: fc.string({ minLength: 1 }),
                    confidence: fc.float({ min: Math.fround(0.1), max: Math.fround(1.0) }),
                    frames: fc.array(
                      fc.record({
                        timeOffset: fc.integer({ min: 0, max: 3600 }),
                        boundingBox: fc.record({
                          left: fc.float({ min: Math.fround(0), max: Math.fround(1) }),
                          top: fc.float({ min: Math.fround(0), max: Math.fround(1) }),
                          right: fc.float({ min: Math.fround(0), max: Math.fround(1) }),
                          bottom: fc.float({ min: Math.fround(0), max: Math.fround(1) }),
                        }),
                      })
                    ),
                  }),
                  { minLength: 0, maxLength: 5 }
                ),
                1
              )[0],
              sceneChanges: fc.sample(
                fc.array(
                  fc.record({
                    timeOffset: fc.integer({ min: 0, max: 3600 }),
                  }),
                  { minLength: 0, maxLength: 20 }
                ),
                1
              )[0],
            };

            // Mock service responses
            pocketbaseService.mediaMutator.getById.mockResolvedValue(mockMedia);
            pocketbaseService.fileMutator.getById.mockResolvedValue(mockFile);
            storageService.resolveFilePath.mockResolvedValue(`/local/path/${payload.fileRef}.mp4`);
            videoIntelligenceStrategy.detectLabels.mockResolvedValue(mockVideoIntelligenceResult);
            speechToTextStrategy.transcribe.mockResolvedValue({
              transcript: 'Sample transcript',
              confidence: 0.95,
              words: [],
              languageCode: 'en-US',
              hasAudio: true,
            });
            pocketbaseService.mediaMutator.update.mockResolvedValue({});

            const progressCallback = vi.fn();

            // Act
            const result = await service.processTask(task, progressCallback);

            // Assert - Verify intelligence data extraction
            expect(result).toBeDefined();
            expect(result.summary).toBeDefined();
            expect(result.summary.labelCount).toBe(mockVideoIntelligenceResult.labels.length);
            expect(result.summary.objectCount).toBe(mockVideoIntelligenceResult.objects.length);
            expect(result.processorVersion).toBe('google-cloud-intelligence:1.0.0');

            // Verify video intelligence strategy was called
            expect(videoIntelligenceStrategy.detectLabels).toHaveBeenCalled();

            // Verify data was stored in PocketBase
            expect(pocketbaseService.mediaMutator.update).toHaveBeenCalledWith(
              payload.mediaId,
              expect.objectContaining({
                labels: mockVideoIntelligenceResult.labels,
                objects: mockVideoIntelligenceResult.objects,
                sceneChanges: mockVideoIntelligenceResult.sceneChanges,
                intelligenceProcessedAt: expect.any(String),
              })
            );

            // Verify progress was reported
            expect(progressCallback).toHaveBeenCalledWith(100);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Property 11: Speech Detection and Transcription', () => {
    /**
     * Property: For any video with speech content, the system should generate 
     * accurate transcription with confidence scores and word-level timing.
     *
     * Validates: Requirements 10.4
     */
    it('should generate transcription for videos with speech content', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            mediaId: fc.string({ minLength: 1 }),
            fileRef: fc.string({ minLength: 1 }),
            hasAudio: fc.boolean(),
            transcript: fc.string({ minLength: 0, maxLength: 1000 }),
            confidence: fc.float({ min: Math.fround(0.1), max: Math.fround(1.0) }),
            languageCode: fc.constantFrom('en-US', 'es-ES', 'fr-FR', 'de-DE'),
          }),
          async (payload) => {
            // Reset mocks for each property test iteration
            vi.clearAllMocks();

            const task: Task = {
              id: `task-${payload.mediaId}`,
              type: 'detect_labels',
              sourceType: 'media',
              sourceId: payload.mediaId,
              status: TaskStatus.QUEUED,
              progress: 0,
              attempts: 1,
              priority: 0,
              payload: {
                mediaId: payload.mediaId,
                fileRef: payload.fileRef,
                provider: 'google_speech',
                config: {
                  detectLabels: false,
                  detectObjects: false,
                  confidenceThreshold: 0.5,
                },
              } as DetectLabelsPayload,
              WorkspaceRef: 'workspace-1',
              UserRef: 'user-1',
              collectionId: 'tasks',
              collectionName: 'Tasks',
              expand: {},
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
            };

            const mockMedia = {
              id: payload.mediaId,
              name: 'test-video.mp4',
            };

            const mockFile = {
              id: payload.fileRef,
              name: 'test-video.mp4',
              path: `/path/to/${payload.fileRef}.mp4`,
            };

            // Generate speech transcription result
            const mockSpeechResult = {
              transcript: payload.transcript,
              confidence: payload.confidence,
              words: payload.transcript.split(' ').map((word, index) => ({
                word,
                startTime: index * 0.5,
                endTime: (index + 1) * 0.5,
                confidence: payload.confidence,
              })),
              languageCode: payload.languageCode,
              hasAudio: payload.hasAudio,
            };

            // Mock service responses
            pocketbaseService.mediaMutator.getById.mockResolvedValue(mockMedia);
            pocketbaseService.fileMutator.getById.mockResolvedValue(mockFile);
            storageService.resolveFilePath.mockResolvedValue(`/local/path/${payload.fileRef}.mp4`);
            videoIntelligenceStrategy.detectLabels.mockResolvedValue({
              labels: [],
              objects: [],
              sceneChanges: [],
            });
            speechToTextStrategy.transcribe.mockResolvedValue(mockSpeechResult);
            pocketbaseService.mediaMutator.update.mockResolvedValue({});

            const progressCallback = vi.fn();

            // Act
            const result = await service.processTask(task, progressCallback);

            // Assert - Verify speech transcription
            expect(result).toBeDefined();
            expect(result.processorVersion).toBe('google-cloud-intelligence:1.0.0');

            // Verify speech-to-text strategy was called
            expect(speechToTextStrategy.transcribe).toHaveBeenCalledWith(`/local/path/${payload.fileRef}.mp4`);

            // Verify transcription data was stored
            expect(pocketbaseService.mediaMutator.update).toHaveBeenCalledWith(
              payload.mediaId,
              expect.objectContaining({
                transcription: expect.objectContaining({
                  transcript: payload.transcript,
                  confidence: payload.confidence,
                  languageCode: payload.languageCode,
                  hasAudio: payload.hasAudio,
                  words: expect.any(Array),
                }),
                intelligenceProcessedAt: expect.any(String),
              })
            );

            // If there's audio and transcript content, verify word-level timing
            if (payload.hasAudio && payload.transcript.length > 0) {
              const storedTranscription = pocketbaseService.mediaMutator.update.mock.calls[0][1].transcription;
              expect(storedTranscription.words).toHaveLength(payload.transcript.split(' ').length);
              
              // Verify each word has timing information
              storedTranscription.words.forEach((word: any) => {
                expect(word).toHaveProperty('word');
                expect(word).toHaveProperty('startTime');
                expect(word).toHaveProperty('endTime');
                expect(word).toHaveProperty('confidence');
                expect(typeof word.startTime).toBe('number');
                expect(typeof word.endTime).toBe('number');
                expect(word.startTime).toBeLessThanOrEqual(word.endTime);
              });
            }

            // Verify progress was reported
            expect(progressCallback).toHaveBeenCalledWith(100);
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});