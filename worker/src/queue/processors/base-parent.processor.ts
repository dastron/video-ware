import { WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { TaskStatus } from '@project/shared';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../types/job.types';

/**
 * Abstract base class for parent processors
 * Provides common functionality for task status updates and event handling
 * 
 * Subclasses must implement:
 * - processParentJob: Orchestrate child steps and determine success/failure
 * - processStepJob: Dispatch to appropriate step processor
 */
export abstract class BaseParentProcessor extends WorkerHost {
  protected abstract readonly logger: Logger;
  protected abstract readonly pocketbaseService: PocketBaseService;

  /**
   * Main process method - routes to parent or step job handler
   */
  async process(job: Job<ParentJobData | StepJobData>): Promise<any> {
    if (job.name === 'parent') {
      return this.processParentJob(job as Job<ParentJobData>);
    }
    return this.processStepJob(job as Job<StepJobData>);
  }

  /**
   * Process parent job - must be implemented by subclass
   * Should orchestrate child steps and update task status
   */
  protected abstract processParentJob(job: Job<ParentJobData>): Promise<void>;

  /**
   * Process step job - must be implemented by subclass
   * Should dispatch to appropriate step processor
   */
  protected abstract processStepJob(job: Job<StepJobData>): Promise<StepResult>;

  /**
   * Update task status in PocketBase
   * Handles errors gracefully to avoid blocking job processing
   */
  protected async updateTaskStatus(
    taskId: string,
    status: TaskStatus
  ): Promise<void> {
    try {
      await this.pocketbaseService.taskMutator.update(taskId, { status });
      this.logger.log(`Updated task ${taskId} status to ${status}`);
    } catch (error) {
      this.logger.warn(`Failed to update task ${taskId} status: ${error}`);
    }
  }

  /**
   * Handle job completion event
   * Updates task status to SUCCESS when parent job completes
   */
  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) completed`);
    
    // Update task status when parent job completes successfully
    if (job.name === 'parent') {
      const parentData = job.data as ParentJobData;
      await this.updateTaskStatus(parentData.taskId, TaskStatus.SUCCESS);
    }
  }

  /**
   * Handle job failure event
   * Updates task status to FAILED when jobs fail
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error) {
    if (!job) {
      this.logger.error(`Job failed: ${error.message}`);
      return;
    }

    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);

    // Update task status on every failure
    if (job.name === 'parent') {
      // Parent job failed
      const parentData = job.data as ParentJobData;
      await this.updateTaskStatus(parentData.taskId, TaskStatus.FAILED);
    } else {
      // Step job failed
      const stepData = job.data as StepJobData;
      const attemptsMade = job.attemptsMade;
      const maxAttempts = job.opts.attempts || 3;

      if (attemptsMade >= maxAttempts) {
        // Step exhausted all retries - mark task as failed
        this.logger.error(
          `Step ${stepData.stepType} exhausted all ${maxAttempts} retry attempts for task ${stepData.taskId}`
        );
        await this.updateTaskStatus(stepData.taskId, TaskStatus.FAILED);
      } else {
        // Step will retry - update task to show it's still running
        this.logger.warn(
          `Step ${stepData.stepType} failed (attempt ${attemptsMade}/${maxAttempts}) for task ${stepData.taskId}, will retry`
        );
        await this.updateTaskStatus(stepData.taskId, TaskStatus.RUNNING);
      }
    }
  }
}
