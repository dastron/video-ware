import { OnWorkerEvent } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { TaskStatus } from '@project/shared';
import { BaseProcessor } from './base.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../types/job.types';

/**
 * Task result structure stored in the task record
 */
export interface TaskResult {
  steps: Record<string, StepResult>;
  completedSteps: string[];
  failedSteps: string[];
  currentStep?: string;
  totalSteps: number;
  completedCount: number;
  failedCount: number;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Task error log entry
 */
export interface TaskErrorLogEntry {
  timestamp: string;
  step: string;
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}

/**
 * Abstract base class for BullMQ flow processors (parent-child job relationships)
 * Use this for jobs that orchestrate multiple child steps
 *
 * Provides:
 * - Parent job orchestration
 * - Child step coordination
 * - Progress aggregation across steps
 * - Error handling and retry logic
 * - Task result aggregation
 *
 * Subclasses must implement:
 * - processParentJob: Orchestrate child steps
 * - processStepJob: Process individual steps
 * - getTotalSteps: Return expected step count
 * - getQueue: Return the queue instance
 */
export abstract class BaseFlowProcessor extends BaseProcessor {
  /**
   * Get the total number of steps expected for this task
   * Used for calculating progress percentage
   */
  protected abstract getTotalSteps(parentData: ParentJobData): number;

  /**
   * Get the queue instance for accessing child jobs
   */
  protected abstract getQueue(): Queue;

