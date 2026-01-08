import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { IntelligenceService } from '../intelligence.service';
import {
  type Task,
  type DetectLabelsPayload,
  ProcessingProvider,
  TaskStatus,
} from '@project/shared';

describe('IntelligenceService', () => {
  let service: IntelligenceService;
  let configService: any;
  let pocketbaseService: any;
  let storageService: any;
  let videoIntelligenceStrategy: any;
  let speechToTextStrategy: any;
  let flowService: any;

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

    flowService = {
      createIntelligenceFlow: vi.fn().mockResolvedValue('parent-job-123'),
    };

    // Directly instantiate the service with mocked dependencies
    service = new IntelligenceService(
      configService,
      pocketbaseService,
      storageService,
      videoIntelligenceStrategy,
      speechToTextStrategy,
      flowService
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

    it('should create intelligence flow and return parent job ID', async () => {
      // Arrange
      flowService.createIntelligenceFlow.mockResolvedValue('parent-job-123');

      // Act
      const result = await service.processTask(mockTask);

      // Assert
      expect(result).toBe('parent-job-123');
      expect(flowService.createIntelligenceFlow).toHaveBeenCalledWith(mockTask);
    });

    it('should propagate errors from flow creation', async () => {
      // Arrange
      const error = new Error('Flow creation failed');
      flowService.createIntelligenceFlow.mockRejectedValue(error);

      // Act & Assert
      await expect(service.processTask(mockTask)).rejects.toThrow(
        'Flow creation failed'
      );
      expect(flowService.createIntelligenceFlow).toHaveBeenCalledWith(mockTask);
    });
  });

  describe('Property 10: Intelligence Data Extraction', () => {
    /**
     * Property: For any intelligence task with valid input, the flow service should be called
     * to create an intelligence flow.
     *
     * Validates: Requirements 7.1
     */
    it('should create intelligence flow for any valid task input', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            mediaId: fc.string({ minLength: 1 }),
            fileRef: fc.string({ minLength: 1 }),
            provider: fc.constantFrom(
              'google_video_intelligence',
              'google_speech'
            ),
            config: fc.record({
              detectLabels: fc.boolean(),
              detectObjects: fc.boolean(),
              confidenceThreshold: fc.float({
                min: Math.fround(0.1),
                max: Math.fround(1.0),
              }),
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

            flowService.createIntelligenceFlow.mockResolvedValue(
              `parent-job-${payload.mediaId}`
            );

            // Act
            const result = await service.processTask(task);

            // Assert - Verify flow was created
            expect(result).toBe(`parent-job-${payload.mediaId}`);
            expect(flowService.createIntelligenceFlow).toHaveBeenCalledWith(
              task
            );
          }
        ),
        { numRuns: 20 }
      );
    });
  });
});
