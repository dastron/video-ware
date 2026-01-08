import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bull';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES } from '../queue.constants';
import * as fc from 'fast-check';
import { TaskType, TaskStatus } from '@project/shared';

// Mock Queue interface (each queue must have its own mock fns)
const makeMockQueue = () => ({
  add: vi.fn(),
  getWaitingCount: vi.fn(),
  getActiveCount: vi.fn(),
  getCompletedCount: vi.fn(),
  getFailedCount: vi.fn(),
  getDelayedCount: vi.fn(),
});

describe('QueueService', () => {
  let service: QueueService;
  let transcodeQueue: any;
  let intelligenceQueue: any;
  let renderQueue: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: getQueueToken(QUEUE_NAMES.TRANSCODE),
          useValue: makeMockQueue(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.INTELLIGENCE),
          useValue: makeMockQueue(),
        },
        {
          provide: getQueueToken(QUEUE_NAMES.RENDER),
          useValue: makeMockQueue(),
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
    transcodeQueue = module.get(getQueueToken(QUEUE_NAMES.TRANSCODE));
    intelligenceQueue = module.get(getQueueToken(QUEUE_NAMES.INTELLIGENCE));
    renderQueue = module.get(getQueueToken(QUEUE_NAMES.RENDER));

    // Reset mocks
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Property 1: Task Queue Routing', () => {
    /**
     * Property: For any task with a specific task type, when added to the system,
     * it should be routed to the corresponding queue (transcode tasks to transcode queue,
     * intelligence tasks to intelligence queue, render tasks to render queue).
     *
     * Validates: Requirements 2.3, 3.2
     */
    it('should route tasks to correct queues based on task type', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.string({ minLength: 1 }),
            type: fc.constantFrom(
              TaskType.PROCESS_UPLOAD,
              TaskType.DETECT_LABELS,
              TaskType.RENDER_TIMELINE
            ),
            sourceType: fc.string(),
            sourceId: fc.string(),
            status: fc.constantFrom(
              TaskStatus.QUEUED,
              TaskStatus.RUNNING,
              TaskStatus.SUCCESS,
              TaskStatus.FAILED,
              TaskStatus.CANCELED
            ),
            progress: fc.integer({ min: 0, max: 100 }),
            attempts: fc.integer({ min: 1 }),
            payload: fc.object(),
            WorkspaceRef: fc.string(),
            UserRef: fc.string(),
            created: fc.string(),
            updated: fc.string(),
            collectionId: fc.string(),
            collectionName: fc.constant('Tasks'),
            expand: fc.constant({}),
            priority: fc.option(fc.integer({ min: 0, max: 10 })),
          }),
          async (task) => {
            // Reset mocks for each property test iteration
            transcodeQueue.add.mockReset();
            intelligenceQueue.add.mockReset();
            renderQueue.add.mockReset();

            const taskForService = task as any;
            const priority = task.priority ?? 0;

            if (task.type === TaskType.PROCESS_UPLOAD) {
              await service.addTranscodeJob(taskForService);

              // Verify task was added to transcode queue with BullMQ options
              expect(transcodeQueue.add).toHaveBeenCalledTimes(1);
              expect(transcodeQueue.add).toHaveBeenCalledWith(
                'process',
                taskForService,
                {
                  jobId: task.id,
                  priority,
                  attempts: 5,
                  backoff: 60000,
                  removeOnComplete: true,
                  removeOnFail: false,
                }
              );
              expect(intelligenceQueue.add).not.toHaveBeenCalled();
              expect(renderQueue.add).not.toHaveBeenCalled();
            } else if (task.type === TaskType.DETECT_LABELS) {
              await service.addIntelligenceJob(taskForService);

              // Verify task was added to intelligence queue with BullMQ options
              expect(intelligenceQueue.add).toHaveBeenCalledTimes(1);
              expect(intelligenceQueue.add).toHaveBeenCalledWith(
                'process',
                taskForService,
                {
                  jobId: task.id,
                  priority,
                  attempts: 5,
                  backoff: 60000,
                  removeOnComplete: true,
                  removeOnFail: false,
                }
              );
              expect(transcodeQueue.add).not.toHaveBeenCalled();
              expect(renderQueue.add).not.toHaveBeenCalled();
            } else if (task.type === TaskType.RENDER_TIMELINE) {
              await service.addRenderJob(taskForService);

              // Verify task was added to render queue with BullMQ options
              expect(renderQueue.add).toHaveBeenCalledTimes(1);
              expect(renderQueue.add).toHaveBeenCalledWith(
                'process',
                taskForService,
                {
                  jobId: task.id,
                  priority,
                  attempts: 5,
                  backoff: 60000,
                  removeOnComplete: true,
                  removeOnFail: false,
                }
              );
              expect(transcodeQueue.add).not.toHaveBeenCalled();
              expect(intelligenceQueue.add).not.toHaveBeenCalled();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 2: BullMQ Job Configuration', () => {
    /**
     * Property: All jobs should be configured with proper BullMQ options:
     * - jobId set to task.id for deduplication
     * - priority from task or default to 0
     * - attempts: 5 to retry up to 5 times
     * - backoff: 60000 to wait 60 seconds between retries
     * - removeOnComplete: true to clean up successful jobs
     * - removeOnFail: false to keep failed jobs for debugging
     *
     * Validates: BullMQ best practices and Bull Board visibility
     */
    it('should configure jobs with correct BullMQ options', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            id: fc.string({ minLength: 1 }),
            type: fc.constantFrom(
              TaskType.PROCESS_UPLOAD,
              TaskType.DETECT_LABELS,
              TaskType.RENDER_TIMELINE
            ),
            sourceType: fc.string(),
            sourceId: fc.string(),
            status: fc.constantFrom(
              TaskStatus.QUEUED,
              TaskStatus.RUNNING,
              TaskStatus.SUCCESS,
              TaskStatus.FAILED,
              TaskStatus.CANCELED
            ),
            progress: fc.integer({ min: 0, max: 100 }),
            attempts: fc.integer({ min: 1 }),
            payload: fc.object(),
            WorkspaceRef: fc.string(),
            UserRef: fc.string(),
            created: fc.string(),
            updated: fc.string(),
            collectionId: fc.string(),
            collectionName: fc.constant('Tasks'),
            expand: fc.constant({}),
            priority: fc.option(fc.integer({ min: 0, max: 10 })),
          }),
          async (task) => {
            // Reset mocks for each property test iteration
            transcodeQueue.add.mockReset();
            intelligenceQueue.add.mockReset();
            renderQueue.add.mockReset();

            const taskForService = task as any;
            const priority = task.priority ?? 0;

            const expectedOptions = {
              jobId: task.id,
              priority,
              attempts: 5,
              backoff: 60000,
              removeOnComplete: true,
              removeOnFail: false,
            };

            if (task.type === TaskType.PROCESS_UPLOAD) {
              await service.addTranscodeJob(taskForService);
              expect(transcodeQueue.add).toHaveBeenCalledWith(
                'process',
                taskForService,
                expectedOptions
              );
            } else if (task.type === TaskType.DETECT_LABELS) {
              await service.addIntelligenceJob(taskForService);
              expect(intelligenceQueue.add).toHaveBeenCalledWith(
                'process',
                taskForService,
                expectedOptions
              );
            } else if (task.type === TaskType.RENDER_TIMELINE) {
              await service.addRenderJob(taskForService);
              expect(renderQueue.add).toHaveBeenCalledWith(
                'process',
                taskForService,
                expectedOptions
              );
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('getQueueMetrics', () => {
    it('should return metrics for all queues', async () => {
      // Mock queue stats
      const mockStats = {
        waiting: 5,
        active: 2,
        completed: 10,
        failed: 1,
        delayed: 0,
      };

      transcodeQueue.getWaitingCount.mockResolvedValue(mockStats.waiting);
      transcodeQueue.getActiveCount.mockResolvedValue(mockStats.active);
      transcodeQueue.getCompletedCount.mockResolvedValue(mockStats.completed);
      transcodeQueue.getFailedCount.mockResolvedValue(mockStats.failed);
      transcodeQueue.getDelayedCount.mockResolvedValue(mockStats.delayed);

      intelligenceQueue.getWaitingCount.mockResolvedValue(mockStats.waiting);
      intelligenceQueue.getActiveCount.mockResolvedValue(mockStats.active);
      intelligenceQueue.getCompletedCount.mockResolvedValue(
        mockStats.completed
      );
      intelligenceQueue.getFailedCount.mockResolvedValue(mockStats.failed);
      intelligenceQueue.getDelayedCount.mockResolvedValue(mockStats.delayed);

      renderQueue.getWaitingCount.mockResolvedValue(mockStats.waiting);
      renderQueue.getActiveCount.mockResolvedValue(mockStats.active);
      renderQueue.getCompletedCount.mockResolvedValue(mockStats.completed);
      renderQueue.getFailedCount.mockResolvedValue(mockStats.failed);
      renderQueue.getDelayedCount.mockResolvedValue(mockStats.delayed);

      const metrics = await service.getQueueMetrics();

      expect(metrics).toEqual({
        transcode: mockStats,
        intelligence: mockStats,
        render: mockStats,
      });
    });
  });
});
