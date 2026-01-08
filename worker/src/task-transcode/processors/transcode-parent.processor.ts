import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { TranscodeStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { BaseParentProcessor } from '../../queue/processors/base-parent.processor';
import { ProbeStepProcessor } from './probe-step.processor';
import { ThumbnailStepProcessor } from './thumbnail-step.processor';
import { SpriteStepProcessor } from './sprite-step.processor';
import { TranscodeStepProcessor } from './transcode-step.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
import type {
  ProbeStepInput,
  ThumbnailStepInput,
  SpriteStepInput,
  TranscodeStepInput,
} from './step-types';
import { TaskStatus } from '@project/shared';

/**
 * Parent processor for transcode tasks
 * Orchestrates independent step processors that write directly to the database
 */
@Processor(QUEUE_NAMES.TRANSCODE)
export class TranscodeParentProcessor extends BaseParentProcessor {
  protected readonly logger = new Logger(TranscodeParentProcessor.name);

  constructor(
    protected readonly pocketbaseService: PocketBaseService,
    private readonly probeStepProcessor: ProbeStepProcessor,
    private readonly thumbnailStepProcessor: ThumbnailStepProcessor,
    private readonly spriteStepProcessor: SpriteStepProcessor,
    private readonly transcodeStepProcessor: TranscodeStepProcessor
  ) {
    super();
  }

  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { task } = job.data;

    this.logger.log(`Processing parent job for task ${task.id}`);
    await this.updateTaskStatus(task.id, TaskStatus.RUNNING);

    // Wait for all children to complete
    const childrenValues = await job.getChildrenValues();

    this.logger.log(
      `All ${Object.keys(childrenValues).length} children completed for task ${task.id}`
    );

    // Check if any steps failed
    const failedSteps = Object.values(childrenValues).filter(
      (result: any) => result?.status === 'failed'
    );

    if (failedSteps.length > 0) {
      this.logger.error(
        `Task ${task.id} has ${failedSteps.length} failed steps`
      );
      await this.updateTaskStatus(task.id, TaskStatus.FAILED);
      throw new Error(`Task failed with ${failedSteps.length} failed steps`);
    }

    this.logger.log(`Task ${task.id} completed successfully`);
    await this.updateTaskStatus(task.id, TaskStatus.SUCCESS);
  }

  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const startedAt = new Date();
    const { stepType, input } = job.data;

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    if (!input) {
      throw new Error(`Input is missing for step ${stepType}`);
    }

    try {
      let output: unknown;

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

        default:
          throw new Error(`Unknown step type: ${stepType}`);
      }

      this.logger.log(`Step ${stepType} completed successfully`);

      return {
        stepType,
        status: 'completed',
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Step ${stepType} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined
      );

      throw error;
    }
  }

}