  /**
   * Main process method - routes to parent or step job handler
   */
  async process(
    job: Job<ParentJobData | StepJobData>
  ): Promise<void | StepResult | { skipped: boolean; reason: string }> {
    if (job.name === 'parent') {
      return this.processParentJob(job as Job<ParentJobData>);
    }

    // Skip dependency reference jobs (they don't have stepType in data)
    // These are created by BullMQ for dependency tracking but shouldn't be processed
    const stepData = job.data as StepJobData;
    if (!stepData.stepType) {
      this.logger.debug(
        `Skipping job ${job.id} with name ${job.name} - no stepType (dependency reference created by BullMQ)`
      );
      return { skipped: true, reason: 'dependency_reference' };
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
   * Build task result from aggregated step results
   */
  protected buildTaskResult(
    stepResults: Record<string, StepResult>,
    totalSteps: number,
    startedAt?: string,
    completedAt?: string
  ): TaskResult {
    const completedSteps: string[] = [];
    const failedSteps: string[] = [];

    for (const [stepType, result] of Object.entries(stepResults)) {
      if (result.status === 'completed') {
        completedSteps.push(stepType);
      } else if (result.status === 'failed') {
        failedSteps.push(stepType);
      }
    }

    return {
      steps: stepResults,
      completedSteps,
      failedSteps,
      totalSteps,
      completedCount: completedSteps.length,
      failedCount: failedSteps.length,
      startedAt,
      completedAt,
    };
  }

  /**
   * Calculate progress percentage based on completed steps
   */
  protected calculateProgress(
    stepResults: Record<string, StepResult>,
    totalSteps: number
  ): number {
    if (totalSteps === 0) return 0;

    const completedCount = Object.values(stepResults).filter(
      (result) => result.status === 'completed'
    ).length;

    // Progress is based on completed steps
    // Add small percentage for in-progress steps
    const inProgressCount = Object.values(stepResults).filter(
      (result) => result.status === 'running'
    ).length;

    const baseProgress = (completedCount / totalSteps) * 100;
    const inProgressBonus = (inProgressCount / totalSteps) * 5; // 5% bonus for in-progress

    return Math.min(99, baseProgress + inProgressBonus); // Cap at 99% until all complete
  }

  /**
   * Aggregate error logs from step results
   */
  protected aggregateErrorLogs(
    stepResults: Record<string, StepResult>
  ): string {
    const errorEntries: TaskErrorLogEntry[] = [];

    for (const [stepType, result] of Object.entries(stepResults)) {
      if (result.status === 'failed' && result.error) {
        errorEntries.push({
          timestamp:
            result.completedAt || result.startedAt || new Date().toISOString(),
          step: stepType,
          error: result.error,
          context: {
            startedAt: result.startedAt,
            completedAt: result.completedAt,
          },
        });
      }
    }

    if (errorEntries.length === 0) {
      return '';
    }

    return JSON.stringify(errorEntries, null, 2);
  }

  /**
   * Get task result from parent job data or create new one
   */
  protected getTaskResult(
    parentData: ParentJobData,
    startedAt?: string
  ): TaskResult {
    const totalSteps = this.getTotalSteps(parentData);
    return this.buildTaskResult(parentData.stepResults, totalSteps, startedAt);
  }

  /**
   * Handle job completion event
   * Updates task status and progress when jobs complete
   */
  @OnWorkerEvent('completed')
  async onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) completed`);

    if (job.name === 'parent') {
      await this.handleParentCompleted(job as Job<ParentJobData>);
    } else {
      await this.handleStepCompleted(job as Job<StepJobData>);
    }
  }

  /**
   * Handle parent job completion
   */
  private async handleParentCompleted(job: Job<ParentJobData>) {
    const parentData = job.data;
    const totalSteps = this.getTotalSteps(parentData);

    // Get final step results from all child jobs
    const finalStepResults = { ...parentData.stepResults };

    try {
      const childrenValues = await job.getChildrenValues();
      for (const [, childResult] of Object.entries(childrenValues)) {
        if (
          childResult &&
          typeof childResult === 'object' &&
          'stepType' in childResult
        ) {
          const result = childResult as StepResult;
          finalStepResults[result.stepType] = result;
        }
      }

      // Also check for failed child jobs
      const queue = this.getQueue();
      const allJobs = await queue.getJobs(['failed', 'completed'], 0, -1);

      for (const childJob of allJobs) {
        const childData = childJob.data as StepJobData | undefined;
        if (
          !childData ||
          !childData.stepType ||
          childData.parentJobId !== job.id
        ) {
          continue;
        }

        if (!finalStepResults[childData.stepType]) {
          const jobState = await childJob.getState();
          if (jobState === 'failed') {
            finalStepResults[childData.stepType] = {
              stepType: childData.stepType,
              status: 'failed',
              error: childJob.failedReason || 'Job failed without reason',
              startedAt: childJob.timestamp
                ? new Date(childJob.timestamp).toISOString()
                : undefined,
              completedAt: childJob.finishedOn
                ? new Date(childJob.finishedOn).toISOString()
                : undefined,
            };
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `Failed to aggregate child job results: ${this.formatError(error)}`
      );
    }

    // Build final task result
    const taskResult = this.buildTaskResult(
      finalStepResults,
      totalSteps,
      job.timestamp ? new Date(job.timestamp).toISOString() : undefined,
      job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined
    );

    // Aggregate error logs
    const errorLog = this.aggregateErrorLogs(finalStepResults);

    // Update task with final results
    await this.updateTask(parentData.taskId, {
      status: TaskStatus.SUCCESS,
      progress: 100,
      result: taskResult,
      errorLog: errorLog || undefined,
    });

    this.logger.log(
      `Task ${parentData.taskId} completed successfully: ${taskResult.completedCount}/${totalSteps} steps completed`
    );
  }

  /**
   * Handle step job completion
   */
  private async handleStepCompleted(job: Job<StepJobData>) {
    const stepData = job.data;

    // Skip dependency reference jobs
    if (!stepData.stepType || !stepData.parentJobId) {
      return;
    }

    // Check if job was skipped
    const returnValue = await job.returnvalue;
    if (
      returnValue &&
      typeof returnValue === 'object' &&
      'skipped' in returnValue
    ) {
      return;
    }

    const result = returnValue as StepResult | undefined;

    if (result && result.stepType) {
      try {
        const parentJob = await this.getQueue().getJob(stepData.parentJobId);
        if (!parentJob) {
          this.logger.warn(
            `Parent job ${stepData.parentJobId} not found for step ${result.stepType}`
          );
          return;
        }

        const parentData = parentJob.data as ParentJobData;
        const totalSteps = this.getTotalSteps(parentData);

        // Update step results in parent job data
        const updatedStepResults = {
          ...parentData.stepResults,
          [result.stepType]: result,
        };

        await parentJob.updateData({
          ...parentData,
          stepResults: updatedStepResults,
        });

        // Calculate and update progress
        const progress = this.calculateProgress(updatedStepResults, totalSteps);
        const taskResult = this.getTaskResult(
          { ...parentData, stepResults: updatedStepResults },
          parentJob.timestamp
            ? new Date(parentJob.timestamp).toISOString()
            : undefined
        );
        taskResult.currentStep = result.stepType;

        await this.updateTask(stepData.taskId, {
          progress,
          result: taskResult,
        });

        this.logger.log(
          `Step ${result.stepType} completed for task ${stepData.taskId}, progress: ${progress}%`
        );
      } catch (error) {
        this.logger.error(
          `Failed to update progress for step ${result.stepType}: ${this.formatError(error)}`,
          error instanceof Error ? error.stack : undefined
        );
      }
    }
  }

  /**
   * Handle job failure event
   */
  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error) {
    if (!job) {
      this.logger.error(`Job failed: ${error.message}`);
      return;
    }

    this.logger.error(`Job ${job.id} (${job.name}) failed: ${error.message}`);

    if (job.name === 'parent') {
      await this.handleParentFailed(job as Job<ParentJobData>, error);
    } else {
      await this.handleStepFailed(job as Job<StepJobData>, error);
    }
  }

  /**
   * Handle parent job failure
   */
  private async handleParentFailed(job: Job<ParentJobData>, error: Error) {
    const parentData = job.data;
    const totalSteps = this.getTotalSteps(parentData);

    // Collect all step results including failures
    const finalStepResults: Record<string, StepResult> = {
      ...parentData.stepResults,
    };

    try {
      const queue = this.getQueue();
      const allJobs = await queue.getJobs(['failed', 'completed'], 0, -1);

      for (const childJob of allJobs) {
        const childData = childJob.data as StepJobData | undefined;
        if (
          !childData ||
          !childData.stepType ||
          childData.parentJobId !== job.id
        ) {
          continue;
        }

        const jobState = await childJob.getState();
        if (jobState === 'failed' && !finalStepResults[childData.stepType]) {
          finalStepResults[childData.stepType] = {
            stepType: childData.stepType,
            status: 'failed',
            error: childJob.failedReason || 'Job failed without reason',
            startedAt: childJob.timestamp
              ? new Date(childJob.timestamp).toISOString()
              : undefined,
            completedAt: childJob.finishedOn
              ? new Date(childJob.finishedOn).toISOString()
              : undefined,
          };
        }
      }
    } catch (aggregateError) {
      this.logger.warn(
        `Failed to aggregate failed job results: ${this.formatError(aggregateError)}`
      );
    }

    // Add parent job error
    const parentErrorEntry: TaskErrorLogEntry = {
      timestamp: new Date().toISOString(),
      step: 'parent',
      error: error.message,
      stack: error.stack,
    };

    const taskResult = this.buildTaskResult(
      finalStepResults,
      totalSteps,
      job.timestamp ? new Date(job.timestamp).toISOString() : undefined,
      job.finishedOn ? new Date(job.finishedOn).toISOString() : undefined
    );

    // Aggregate error logs including parent error
    const stepErrors = this.aggregateErrorLogs(finalStepResults);
    const allErrors = stepErrors
      ? JSON.parse(stepErrors).concat([parentErrorEntry])
      : [parentErrorEntry];

    await this.updateTask(parentData.taskId, {
      status: TaskStatus.FAILED,
      progress: this.calculateProgress(finalStepResults, totalSteps),
      result: taskResult,
      errorLog: JSON.stringify(allErrors, null, 2),
    });

    this.logger.error(
      `Task ${parentData.taskId} failed: ${taskResult.failedCount}/${totalSteps} steps failed`
    );
  }

  /**
   * Handle step job failure
   */
  private async handleStepFailed(job: Job<StepJobData>, error: Error) {
    const stepData = job.data;

    // Skip dependency reference jobs
    if (!stepData.stepType || !stepData.parentJobId) {
      return;
    }

    const attemptsMade = job.attemptsMade;
    const maxAttempts = job.opts.attempts || 3;

    // Create failed step result
    const failedResult: StepResult = {
      stepType: stepData.stepType,
      status: 'failed',
      error: error.message,
      startedAt: job.timestamp
        ? new Date(job.timestamp).toISOString()
        : undefined,
      completedAt: job.finishedOn
        ? new Date(job.finishedOn).toISOString()
        : undefined,
    };

    if (attemptsMade >= maxAttempts) {
      // Step exhausted all retries
      this.logger.error(
        `Step ${stepData.stepType} exhausted all ${maxAttempts} retry attempts for task ${stepData.taskId}`
      );

      try {
        const parentJob = await this.getQueue().getJob(stepData.parentJobId);
        if (parentJob) {
          const parentData = parentJob.data as ParentJobData;
          const totalSteps = this.getTotalSteps(parentData);

          const updatedStepResults = {
            ...parentData.stepResults,
            [stepData.stepType]: failedResult,
          };

          await parentJob.updateData({
            ...parentData,
            stepResults: updatedStepResults,
          });

          const progress = this.calculateProgress(
            updatedStepResults,
            totalSteps
          );
          const taskResult = this.getTaskResult(
            { ...parentData, stepResults: updatedStepResults },
            parentJob.timestamp
              ? new Date(parentJob.timestamp).toISOString()
              : undefined
          );

          const errorLog = this.aggregateErrorLogs(updatedStepResults);

          await this.updateTask(stepData.taskId, {
            status: TaskStatus.FAILED,
            progress,
            result: taskResult,
            errorLog: errorLog || undefined,
          });
        } else {
          await this.updateTask(stepData.taskId, {
            status: TaskStatus.FAILED,
            errorLog: this.createErrorLogEntry(stepData.stepType, error),
          });
        }
      } catch (updateError) {
        this.logger.warn(
          `Failed to update task failure: ${this.formatError(updateError)}`
        );
        await this.updateTaskStatus(stepData.taskId, TaskStatus.FAILED);
      }
    } else {
      // Step will retry
      this.logger.warn(
        `Step ${stepData.stepType} failed (attempt ${attemptsMade}/${maxAttempts}) for task ${stepData.taskId}, will retry`
      );

      try {
        const parentJob = await this.getQueue().getJob(stepData.parentJobId);
        if (parentJob) {
          const parentData = parentJob.data as ParentJobData;
          const totalSteps = this.getTotalSteps(parentData);

          const updatedStepResults: Record<string, StepResult> = {
            ...parentData.stepResults,
            [stepData.stepType]: {
              ...failedResult,
              status: 'running',
            },
          };

          const progress = this.calculateProgress(
            updatedStepResults,
            totalSteps
          );
          const taskResult = this.getTaskResult(
            { ...parentData, stepResults: updatedStepResults },
            parentJob.timestamp
              ? new Date(parentJob.timestamp).toISOString()
              : undefined
          );

          await this.updateTask(stepData.taskId, {
            status: TaskStatus.RUNNING,
            progress,
            result: taskResult,
          });
        } else {
          await this.updateTaskStatus(stepData.taskId, TaskStatus.RUNNING);
        }
      } catch (updateError) {
        this.logger.warn(
          `Failed to update task retry status: ${this.formatError(updateError)}`
        );
        await this.updateTaskStatus(stepData.taskId, TaskStatus.RUNNING);
      }
    }
  }

  /**
   * Handle job progress event
   */
  @OnWorkerEvent('progress')
  async onProgress(job: Job, progress: number | object) {
    // Only handle progress for step jobs
    if (job.name === 'parent') {
      return;
    }

    const stepData = job.data as StepJobData;

    // Skip dependency reference jobs
    if (!stepData.stepType || !stepData.parentJobId) {
      return;
    }

    try {
      const parentJob = await this.getQueue().getJob(stepData.parentJobId);
      if (!parentJob) {
        return;
      }

      const parentData = parentJob.data as ParentJobData;
      const totalSteps = this.getTotalSteps(parentData);

      const stepProgress = typeof progress === 'number' ? progress : 0;
      const updatedStepResults = {
        ...parentData.stepResults,
        [stepData.stepType]: {
          stepType: stepData.stepType,
          status: 'running' as const,
          startedAt: job.timestamp
            ? new Date(job.timestamp).toISOString()
            : undefined,
        },
      };

      const overallProgress = this.calculateProgress(
        updatedStepResults,
        totalSteps
      );

      // Adjust based on current step progress
      const stepWeight = 100 / totalSteps;
      const adjustedProgress = Math.min(
        99,
        overallProgress + (stepProgress * stepWeight) / 100
      );

      const taskResult = this.getTaskResult(
        { ...parentData, stepResults: updatedStepResults },
        parentJob.timestamp
          ? new Date(parentJob.timestamp).toISOString()
          : undefined
      );
      taskResult.currentStep = stepData.stepType;

      await this.updateTask(stepData.taskId, {
        progress: Math.round(adjustedProgress),
        result: taskResult,
      });

      this.logger.debug(
        `Task ${stepData.taskId} progress: ${Math.round(adjustedProgress)}% (step ${stepData.stepType}: ${stepProgress}%)`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to update task progress: ${this.formatError(error)}`
      );
    }
  }

  /**
   * Handle active event - when a job becomes active
   */
  @OnWorkerEvent('active')
  async onActive(job: Job) {
    if (job.name === 'parent') {
      await this.handleParentActive(job as Job<ParentJobData>);
    } else {
      await this.handleStepActive(job as Job<StepJobData>);
    }
  }

  /**
   * Handle parent job becoming active
   */
  private async handleParentActive(job: Job<ParentJobData>) {
    const parentData = job.data;
    const totalSteps = this.getTotalSteps(parentData);

    const taskResult = this.getTaskResult(parentData, new Date().toISOString());

    await this.updateTask(parentData.taskId, {
      status: TaskStatus.RUNNING,
      progress: 0,
      result: taskResult,
    });

    this.logger.log(
      `Task ${parentData.taskId} started with ${totalSteps} steps`
    );
  }

  /**
   * Handle step job becoming active
   */
  private async handleStepActive(job: Job<StepJobData>) {
    const stepData = job.data;

    // Skip dependency reference jobs
    if (!stepData.stepType || !stepData.parentJobId) {
      return;
    }

    try {
      const parentJob = await this.getQueue().getJob(stepData.parentJobId);
      if (parentJob) {
        const parentData = parentJob.data as ParentJobData;
        const totalSteps = this.getTotalSteps(parentData);

        const updatedStepResults = {
          ...parentData.stepResults,
          [stepData.stepType]: {
            stepType: stepData.stepType,
            status: 'running' as const,
            startedAt: new Date().toISOString(),
          },
        };

        const progress = this.calculateProgress(updatedStepResults, totalSteps);
        const taskResult = this.getTaskResult(
          { ...parentData, stepResults: updatedStepResults },
          parentJob.timestamp
            ? new Date(parentJob.timestamp).toISOString()
            : undefined
        );
        taskResult.currentStep = stepData.stepType;

        await this.updateTask(stepData.taskId, {
          status: TaskStatus.RUNNING,
          progress: Math.round(progress),
          result: taskResult,
        });

        this.logger.debug(
          `Step ${stepData.stepType} started for task ${stepData.taskId}`
        );
      }
    } catch (error) {
      this.logger.warn(
        `Failed to update task for active step: ${this.formatError(error)}`
      );
    }
  }
}
