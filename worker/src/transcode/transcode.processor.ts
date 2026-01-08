import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { QUEUE_NAMES } from '../queue/queue.constants';
import { TranscodeService } from './transcode.service';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { Task, TaskStatus, ProcessUploadResult } from '@project/shared';
import type { TaskUpdatePayload } from './transcode.types';

@Processor(QUEUE_NAMES.TRANSCODE)
export class TranscodeProcessor {
  private readonly logger = new Logger(TranscodeProcessor.name);

  constructor(
    private readonly transcodeService: TranscodeService,
    private readonly pocketbaseService: PocketBaseService,
  ) {
    this.logger.log('TranscodeProcessor initialized and ready to process jobs');
  }

  @Process('process')
  async handleTranscode(job: Job<Task>) {
    const task = job.data;
    this.logger.log(`Processing transcode task ${task.id} (job ${job.id})`);

    try {
      // Update task status to running
      await this.updateTaskStatus(task.id, TaskStatus.RUNNING, 0);

      // Process the transcode task
      const result = await this.transcodeService.processTask(task, async (progress: number) => {
        // Update job progress for Bull dashboard
        await job.progress(progress);
        
        // Update task progress in PocketBase
        await this.updateTaskProgress(task.id, progress);
      });

      // Update task status to success with result
      await this.updateTaskStatus(task.id, TaskStatus.SUCCESS, 100, result);

      this.logger.log(`Transcode task ${task.id} completed successfully`);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(`Transcode task ${task.id} failed: ${errorMessage}`, errorStack);

      // Update task status to failed with error
      await this.updateTaskStatus(task.id, TaskStatus.FAILED, undefined, undefined, errorMessage);

      // Re-throw error so Bull can handle retry logic
      throw error;
    }
  }

  /**
   * Update task status in PocketBase
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    progress?: number,
    result?: ProcessUploadResult,
    error?: string,
  ): Promise<void> {
    try {
      const updates: TaskUpdatePayload = { status };

      if (progress !== undefined) {
        updates.progress = Math.round(progress);
      }

      if (result !== undefined) {
        updates.result = result;
      }

      if (error !== undefined) {
        updates.errorLog = error;
      }

        updates.updated = new Date().toISOString();

      await this.pocketbaseService.updateTask(taskId, updates);

      this.logger.debug(`Updated task ${taskId} status to ${status}${progress !== undefined ? ` (${progress}%)` : ''}`);
    } catch (updateError) {
      this.logger.error(
        `Failed to update task ${taskId} status: ${updateError instanceof Error ? updateError.message : String(updateError)}`
      );
      // Don't throw here as it would interfere with the main processing
    }
  }

  /**
   * Update task progress in PocketBase
   */
  private async updateTaskProgress(taskId: string, progress: number): Promise<void> {
    try {
      await this.pocketbaseService.updateTask(taskId, {
        progress: Math.round(progress),
      });
    } catch (error) {
      // Log but don't throw - progress updates are not critical
      this.logger.debug(
        `Failed to update task ${taskId} progress: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}