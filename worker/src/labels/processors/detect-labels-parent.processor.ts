import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { DetectLabelsStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { VideoIntelligenceStepProcessor } from './video-intelligence-step.processor';
import { SpeechToTextStepProcessor } from './speech-to-text-step.processor';
import { NormalizeLabelsStepProcessor } from './normalize-labels-step.processor';
import { StoreResultsStepProcessor } from './store-results-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { TaskStatus } from '@project/shared';

/**
 * Parent processor for detect_labels tasks
 * Orchestrates child step processors and aggregates results
 *
 * Key features:
 * - Allows partial success (one analysis step can fail while others succeed)
 * - VIDEO_INTELLIGENCE and SPEECH_TO_TEXT run in parallel
 * - NORMALIZE_LABELS combines results from both analysis steps
 * - STORE_RESULTS persists normalized data to PocketBase
 */
@Processor(QUEUE_NAMES.LABELS)
export class DetectLabelsParentProcessor extends WorkerHost {
  private readonly logger = new Logger(DetectLabelsParentProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.LABELS)
    private readonly labelsQueue: Queue,
    private readonly pocketbaseService: PocketBaseService,
    private readonly videoIntelligenceStepProcessor: VideoIntelligenceStepProcessor,
    private readonly speechToTextStepProcessor: SpeechToTextStepProcessor,
    private readonly normalizeLabelsStepProcessor: NormalizeLabelsStepProcessor,
    private readonly storeResultsStepProcessor: StoreResultsStepProcessor,
  ) {
    super();
  }

  /**
   * Process jobs from the labels queue
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
   * Detect labels tasks allow partial success:
   * - If VIDEO_INTELLIGENCE fails but SPEECH_TO_TEXT succeeds, task succeeds
   * - If SPEECH_TO_TEXT fails but VIDEO_INTELLIGENCE succeeds, task succeeds
   * - If both analysis steps fail, task fails
   * - NORMALIZE_LABELS and STORE_RESULTS only run if at least one analysis step succeeds
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
      `Cached ${Object.keys(aggregatedResults).length} step results for task ${task.id}`,
    );

    // Check which steps succeeded
    const videoIntelligenceResult =
      aggregatedResults[DetectLabelsStepType.VIDEO_INTELLIGENCE];
    const speechToTextResult =
      aggregatedResults[DetectLabelsStepType.SPEECH_TO_TEXT];
    const normalizeLabelsResult =
      aggregatedResults[DetectLabelsStepType.NORMALIZE_LABELS];
    const storeResultsResult =
      aggregatedResults[DetectLabelsStepType.STORE_RESULTS];

    const videoIntelligenceSucceeded =
      videoIntelligenceResult?.status === 'completed';
    const speechToTextSucceeded = speechToTextResult?.status === 'completed';
    const normalizeLabelsSucceeded =
      normalizeLabelsResult?.status === 'completed';
    const storeResultsSucceeded = storeResultsResult?.status === 'completed';

    // Log results of analysis steps
    this.logger.log(`Detect labels results for task ${task.id}:`, {
      videoIntelligence: videoIntelligenceSucceeded ? 'success' : 'failed',
      speechToText: speechToTextSucceeded ? 'success' : 'failed',
      normalizeLabels: normalizeLabelsSucceeded ? 'success' : 'failed',
      storeResults: storeResultsSucceeded ? 'success' : 'failed',
    });

    // Determine overall task status
    // Task succeeds if:
    // 1. At least one analysis step (VIDEO_INTELLIGENCE or SPEECH_TO_TEXT) succeeded
    // 2. NORMALIZE_LABELS succeeded
    // 3. STORE_RESULTS succeeded
    const atLeastOneAnalysisSucceeded =
      videoIntelligenceSucceeded || speechToTextSucceeded;

    if (!atLeastOneAnalysisSucceeded) {
      // Both analysis steps failed
      this.logger.error(
        `Task ${task.id} failed: both VIDEO_INTELLIGENCE and SPEECH_TO_TEXT failed`,
      );
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error(
        'Detect labels task failed: both analysis steps failed',
      );
    }

    if (!normalizeLabelsSucceeded) {
      // At least one analysis succeeded but NORMALIZE_LABELS failed
      this.logger.error(
        `Task ${task.id} failed: NORMALIZE_LABELS step failed`,
      );
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error('Detect labels task failed: normalization failed');
    }

    if (!storeResultsSucceeded) {
      // Normalization succeeded but STORE_RESULTS failed
      this.logger.error(`Task ${task.id} failed: STORE_RESULTS step failed`);
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error('Detect labels task failed: failed to store results');
    }

    // Task succeeded with at least partial results
    if (videoIntelligenceSucceeded && speechToTextSucceeded) {
      this.logger.log(
        `Task ${task.id} completed successfully with full label data`,
      );
    } else if (videoIntelligenceSucceeded) {
      this.logger.log(
        `Task ${task.id} completed successfully with video intelligence only (speech-to-text failed)`,
      );
    } else {
      this.logger.log(
        `Task ${task.id} completed successfully with speech-to-text only (video intelligence failed)`,
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
      const parentJob = await this.labelsQueue.getJob(parentJobId);
      if (parentJob) {
        const parentData = parentJob.data as ParentJobData;
        const cachedResult = parentData.stepResults[stepType];

        if (cachedResult && cachedResult.status === 'completed') {
          this.logger.log(
            `Step ${stepType} already completed in previous attempt, using cached result`,
          );
          return cachedResult;
        }
      }
    }

    try {
      let output: any;

      // Dispatch to appropriate step processor based on step type
      switch (stepType) {
        case DetectLabelsStepType.VIDEO_INTELLIGENCE:
          output = await this.videoIntelligenceStepProcessor.process(
            input as any,
            job,
          );
          break;

        case DetectLabelsStepType.SPEECH_TO_TEXT:
          output = await this.speechToTextStepProcessor.process(
            input as any,
            job,
          );
          break;

        case DetectLabelsStepType.NORMALIZE_LABELS:
          output = await this.normalizeLabelsStepProcessor.process(
            input as any,
            job,
          );
          break;

        case DetectLabelsStepType.STORE_RESULTS:
          output = await this.storeResultsStepProcessor.process(
            input as any,
            job,
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
        error instanceof Error ? error.stack : undefined,
      );

      // Create failed result
      const result: StepResult = {
        stepType,
        status: 'failed',
        error: errorMessage,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      // For detect labels tasks, we allow partial success
      // Don't re-throw for VIDEO_INTELLIGENCE or SPEECH_TO_TEXT failures
      // Let the parent job handle the partial success logic
      if (
        stepType === DetectLabelsStepType.VIDEO_INTELLIGENCE ||
        stepType === DetectLabelsStepType.SPEECH_TO_TEXT
      ) {
        this.logger.warn(
          `Step ${stepType} failed but allowing partial success`,
        );
        return result;
      }

      // For NORMALIZE_LABELS and STORE_RESULTS, re-throw to let BullMQ handle retry logic
      throw error;
    }
  }

  /**
   * Update task status in PocketBase
   */
  private async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
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
          `Step ${stepType} exhausted all ${maxAttempts} retry attempts for task ${taskId}`,
        );

        // For detect labels tasks, only mark as failed if it's a critical step
        // VIDEO_INTELLIGENCE and SPEECH_TO_TEXT failures are allowed (partial success)
        // NORMALIZE_LABELS and STORE_RESULTS failures should mark task as failed
        if (
          stepType === DetectLabelsStepType.NORMALIZE_LABELS ||
          stepType === DetectLabelsStepType.STORE_RESULTS
        ) {
          if (parentJobId) {
            try {
              await this.updateTaskStatus(taskId, TaskStatus.FAILED);
              this.logger.log(
                `Marked task ${taskId} as failed due to ${stepType} retry exhaustion`,
              );
            } catch (updateError) {
              this.logger.error(`Failed to update task status: ${updateError}`);
            }
          }
        } else {
          this.logger.warn(
            `Step ${stepType} exhausted retries but allowing partial success for detect labels task ${taskId}`,
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
      const parentJob = await this.labelsQueue.getJob(parentJobId);
      if (!parentJob) {
        this.logger.warn(
          `Parent job ${parentJobId} not found for step ${stepType}`,
        );
        return;
      }

      // Update parent job progress with current step information
      await parentJob.updateProgress({
        currentStep: stepType,
        currentStepProgress: typeof progress === 'number' ? progress : 0,
      });

      this.logger.debug(
        `Updated parent job ${parentJobId} with step ${stepType} progress`,
      );
    } catch (error) {
      this.logger.warn(`Failed to update parent progress: ${error}`);
      // Don't throw - progress updates are non-critical
    }
  }
}
