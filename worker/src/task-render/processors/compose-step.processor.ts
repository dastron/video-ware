import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  TaskRenderComposeStep,
  TaskRenderComposeStepOutput,
} from '@project/shared/jobs';
// Legacy type aliases for backward compatibility
type ComposeStepInput = TaskRenderComposeStep;
type ComposeOutput = TaskRenderComposeStepOutput;
import { FFmpegComposeExecutor } from '../executors';
import * as path from 'path';

/**
 * Processor for the COMPOSE step
 * Delegates to executor for timeline composition
 */
@Injectable()
export class ComposeStepProcessor extends BaseStepProcessor<
  ComposeStepInput,
  ComposeOutput
> {
  protected readonly logger = new Logger(ComposeStepProcessor.name);

  constructor(
    private readonly composeExecutor: FFmpegComposeExecutor,
    private readonly storageService: StorageService
  ) {
    super();
  }

  async process(
    input: ComposeStepInput,
    job: Job<StepJobData>
  ): Promise<ComposeOutput> {
    const { timelineId, editList, clipMediaMap, outputSettings } = input;

    this.logger.log(
      `Composing timeline ${timelineId} with ${editList.length} segments`
    );

    // Create temporary directory for output
    const tempDir = await this.storageService.createTempDir(job.data.taskId);
    const outputPath = path.join(
      tempDir,
      `timeline_${timelineId}.${outputSettings.format}`
    );

    // Delegate to executor with progress callback
    const result = await this.composeExecutor.execute(
      editList,
      clipMediaMap,
      outputPath,
      outputSettings,
      (progress) => {
        // Report progress to job
        job.updateProgress(progress).catch(() => {
          // Ignore progress update errors
        });
      }
    );

    this.logger.log(`Timeline composition completed: ${outputPath}`);
    return result;
  }
}
