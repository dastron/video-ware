import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegComposeExecutor } from '../executors/ffmpeg/compose.executor';
import { StorageService } from '../../shared/services/storage.service';
import { ProcessingProvider } from '@project/shared';
import {
  TaskRenderExecuteStep,
  TaskRenderExecuteStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import * as path from 'path';

/**
 * Processor for the EXECUTE step in rendering
 * Dispatches to FFmpeg (Google Cloud Transcoder support removed)
 */
@Injectable()
export class ExecuteRenderStepProcessor extends BaseStepProcessor<
  TaskRenderExecuteStep,
  TaskRenderExecuteStepOutput
> {
  protected readonly logger = new Logger(ExecuteRenderStepProcessor.name);

  constructor(
    private readonly ffmpegExecutor: FFmpegComposeExecutor,
    private readonly storageService: StorageService
  ) {
    super();
  }

  async process(
    input: TaskRenderExecuteStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderExecuteStepOutput> {
    const { timelineId, tracks, clipMediaMap, outputSettings } = input;
    const provider = job.data.provider || ProcessingProvider.FFMPEG;

    this.logger.log(
      `Executing render for timeline ${timelineId} using ${provider}`
    );

    if (provider === ProcessingProvider.GOOGLE_TRANSCODER) {
      this.logger.warn(
        'Google Cloud Transcoder is no longer supported for rendering. Falling back to FFmpeg.'
      );
    }

    // Create a temporary directory for local outputs
    const tempDir = await this.storageService.createTempDir(job.data.taskId);
    const localOutputPath = path.join(
      tempDir,
      `timeline_${timelineId}.${outputSettings.format}`
    );

    const executorResult = await this.ffmpegExecutor.execute(
      tracks,
      clipMediaMap,
      localOutputPath,
      outputSettings,
      (progress) => job.updateProgress(progress).catch(() => {})
    );

    // If local, we need to upload it to the final storage destination
    let storagePath: string | undefined;
    if (executorResult.isLocal) {
      this.logger.log(
        `Uploading local render result to storage: ${executorResult.outputPath}`
      );

      // Generate deterministic storage path
      storagePath = await this.storageService.generateDerivedPath({
        workspaceId: job.data.workspaceId,
        recordId: timelineId,
        suffix: `render_${Date.now()}`,
        extension: outputSettings.format,
      });

      await this.storageService.uploadFromPath(
        executorResult.outputPath,
        storagePath
      );
    }

    return {
      outputPath: executorResult.outputPath,
      storagePath: storagePath || executorResult.storagePath,
      isLocal: executorResult.isLocal,
      probeOutput: executorResult.probeOutput,
    };
  }
}
