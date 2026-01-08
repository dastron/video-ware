import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { DetectLabelsStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { ProcessorsConfigService } from '../../config/processors.config';
import {
  UploadToGcsStepProcessor,
  type UploadToGcsStepInput,
} from './upload-to-gcs-step.processor';
import {
  LabelDetectionStepProcessor,
  type LabelDetectionStepInput,
  type LabelDetectionStepOutput,
} from './label-detection-step.processor';
import {
  ObjectTrackingStepProcessor,
  type ObjectTrackingStepInput,
  type ObjectTrackingStepOutput,
} from './object-tracking-step.processor';
import {
  FaceDetectionStepProcessor,
  type FaceDetectionStepInput,
  type FaceDetectionStepOutput,
} from './face-detection-step.processor';
import {
  PersonDetectionStepProcessor,
  type PersonDetectionStepInput,
  type PersonDetectionStepOutput,
} from './person-detection-step.processor';
import {
  SpeechTranscriptionStepProcessor,
  type SpeechTranscriptionStepInput,
  type SpeechTranscriptionStepOutput,
} from './speech-transcription-step.processor';

import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import { TaskStatus } from '@project/shared';

/**
 * Union type of all possible step inputs
 */
type DetectLabelsStepInput =
  | UploadToGcsStepInput
  | LabelDetectionStepInput
  | ObjectTrackingStepInput
  | FaceDetectionStepInput
  | PersonDetectionStepInput
  | SpeechTranscriptionStepInput;

/**
 * Union type of all possible step outputs
 */
type DetectLabelsStepOutput =
  | LabelDetectionStepOutput
  | ObjectTrackingStepOutput
  | FaceDetectionStepOutput
  | PersonDetectionStepOutput
  | SpeechTranscriptionStepOutput;

/**
 * Parent processor for detect_labels tasks
 * Orchestrates child step processors and aggregates results
 *
 * Key features:
 * - Allows partial success (one processor can fail while others succeed)
 * - UPLOAD_TO_GCS runs first to upload file to GCS
 * - Five new GCVI processors run in parallel (if enabled):
 *   - LABEL_DETECTION (labels + shot changes)
 *   - OBJECT_TRACKING (tracked objects with keyframes)
 *   - FACE_DETECTION (tracked faces with attributes)
 *   - PERSON_DETECTION (tracked persons with landmarks)
 *   - SPEECH_TRANSCRIPTION (speech-to-text)
 * - Each processor processes and writes its own data independently
 * - Task succeeds if at least one enabled processor succeeds
 */
@Processor(QUEUE_NAMES.LABELS)
export class DetectLabelsParentProcessor extends WorkerHost {
  private readonly logger = new Logger(DetectLabelsParentProcessor.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.LABELS)
    private readonly labelsQueue: Queue,
    private readonly pocketbaseService: PocketBaseService,
    private readonly processorsConfigService: ProcessorsConfigService,
    private readonly uploadToGcsStepProcessor: UploadToGcsStepProcessor,
    // New GCVI processors
    private readonly labelDetectionStepProcessor: LabelDetectionStepProcessor,
    private readonly objectTrackingStepProcessor: ObjectTrackingStepProcessor,
    private readonly faceDetectionStepProcessor: FaceDetectionStepProcessor,
    private readonly personDetectionStepProcessor: PersonDetectionStepProcessor,
    private readonly speechTranscriptionStepProcessor: SpeechTranscriptionStepProcessor
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

    // Skip dependency reference jobs (they don't have stepType in data)
    // These are created by BullMQ for dependency tracking but shouldn't be processed
    const stepData = job.data as StepJobData;
    if (!stepData.stepType) {
      this.logger.debug(
        `Skipping job ${job.id} with name ${job.name} - no stepType (dependency reference job)`
      );
      return { skipped: true, reason: 'dependency_reference' };
    }

    // Handle step jobs
    return this.processStepJob(job as Job<StepJobData>);
  }

  /**
   * Process parent job - orchestrates child steps and aggregates results
   *
   * Detect labels tasks allow partial success:
   * - Task succeeds if at least one enabled processor completes successfully
   * - Task fails only if all enabled processors fail
   * - Disabled processors are skipped and don't affect success/failure
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

    // Check which new processors succeeded
    const labelDetectionResult =
      aggregatedResults[DetectLabelsStepType.LABEL_DETECTION];
    const objectTrackingResult =
      aggregatedResults[DetectLabelsStepType.OBJECT_TRACKING];
    const faceDetectionResult =
      aggregatedResults[DetectLabelsStepType.FACE_DETECTION];
    const personDetectionResult =
      aggregatedResults[DetectLabelsStepType.PERSON_DETECTION];
    const speechTranscriptionResult =
      aggregatedResults[DetectLabelsStepType.SPEECH_TRANSCRIPTION];

    // Check which legacy processors succeeded (for backward compatibility)
    const videoIntelligenceResult =
      aggregatedResults[DetectLabelsStepType.VIDEO_INTELLIGENCE];
    const speechToTextResult =
      aggregatedResults[DetectLabelsStepType.SPEECH_TO_TEXT];
    const processVideoLabelsResult =
      aggregatedResults[DetectLabelsStepType.PROCESS_VIDEO_INTELLIGENCE_LABELS];
    const processSpeechLabelsResult =
      aggregatedResults[DetectLabelsStepType.PROCESS_SPEECH_TO_TEXT_LABELS];

    // Determine which processors succeeded
    const successfulProcessors: string[] = [];
    const failedProcessors: string[] = [];

    // Check new processors
    if (this.processorsConfigService.enableLabelDetection) {
      if (labelDetectionResult?.status === 'completed') {
        successfulProcessors.push('LABEL_DETECTION');
      } else if (labelDetectionResult) {
        failedProcessors.push('LABEL_DETECTION');
      }
    }

    if (this.processorsConfigService.enableObjectTracking) {
      if (objectTrackingResult?.status === 'completed') {
        successfulProcessors.push('OBJECT_TRACKING');
      } else if (objectTrackingResult) {
        failedProcessors.push('OBJECT_TRACKING');
      }
    }

    if (this.processorsConfigService.enableFaceDetection) {
      if (faceDetectionResult?.status === 'completed') {
        successfulProcessors.push('FACE_DETECTION');
      } else if (faceDetectionResult) {
        failedProcessors.push('FACE_DETECTION');
      }
    }

    if (this.processorsConfigService.enablePersonDetection) {
      if (personDetectionResult?.status === 'completed') {
        successfulProcessors.push('PERSON_DETECTION');
      } else if (personDetectionResult) {
        failedProcessors.push('PERSON_DETECTION');
      }
    }

    if (this.processorsConfigService.enableSpeechTranscription) {
      if (speechTranscriptionResult?.status === 'completed') {
        successfulProcessors.push('SPEECH_TRANSCRIPTION');
      } else if (speechTranscriptionResult) {
        failedProcessors.push('SPEECH_TRANSCRIPTION');
      }
    }

    // Check legacy processors (for backward compatibility)
    const videoBranchSucceeded =
      videoIntelligenceResult?.status === 'completed' &&
      processVideoLabelsResult?.status === 'completed';
    const speechBranchSucceeded =
      speechToTextResult?.status === 'completed' &&
      processSpeechLabelsResult?.status === 'completed';

    if (videoBranchSucceeded) {
      successfulProcessors.push('VIDEO_INTELLIGENCE (legacy)');
    }
    if (speechBranchSucceeded) {
      successfulProcessors.push('SPEECH_TO_TEXT (legacy)');
    }

    // Log results
    this.logger.log(`Detect labels results for task ${task.id}:`, {
      successful: successfulProcessors,
      failed: failedProcessors,
    });

    // Determine overall task status
    // Task succeeds if at least one processor succeeded
    if (successfulProcessors.length === 0) {
      // All enabled processors failed
      this.logger.error(
        `Task ${task.id} failed: all enabled processors failed`,
        {
          failedProcessors,
        }
      );
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error(
        `Detect labels task failed: all enabled processors failed (${failedProcessors.join(', ')})`
      );
    }

    // Task succeeded with at least one processor
    if (failedProcessors.length === 0) {
      this.logger.log(
        `Task ${task.id} completed successfully with all processors`,
        {
          successfulProcessors,
        }
      );
    } else {
      this.logger.log(
        `Task ${task.id} completed successfully with partial results`,
        {
          successfulProcessors,
          failedProcessors,
        }
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
        case DetectLabelsStepType.UPLOAD_TO_GCS:
          output = await this.uploadToGcsStepProcessor.process(
            input as UploadToGcsStepInput,
            job
          );
          break;

        // New GCVI processors
        case DetectLabelsStepType.LABEL_DETECTION:
          output = await this.labelDetectionStepProcessor.process(
            input as LabelDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.OBJECT_TRACKING:
          output = await this.objectTrackingStepProcessor.process(
            input as ObjectTrackingStepInput,
            job
          );
          break;

        case DetectLabelsStepType.FACE_DETECTION:
          output = await this.faceDetectionStepProcessor.process(
            input as FaceDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.PERSON_DETECTION:
          output = await this.personDetectionStepProcessor.process(
            input as PersonDetectionStepInput,
            job
          );
          break;

        case DetectLabelsStepType.SPEECH_TRANSCRIPTION:
          output = await this.speechTranscriptionStepProcessor.process(
            input as SpeechTranscriptionStepInput,
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

      // For detect labels tasks, we allow partial success
      // Don't re-throw for new GCVI processor failures
      // Let the parent job handle the partial success logic
      if (
        stepType === DetectLabelsStepType.LABEL_DETECTION ||
        stepType === DetectLabelsStepType.OBJECT_TRACKING ||
        stepType === DetectLabelsStepType.FACE_DETECTION ||
        stepType === DetectLabelsStepType.PERSON_DETECTION ||
        stepType === DetectLabelsStepType.SPEECH_TRANSCRIPTION ||
        // Legacy processors
        stepType === DetectLabelsStepType.VIDEO_INTELLIGENCE ||
        stepType === DetectLabelsStepType.SPEECH_TO_TEXT
      ) {
        this.logger.warn(
          `Step ${stepType} failed but allowing partial success`
        );
        return result;
      }

      // For processing steps, re-throw to let BullMQ handle retry logic
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

        // For detect labels tasks, only mark as failed if it's a critical step
        // New GCVI processor failures are allowed (partial success)
        // Processing steps failures should mark task as failed
        if (
          stepType === DetectLabelsStepType.PROCESS_VIDEO_INTELLIGENCE_LABELS ||
          stepType === DetectLabelsStepType.PROCESS_SPEECH_TO_TEXT_LABELS
        ) {
          if (parentJobId) {
            try {
              await this.updateTaskStatus(taskId, TaskStatus.FAILED);
              this.logger.log(
                `Marked task ${taskId} as failed due to ${stepType} retry exhaustion`
              );
            } catch (updateError) {
              this.logger.error(`Failed to update task status: ${updateError}`);
            }
          }
        } else {
          this.logger.warn(
            `Step ${stepType} exhausted retries but allowing partial success for detect labels task ${taskId}`
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
          `Parent job ${parentJobId} not found for step ${stepType}`
        );
        return;
      }

      // Update parent job progress with current step information
      await parentJob.updateProgress({
        currentStep: stepType,
        currentStepProgress: typeof progress === 'number' ? progress : 0,
      });

      this.logger.debug(
        `Updated parent job ${parentJobId} with step ${stepType} progress`
      );
    } catch (error) {
      this.logger.warn(`Failed to update parent progress: ${error}`);
    }
  }
}
