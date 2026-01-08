import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { IntelligenceStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { VideoIntelligenceStepProcessor } from './video-intelligence-step.processor';
import { SpeechToTextStepProcessor } from './speech-to-text-step.processor';
import { StoreResultsStepProcessor } from './store-results-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { TaskStatus } from '@project/shared';

/**
 * Parent processor for intelligence tasks
 * Orchestrates child step processors and aggregates results
 *
 * Key difference from other parent processors:
 * - Allows partial success (one step can fail while others succeed)
 * - VIDEO_INTELLIGENCE and SPEECH_TO_TEXT run in parallel
 * - STORE_RESULTS combines results from both steps
 */
@Processor(QUEUE_NAMES.INTELLIGENCE)
export class IntelligenceParentProcessor extends WorkerHost {
  private readonly logger = new Logger(IntelligenceParentProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.INTELLIGENCE)
    private readonly intelligenceQueue: Queue,
    private readonly pocketbaseService: PocketBaseService,
    private readonly videoIntelligenceStepProcessor: VideoIntelligenceStepProcessor,
    private readonly speechToTextStepProcessor: SpeechToTextStepProcessor,
    private readonly storeResultsStepProcessor: StoreResultsStepProcessor
  ) {
    super();
  }

  /**
   * Process jobs from the intelligence queue
   * Dispatches to appropriate handler based on job name
   */
  async process(job: Job<ParentJobData | StepJobData>): Promise<any> {
    this.logger.log(`Processing job ${job.id} with name: ${job.name}`);

    // Handle parent job
    if (job.name === 'parent') {
      return this.processParentJob(job as Job<ParentJobData>);
    }

    // Handle step jobs
    return this.processStepJob(job as Job<StepJobData>);
  }

  /**
   * Process parent job - orchestrates child steps and aggregates results
   *
   * Intelligence tasks allow partial success:
   * - If VIDEO_INTELLIGENCE fails but SPEECH_TO_TEXT succeeds, task succeeds
   * - If SPEECH_TO_TEXT fails but VIDEO_INTELLIGENCE succeeds, task succeeds
   * - If both fail, task fails
   * - STORE_RESULTS only runs if at least one analysis step succeeds
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

    for (const [, childResult] of Object.entries(childrenValues)) {
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

    // Check which analysis steps succeeded
    const videoIntelligenceResult =
      aggregatedResults[IntelligenceStepType.VIDEO_INTELLIGENCE];
    const speechToTextResult =
      aggregatedResults[IntelligenceStepType.SPEECH_TO_TEXT];
    const storeResultsResult =
      aggregatedResults[IntelligenceStepType.STORE_RESULTS];

    const videoIntelligenceSucceeded =
      videoIntelligenceResult?.status === 'completed';
    const speechToTextSucceeded = speechToTextResult?.status === 'completed';
    const storeResultsSucceeded = storeResultsResult?.status === 'completed';

    // Log results of analysis steps
    this.logger.log(`Intelligence analysis results for task ${task.id}:`, {
      videoIntelligence: videoIntelligenceSucceeded ? 'success' : 'failed',
      speechToText: speechToTextSucceeded ? 'success' : 'failed',
      storeResults: storeResultsSucceeded ? 'success' : 'failed',
    });

    // Determine overall task status
    // Task succeeds if:
    // 1. At least one analysis step (VIDEO_INTELLIGENCE or SPEECH_TO_TEXT) succeeded
    // 2. STORE_RESULTS succeeded (if it ran)
    const atLeastOneAnalysisSucceeded =
      videoIntelligenceSucceeded || speechToTextSucceeded;

    if (!atLeastOneAnalysisSucceeded) {
      // Both analysis steps failed
      this.logger.error(
        `Task ${task.id} failed: both VIDEO_INTELLIGENCE and SPEECH_TO_TEXT failed`
      );
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error('Intelligence task failed: both analysis steps failed');
    }

    if (!storeResultsSucceeded) {
      // At least one analysis succeeded but STORE_RESULTS failed
      this.logger.error(`Task ${task.id} failed: STORE_RESULTS step failed`);
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error('Intelligence task failed: failed to store results');
    }

    // Task succeeded with at least partial results
    if (videoIntelligenceSucceeded && speechToTextSucceeded) {
      this.logger.log(
        `Task ${task.id} completed successfully with full intelligence data`
      );
    } else if (videoIntelligenceSucceeded) {
      this.logger.log(
        `Task ${task.id} completed successfully with video intelligence only (speech-to-text failed)`
      );
    } else {
      this.logger.log(
        `Task ${task.id} completed successfully with speech-to-text only (video intelligence failed)`
      );
    }

    await this.updateTaskStatus(task.id, TaskStatus.SUCCESS);
  }

  /**
   * Process step job - dispatches to appropriate step processor
   */
  private async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input, parentJobId } = job.data;
    const startedAt = new Date();

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    // Check if this step has already been completed in a previous attempt
    // This allows retries to skip successful steps and only re-run failed ones
    if (parentJobId) {
      const parentJob = await this.intelligenceQueue.getJob(parentJobId);
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
      let output: any;

      // Dispatch to appropriate step processor based on step type
      switch (stepType) {
        case IntelligenceStepType.VIDEO_INTELLIGENCE:
          output = await this.videoIntelligenceStepProcessor.process(
            input as any,
            job
          );
          break;

        case IntelligenceStepType.SPEECH_TO_TEXT:
          output = await this.speechToTextStepProcessor.process(
            input as any,
            job
          );
          break;

        case IntelligenceStepType.STORE_RESULTS:
          output = await this.storeResultsStepProcessor.process(
            input as any,
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

      // For intelligence tasks, we allow partial success
      // Don't re-throw for VIDEO_INTELLIGENCE or SPEECH_TO_TEXT failures
      // Let the parent job handle the partial success logic
      if (
        stepType === IntelligenceStepType.VIDEO_INTELLIGENCE ||
        stepType === IntelligenceStepType.SPEECH_TO_TEXT
      ) {
        this.logger.warn(
          `Step ${stepType} failed but allowing partial success`
        );
        return result;
      }

      // For STORE_RESULTS, re-throw to let BullMQ handle retry logic
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

        // For intelligence tasks, only mark as failed if it's a critical step
        // VIDEO_INTELLIGENCE and SPEECH_TO_TEXT failures are allowed (partial success)
        // STORE_RESULTS failure should mark task as failed
        if (stepType === IntelligenceStepType.STORE_RESULTS) {
          if (parentJobId) {
            try {
              await this.updateTaskStatus(taskId, TaskStatus.FAILED);
              this.logger.log(
                `Marked task ${taskId} as failed due to STORE_RESULTS retry exhaustion`
              );
            } catch (updateError) {
              this.logger.error(`Failed to update task status: ${updateError}`);
            }
          }
        } else {
          this.logger.warn(
            `Step ${stepType} exhausted retries but allowing partial success for intelligence task ${taskId}`
          );
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
      const parentJob = await this.intelligenceQueue.getJob(parentJobId);
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
