import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { IntelligenceService } from './intelligence.service';
import type { Task } from '@project/shared';

@Processor(QUEUE_NAMES.INTELLIGENCE)
export class IntelligenceProcessor {
  private readonly logger = new Logger(IntelligenceProcessor.name);

  constructor(private readonly intelligenceService: IntelligenceService) {}

  @Process('process')
  async handleIntelligence(job: Job<Task>) {
    const task = job.data;
    this.logger.log(`Processing intelligence task ${task.id}`);

    try {
      // Update task status to processing
      await this.updateTaskStatus(task.id, 'processing');

      // Process the intelligence extraction using the new flow-based approach
      // This returns the parent job ID instead of the result
      const parentJobId = await this.intelligenceService.processTask(task);

      this.logger.log(
        `Intelligence task ${task.id} flow created with parent job: ${parentJobId}`
      );

      // Return the parent job ID for tracking
      return { parentJobId };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Intelligence task ${task.id} failed: ${errorMessage}`);

      // Update task status to failed
      await this.updateTaskStatus(task.id, 'failed', null, errorMessage);

      throw error;
    }
  }

  /**
   * Update task status in PocketBase
   */
  private async updateTaskStatus(
    taskId: string,
    status: 'processing' | 'completed' | 'failed',
    result?: any,
    error?: string
  ): Promise<void> {
    try {
      // This would typically use the PocketBaseService to update the task
      // For now, we'll log the status update
      this.logger.debug(`Task ${taskId} status updated to: ${status}`);

      if (result) {
        this.logger.debug(`Task ${taskId} result:`, result);
      }

      if (error) {
        this.logger.error(`Task ${taskId} error: ${error}`);
      }

      // TODO: Implement actual task status update via PocketBaseService
      // await this.pocketbaseService.taskMutator.update(taskId, {
      //   status,
      //   result: result ? JSON.stringify(result) : undefined,
      //   error,
      //   updatedAt: new Date().toISOString()
      // });
    } catch (updateError) {
      this.logger.error(
        `Failed to update task status for ${taskId}: ${updateError instanceof Error ? updateError.message : String(updateError)}`
      );
      // Don't throw here as it would mask the original error
    }
  }
}
