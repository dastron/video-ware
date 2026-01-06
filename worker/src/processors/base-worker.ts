import type { Task, TypedPocketBase, RetryConfig } from '@project/shared';
import {
  TaskMutator,
  UploadError,
  createTaskErrorLog,
  formatTaskErrorLog,
  shouldRetry,
  sleep,
  TaskStatus,
} from '@project/shared';
import { statSync } from 'node:fs';

/**
 * Retry configuration for task processing
 */
export const TASK_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 60000, // 60 seconds
  maxDelayMs: 300000, // 5 minutes
  jitterFactor: 0.1,
};

/**
 * Abstract base class for task workers
 * Provides common functionality for task processing including:
 * - Task status management
 * - Error handling with retry logic
 * - Progress tracking
 * - Utility functions (file size, deterministic naming)
 */
export abstract class BaseWorker {
  protected pb: TypedPocketBase;
  protected taskMutator: TaskMutator;

  constructor(pb: TypedPocketBase) {
    this.pb = pb;
    this.taskMutator = new TaskMutator(pb);
  }

  /**
   * Abstract method that each worker must implement
   * This contains the core task processing logic
   */
  abstract processTask(task: Task): Promise<void>;

  /**
   * Execute a task with error handling and retry logic
   * This wraps the processTask method with common error handling
   */
  async execute(task: Task): Promise<void> {
    try {
      await this.processTask(task);
    } catch (error) {
      await this.handleError(task, error);
    }
  }

  /**
   * Handle task errors with retry logic
   */
  protected async handleError(task: Task, error: unknown): Promise<void> {
    // Handle errors with proper error types
    const uploadError = UploadError.fromError(error);
    const errorLog = createTaskErrorLog('unknown', uploadError, {
      taskId: task.id,
    });
    const formattedError = formatTaskErrorLog(errorLog);

    console.error(`[Worker] Task ${task.id} failed:`, uploadError.message);

    // Mark task as failed
    await this.taskMutator.markFailed(task.id, formattedError);

    // Check if we should retry using exponential backoff
    const updatedTask = await this.taskMutator.getById(task.id);
    if (updatedTask) {
      const retryDecision = shouldRetry(
        uploadError,
        updatedTask.attempts,
        TASK_RETRY_CONFIG
      );

      if (retryDecision.shouldRetry) {
        console.log(
          `[Worker] Task ${task.id} will be retried: ${retryDecision.reason}`
        );

        // Wait for backoff delay before resetting to queued
        console.log(
          `[Worker] Waiting ${retryDecision.delayMs}ms before retry...`
        );
        await sleep(retryDecision.delayMs);

        // Reset to queued for retry
        await this.taskMutator.update(task.id, {
          status: TaskStatus.QUEUED,
          progress: 0,
        } as Partial<Task>);
      } else {
        console.log(
          `[Worker] Task ${task.id} will not be retried: ${retryDecision.reason}`
        );
      }
    }
  }

  /**
   * Update task progress
   */
  protected async updateProgress(
    taskId: string,
    progress: number
  ): Promise<void> {
    await this.taskMutator.updateProgress(taskId, progress);
  }

  /**
   * Update task status
   */
  protected async updateStatus(
    taskId: string,
    status: TaskStatus
  ): Promise<void> {
    await this.taskMutator.update(taskId, {
      status,
    } as Partial<Task>);
  }

  /**
   * Mark task as successful
   */
  protected async markSuccess(
    taskId: string,
    result: Record<string, unknown>
  ): Promise<void> {
    await this.taskMutator.markSuccess(taskId, result);
    console.log(`[Worker] Task ${taskId} completed successfully`);
  }

  /**
   * Generate deterministic output file name based on uploadId and config
   * This ensures idempotent processing - same inputs always produce same output names
   */
  protected generateDeterministicFileName(
    uploadId: string,
    fileType: 'thumbnail' | 'sprite' | 'proxy',
    config: Record<string, unknown>
  ): string {
    // Create a simple hash from the config to ensure deterministic naming
    const configStr = JSON.stringify(config, Object.keys(config).sort());
    const configHash = this.simpleHash(configStr);

    const extension = fileType === 'proxy' ? 'mp4' : 'jpg';
    return `${fileType}_${uploadId}_${configHash}.${extension}`;
  }

  /**
   * Simple hash function for deterministic naming
   * Not cryptographically secure, but sufficient for file naming
   */
  protected simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16).substring(0, 8);
  }

  /**
   * Helper to get file size from local path
   * Returns 1 if file not found or error to satisfy PocketBase "cannot be blank"
   */
  protected getFileSize(filePath: string): number {
    try {
      const stats = statSync(filePath);
      return stats.size || 1;
    } catch (error) {
      console.warn(`[Worker] Failed to get file size for ${filePath}:`, error);
      return 1;
    }
  }
}
