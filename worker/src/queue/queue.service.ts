import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from './queue.constants';
import { FlowService } from './flow.service';
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
    @InjectQueue(QUEUE_NAMES.RENDER) private renderQueue: Queue,
    private readonly flowService: FlowService
  ) {}

  /**
   * Add a transcode job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addTranscodeJob(task: Task) {
    this.logger.log(`Adding transcode job for task ${task.id}`);
    
    // Create the transcode flow
    const parentJobId = await this.flowService.createTranscodeFlow(task);
    this.logger.log(`Created transcode flow for task ${task.id}, parent job: ${parentJobId}`);
    
    return parentJobId;
  }

  /**
   * Add an intelligence job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addIntelligenceJob(task: Task) {
    this.logger.log(`Adding intelligence job for task ${task.id}`);
    
    // Create the intelligence flow
    const parentJobId = await this.flowService.createDetectLabelsFlow(task);
    this.logger.log(`Created intelligence flow for task ${task.id}, parent job: ${parentJobId}`);
    
    return parentJobId;
  }

  /**
   * Add a render job to the queue.
   * Creates a flow with parent-child jobs for step-based processing.
   */
  async addRenderJob(task: Task) {
    this.logger.log(`Adding render job for task ${task.id}`);
    
    // Create the render flow
    const parentJobId = await this.flowService.createRenderFlow(task);
    this.logger.log(`Created render flow for task ${task.id}, parent job: ${parentJobId}`);
    
    return parentJobId;
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
