import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { TranscodeStepType } from '../../queue/types/step.types';
import type { StepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { ProbeStepProcessor } from './probe-step.processor';
import { ThumbnailStepProcessor } from './thumbnail-step.processor';
import { SpriteStepProcessor } from './sprite-step.processor';
import { TranscodeStepProcessor } from './transcode-step.processor';
import { FinalizeStepProcessor } from './finalize-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
  StepInput,
} from '../../queue/types/job.types';
import type {
  ProbeStepInput,
  ThumbnailStepInput,
  SpriteStepInput,
  TranscodeStepInput,
  FinalizeStepInput,
} from '../types/step-inputs';
import { TaskStatus } from '@project/shared';

/**
 * Parent processor for transcode tasks
 * Orchestrates child step processors and aggregates results
 */
@Processor(QUEUE_NAMES.TRANSCODE)
export class TranscodeParentProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodeParentProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TRANSCODE) private readonly transcodeQueue: Queue,
    private readonly pocketbaseService: PocketBaseService,
    private readonly probeStepProcessor: ProbeStepProcessor,
    private readonly thumbnailStepProcessor: ThumbnailStepProcessor,
    private readonly spriteStepProcessor: SpriteStepProcessor,
    private readonly transcodeStepProcessor: TranscodeStepProcessor,
    private readonly finalizeStepProcessor: FinalizeStepProcessor
  ) {
    super();
  }

  /**
   * Process jobs from the transcode queue
   * Dispatches to appropriate handler based on job name
   */
  async process(job: Job<ParentJobData | StepJobData>): Promise<unknown> {
    this.logger.log(`Processing job ${job.id} with name: ${job.name}`);
    this.logger.debug(`Job data keys: ${Object.keys(job.data).join(', ')}`);

    // Handle parent job
    if (job.name === 'parent') {
      return this.processParentJob(job as Job<ParentJobData>);
    }

    // Handle step jobs - the job name should match the step type
    // Cast the job data to StepJobData and ensure stepType is set from job name if missing
    const stepJobData = job.data as StepJobData;
    if (!stepJobData.stepType) {
      // If stepType is missing, use the job name as the step type
      stepJobData.stepType = job.name as TranscodeStepType;
      this.logger.warn(
        `Step type was missing for job ${job.id}, using job name: ${job.name}`
      );
    }

    return this.processStepJob(job as Job<StepJobData>);
  }

  /**
   * Process parent job - orchestrates child steps and aggregates results
   */
  private async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { task, stepResults } = job.data;

    this.logger.log(`Processing parent job for task ${task.id}`);

    // Update task status to running
    await this.updateTaskStatus(task.id, TaskStatus.RUNNING);

    // Wait for all children to complete
    // BullMQ automatically handles this - parent job only completes when all children are done
    const childrenValues = await job.getChildrenValues();

    this.logger.log(`All children completed for task ${task.id}`, {
      childrenCount: Object.keys(childrenValues).length,
    });

    // Aggregate step results from children
    const aggregatedResults: Record<string, StepResult> = { ...stepResults };

    for (const [childJobId, childResult] of Object.entries(childrenValues)) {
      if (
        childResult &&
        typeof childResult === 'object' &&
        'stepType' in childResult
      ) {
        const result = childResult as StepResult;
        aggregatedResults[result.stepType] = result;
      }
    }

    // Cache step results in parent job data for retry scenarios
    // This allows failed steps to be retried without re-executing successful steps
    await job.updateData({
      ...job.data,
      stepResults: aggregatedResults,
    });

    this.logger.log(
      `Cached ${Object.keys(aggregatedResults).length} step results for task ${task.id}`
    );

    // Check if any steps failed
    const failedSteps = Object.values(aggregatedResults).filter(
      (result) => result.status === 'failed'
    );

    if (failedSteps.length > 0) {
      this.logger.error(
        `Task ${task.id} has ${failedSteps.length} failed steps`
      );
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error(`Task failed with ${failedSteps.length} failed steps`);
    }

    // All steps completed successfully
    this.logger.log(`Task ${task.id} completed successfully`);
    await this.updateTaskStatus(task.id, TaskStatus.SUCCESS);
  }

  /**
   * Process step job - dispatches to appropriate step processor
   */
  private async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    // BullMQ flows sometimes don't preserve the full job data structure
    // We need to handle cases where the data might be at the root level
    let stepType: StepType;
    let input: StepInput;
    let parentJobId: string;
    
    // Check if data has the expected structure
    if ('stepType' in job.data && 'input' in job.data) {
      ({ stepType, input, parentJobId } = job.data);
    } else {
      // Fallback: try to reconstruct from job name and data
      this.logger.warn(
        `Job ${job.id} has unexpected data structure, attempting to reconstruct`
      );
      stepType = job.name as StepType;
      // The entire job.data might be the input
      input = job.data as unknown as StepInput;
      parentJobId = '';
    }
    
    const startedAt = new Date();

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);
    
    // Debug: Log job data structure if input is still undefined
    if (!input) {
      this.logger.error(
        `Input is undefined for step ${stepType}, job data:`,
        JSON.stringify(job.data, null, 2)
      );
      this.logger.error(`Job name: ${job.name}, Job ID: ${job.id}`);
      throw new Error(`Input is undefined for step ${stepType}`);
    }

    // Check if this step has already been completed in a previous attempt
    // This allows retries to skip successful steps and only re-run failed ones
    if (parentJobId) {
      const parentJob = await this.transcodeQueue.getJob(parentJobId);
      if (parentJob) {
        const parentData = parentJob.data as ParentJobData;
        const cachedResult = parentData.stepResults[stepType];

        if (cachedResult && cachedResult.status === 'completed') {
          this.logger.log(
            `Step ${stepType} already completed in previous attempt, using cached result`
          );
          return cachedResult;
        }
      }
    }

    try {
      let output: unknown;

      // Dispatch to appropriate step processor based on step type
      switch (stepType) {
        case TranscodeStepType.PROBE:
          output = await this.probeStepProcessor.process(
            input as ProbeStepInput,
            job
          );
          break;

        case TranscodeStepType.THUMBNAIL:
          output = await this.thumbnailStepProcessor.process(
            input as ThumbnailStepInput,
            job
          );
          break;

        case TranscodeStepType.SPRITE:
          output = await this.spriteStepProcessor.process(
            input as SpriteStepInput,
            job
          );
          break;

        case TranscodeStepType.TRANSCODE:
          output = await this.transcodeStepProcessor.process(
            input as TranscodeStepInput,
            job
          );
          break;

        case TranscodeStepType.FINALIZE:
          output = await this.finalizeStepProcessor.process(
            input as FinalizeStepInput,
            job
          );
          break;

        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      // Create successful result
      const result: StepResult = {
        stepType,
        status: 'completed',
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      this.logger.log(`Step ${stepType} completed successfully`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Step ${stepType} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined
      );

      // Create failed result
      const result: StepResult = {
        stepType,
        status: 'failed',
        error: errorMessage,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      // Re-throw to let BullMQ handle retry logic
      throw error;
    }
  }

  /**
   * Update task status in PocketBase
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus
  ): Promise<void> {
    try {
      await this.pocketbaseService.taskMutator.update(taskId, { status });
      this.logger.log(`Updated task ${taskId} status to ${status}`);
    } catch (error) {
      this.logger.warn(`Failed to update task ${taskId} status: ${error}`);
      // Don't throw - task processing should continue even if status update fails
    }
  }

  /**
   * Handle job completion event
   */
  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`Job ${job.id} (${job.name}) completed`);
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

    // Handle step job failures - check if retries are exhausted
    if (job.name !== 'parent') {
      const stepData = job.data as StepJobData;
      const { parentJobId, stepType, taskId } = stepData;

      // Check if this was the final retry attempt
      const attemptsMade = job.attemptsMade;
      const maxAttempts = job.opts.attempts || 3;

      if (attemptsMade >= maxAttempts) {
        this.logger.error(
          `Step ${stepType} exhausted all ${maxAttempts} retry attempts for task ${taskId}`
        );

        // Mark parent task as failed since a step has exhausted retries
        if (parentJobId) {
          try {
            await this.updateTaskStatus(taskId, TaskStatus.FAILED);
            this.logger.log(
              `Marked task ${taskId} as failed due to step retry exhaustion`
            );
          } catch (updateError) {
            this.logger.error(`Failed to update task status: ${updateError}`);
          }
        }
      }
    }
  }

  /**
   * Handle job progress event
   * Aggregates progress from child steps and updates parent job progress
   */
  @OnWorkerEvent('progress')
  async onProgress(job: Job, progress: number | object) {
    // Only handle progress for step jobs
    if (job.name === 'parent') {
      return;
    }

    const stepData = job.data as StepJobData;
    const { parentJobId, stepType } = stepData;

    if (!parentJobId) {
      return;
    }

    try {
      // Get parent job
      const parentJob = await this.transcodeQueue.getJob(parentJobId);
      if (!parentJob) {
        this.logger.warn(
          `Parent job ${parentJobId} not found for step ${stepType}`
        );
        return;
      }

      // Update parent job progress with current step information
      // Note: We can't easily aggregate all child progress without iterating through all jobs
      // So we just update with the current step's progress
      await parentJob.updateProgress({
        currentStep: stepType,
        currentStepProgress: typeof progress === 'number' ? progress : 0,
      });

      this.logger.debug(
        `Updated parent job ${parentJobId} with step ${stepType} progress`
      );
    } catch (error) {
      this.logger.warn(`Failed to update parent progress: ${error}`);
      // Don't throw - progress updates are non-critical
    }
  }
}
