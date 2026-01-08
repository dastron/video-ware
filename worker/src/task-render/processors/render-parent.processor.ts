import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { RenderStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { BaseParentProcessor } from '../../queue/processors/base-parent.processor';
import { ResolveClipsStepProcessor } from './resolve-clips-step.processor';
import { ComposeStepProcessor } from './compose-step.processor';
import { UploadStepProcessor } from './upload-step.processor';
import { CreateRecordsStepProcessor } from './create-records-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';

/**
 * Parent processor for render tasks
 * Orchestrates child step processors and aggregates results
 */
@Processor(QUEUE_NAMES.RENDER)
export class RenderParentProcessor extends BaseParentProcessor {
  protected readonly logger = new Logger(RenderParentProcessor.name);
  protected readonly pocketbaseService: PocketBaseService;

  constructor(
    @InjectQueue(QUEUE_NAMES.RENDER)
    private readonly renderQueue: Queue,
    pocketbaseService: PocketBaseService,
    private readonly resolveClipsStepProcessor: ResolveClipsStepProcessor,
    private readonly composeStepProcessor: ComposeStepProcessor,
    private readonly uploadStepProcessor: UploadStepProcessor,
    private readonly createRecordsStepProcessor: CreateRecordsStepProcessor
  ) {
    super();
    this.pocketbaseService = pocketbaseService;
  }

  /**
   * Get the queue instance for accessing child jobs
   */
  protected getQueue(): Queue {
    return this.renderQueue;
  }

  /**
   * Get the total number of steps expected for this task
   * Render flow always includes 4 steps: RESOLVE_CLIPS, COMPOSE, UPLOAD, CREATE_RECORDS
   */
  protected getTotalSteps(_parentData: ParentJobData): number {
    // Render flow always includes all 4 steps
    return 4;
  }

  /**
   * Process parent job - orchestrates child steps and aggregates results
   */
  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { task } = job.data;

    this.logger.log(`Processing parent job for task ${task.id}`);

    // Task status is now managed by the base class event handlers
    // No need to manually update here as it will be set by onActive event

    // Wait for all children to complete
    // BullMQ automatically handles this - parent job only completes when all children are done
    const childrenValues = await job.getChildrenValues();

    this.logger.log(`All children completed for task ${task.id}`, {
      childrenCount: Object.keys(childrenValues).length,
    });

    // Check if any steps failed
    const failedSteps = Object.values(childrenValues).filter(
      (result: unknown) =>
        result &&
        typeof result === 'object' &&
        'status' in result &&
        result.status === 'failed'
    );

    if (failedSteps.length > 0) {
      // Base class will handle the task status update on failure
      this.logger.error(
        `Task ${task.id} has ${failedSteps.length} failed steps`
      );
      throw new Error(`Task failed with ${failedSteps.length} failed steps`);
    }

    // Task succeeded - base class will handle the status update on completion
    this.logger.log(`Task ${task.id} completed successfully`);
  }

  /**
   * Process step job - dispatches to appropriate step processor
   */
  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input } = job.data;
    const startedAt = new Date();

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    try {
      let output: unknown;

      // Dispatch to appropriate step processor based on step type
      switch (stepType) {
        case RenderStepType.RESOLVE_CLIPS:
          output = await this.resolveClipsStepProcessor.process(
            input as Parameters<
              typeof this.resolveClipsStepProcessor.process
            >[0],
            job
          );
          break;

        case RenderStepType.COMPOSE:
          output = await this.composeStepProcessor.process(
            input as Parameters<typeof this.composeStepProcessor.process>[0],
            job
          );
          break;

        case RenderStepType.UPLOAD:
          output = await this.uploadStepProcessor.process(
            input as Parameters<typeof this.uploadStepProcessor.process>[0],
            job
          );
          break;

        case RenderStepType.CREATE_RECORDS:
          output = await this.createRecordsStepProcessor.process(
            input as Parameters<
              typeof this.createRecordsStepProcessor.process
            >[0],
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

      // Re-throw to let BullMQ handle retry logic
      // Base class will handle creating failed result on job failure
      throw error;
    }
  }
}
