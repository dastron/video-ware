import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { FlowService } from './flow.service';
import { JobService } from './job.service';
import { TaskType } from '@project/shared';
import type {
  Task,
  GenerateTimelineRecommendationsPayload,
  GenerateMediaRecommendationsPayload,
} from '@project/shared';
import type {
  GenerateTimelineRecommendationsStepInput,
  GenerateMediaRecommendationsStepInput,
} from '../task-recommendations/types';
import type { SimpleJobData } from './types/job.types';

/**
 * QueueService provides a thin wrapper around BullMQ queues.
 * BullMQ handles job deduplication via jobId, so we don't need
 * custom dedup logic. Bull Board provides job tracking and management UI.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TRANSCODE) private transcodeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.INTELLIGENCE) private intelligenceQueue: Queue,
    @InjectQueue(QUEUE_NAMES.RENDER) private renderQueue: Queue,
    @InjectQueue(QUEUE_NAMES.MEDIA_RECOMMENDATIONS)
    private mediaRecommendationsQueue: Queue,
    @InjectQueue(QUEUE_NAMES.TIMELINE_RECOMMENDATIONS)
    private timelineRecommendationsQueue: Queue,
    private readonly flowService: FlowService,
    private readonly jobService: JobService
  ) {}

  /**
   * Single entry point for enqueueing tasks.
   * Routes to flow-based jobs or regular jobs based on task type.
   * Exhaustive switch ensures all TaskType enum values are handled.
   *
   * @param task - Task to enqueue
   * @returns Job ID or parent job ID
   */
  async enqueueTask(task: Task): Promise<string> {
    this.logger.log(`Enqueueing task ${task.id} (type: ${task.type})`);

    switch (task.type) {
      // Flow-based jobs (multi-step with parent-child relationships)
      case TaskType.PROCESS_UPLOAD:
        return this.addTranscodeJob(task);

      case TaskType.DETECT_LABELS:
        return this.addIntelligenceJob(task);

      case TaskType.RENDER_TIMELINE:
        return this.addRenderJob(task);

      case TaskType.FULL_INGEST:
        return this.addFullIngestJob(task);

      // Regular jobs (single-step processing)
      case TaskType.GENERATE_MEDIA_RECOMMENDATIONS:
        return this.addMediaRecommendationsJob(task);

      case TaskType.GENERATE_TIMELINE_RECOMMENDATIONS:
        return this.addTimelineRecommendationsJob(task);

      // Not yet implemented
      case TaskType.DERIVE_CLIPS:
        throw new Error(`Task type ${task.type} is not yet implemented`);

      default: {
        // Exhaustive check - TypeScript will warn if a TaskType case is missing
        // (Note: task.type is string at runtime, so compile-time exhaustiveness
        // is best-effort via manual verification of all TaskType enum values)
        throw new Error(`Unknown task type: ${task.type}`);
      }
    }
  }

  /**
   * Add a transcode job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addTranscodeJob(task: Task) {
    return this.jobService.submitTranscodeJob(task);
  }

  /**
   * Add an intelligence job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addIntelligenceJob(task: Task) {
    return this.jobService.submitLabelsJob(task);
  }

  /**
   * Add a render job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addRenderJob(task: Task) {
    return this.jobService.submitRenderJob(task);
  }

  /**
   * Add a full ingest job to the queue.
   */
  async addFullIngestJob(task: Task) {
    return this.jobService.submitFullIngestJob(task);
  }

  /**
   * Add a timeline recommendations job to the queue.
   * Creates a simple job (not a flow) that processes directly.
   */
  async addTimelineRecommendationsJob(task: Task) {
    this.logger.log(`Adding timeline recommendations job for task ${task.id}`);

    const payload = task.payload as GenerateTimelineRecommendationsPayload;

    // Build the step input from the task payload
    const stepInput: GenerateTimelineRecommendationsStepInput = {
      type: 'recommendations:generate_timeline',
      workspaceId: payload.workspaceId,
      timelineId: payload.timelineId,
      seedClipId: payload.seedClipId,
      targetMode: payload.targetMode,
      strategies: payload.strategies,
      strategyWeights: payload.strategyWeights,
      searchParams: payload.searchParams,
      maxResults: payload.maxResults,
    };

    // Create simple job data
    const jobData: SimpleJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
      task,
      input: stepInput,
    };

    // Add job to queue with task ID as job ID for deduplication
    const job = await this.timelineRecommendationsQueue.add(
      'generate_timeline_recommendations',
      jobData,
      {
        jobId: task.id, // Use task ID as job ID for deduplication
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5 seconds
        },
      }
    );

    this.logger.log(
      `Created timeline recommendations job for task ${task.id}, job ID: ${job.id || 'unknown'}`
    );

    return job.id || task.id;
  }

  /**
   * Add a media recommendations job to the queue.
   * Creates a simple job (not a flow) that processes directly.
   */
  async addMediaRecommendationsJob(task: Task) {
    this.logger.log(`Adding media recommendations job for task ${task.id}`);

    const payload = task.payload as GenerateMediaRecommendationsPayload;

    // Build the step input from the task payload
    const stepInput: GenerateMediaRecommendationsStepInput = {
      type: 'recommendations:generate_media',
      workspaceId: payload.workspaceId,
      mediaId: payload.mediaId,
      strategies: payload.strategies,
      strategyWeights: payload.strategyWeights,
      filterParams: payload.filterParams,
      maxResults: payload.maxResults,
    };

    // Create simple job data
    const jobData: SimpleJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
      task,
      input: stepInput,
    };

    // Add job to queue with task ID as job ID for deduplication
    const job = await this.mediaRecommendationsQueue.add(
      'generate_media_recommendations',
      jobData,
      {
        jobId: task.id, // Use task ID as job ID for deduplication
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5 seconds
        },
      }
    );

    this.logger.log(
      `Created media recommendations job for task ${task.id}, job ID: ${job.id || 'unknown'}`
    );

    return job.id || task.id;
  }

  /**
   * Get metrics for all queues.
   * Use Bull Board for detailed job tracking and management.
   */
  async getQueueMetrics() {
    const [
      transcodeMetrics,
      intelligenceMetrics,
      renderMetrics,
      mediaRecommendationsMetrics,
      timelineRecommendationsMetrics,
    ] = await Promise.all([
      this.getQueueStats(this.transcodeQueue),
      this.getQueueStats(this.intelligenceQueue),
      this.getQueueStats(this.renderQueue),
      this.getQueueStats(this.mediaRecommendationsQueue),
      this.getQueueStats(this.timelineRecommendationsQueue),
    ]);

    return {
      transcode: transcodeMetrics,
      intelligence: intelligenceMetrics,
      render: renderMetrics,
      mediaRecommendations: mediaRecommendationsMetrics,
      timelineRecommendations: timelineRecommendationsMetrics,
    };
  }

  private async getQueueStats(queue: Queue) {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }
}
