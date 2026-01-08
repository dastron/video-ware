import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';
import type { Task } from '@project/shared';

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
    @InjectQueue(QUEUE_NAMES.RENDER) private renderQueue: Queue
  ) {}

  /**
   * Creates base job options with retry logic and common settings.
   * - Retries up to 5 times with 60 second delays
   * - Uses task ID for deduplication
   * - Cleans up completed jobs, keeps failed jobs for debugging
   */
  private getBaseJobOptions(task: Task) {
    return {
      jobId: task.id,
      priority: task.priority || 0,
      attempts: 5, // Retry up to 5 times total
      backoff: 60000, // Wait 60 seconds between retries
      removeOnComplete: true,
      removeOnFail: false, // Keep failed jobs for debugging
    };
  }

  /**
   * Add a transcode job to the queue.
   * BullMQ will handle deduplication via jobId (task.id).
   * If a job with the same jobId already exists and is not completed/failed,
   * BullMQ will throw an error which the caller can handle.
   */
  async addTranscodeJob(task: Task) {
    this.logger.log(`Adding transcode job for task ${task.id}`);
    return this.transcodeQueue.add(
      'process',
      task,
      this.getBaseJobOptions(task)
    );
  }

  /**
   * Add an intelligence job to the queue.
   * BullMQ will handle deduplication via jobId (task.id).
   */
  async addIntelligenceJob(task: Task) {
    this.logger.log(`Adding intelligence job for task ${task.id}`);
    return this.intelligenceQueue.add(
      'process',
      task,
      this.getBaseJobOptions(task)
    );
  }

  /**
   * Add a render job to the queue.
   * BullMQ will handle deduplication via jobId (task.id).
   */
  async addRenderJob(task: Task) {
    this.logger.log(`Adding render job for task ${task.id}`);
    return this.renderQueue.add('process', task, this.getBaseJobOptions(task));
  }

  /**
   * Get metrics for all queues.
   * Use Bull Board for detailed job tracking and management.
   */
  async getQueueMetrics() {
    const [transcodeMetrics, intelligenceMetrics, renderMetrics] =
      await Promise.all([
        this.getQueueStats(this.transcodeQueue),
        this.getQueueStats(this.intelligenceQueue),
        this.getQueueStats(this.renderQueue),
      ]);

    return {
      transcode: transcodeMetrics,
      intelligence: intelligenceMetrics,
      render: renderMetrics,
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
