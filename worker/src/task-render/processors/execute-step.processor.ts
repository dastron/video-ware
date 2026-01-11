import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegComposeExecutor } from '../executors/ffmpeg/compose.executor';
import { GCTranscoderExecutor } from '../executors/google/transcoder.executor';
import { StorageService } from '../../shared/services/storage.service';
import { ProcessingProvider } from '@project/shared';
import {
  TaskRenderExecuteStep,
  TaskRenderExecuteStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';
import * as path from 'path';

import { GoogleCloudService } from '../../shared/services/google-cloud.service';

/**
 * Processor for the EXECUTE step in rendering
 * Dispatches to FFmpeg or Google Cloud Transcoder and handles resulting file upload if local
 */
@Injectable()
export class ExecuteRenderStepProcessor extends BaseStepProcessor<
  TaskRenderExecuteStep,
  TaskRenderExecuteStepOutput
> {
  protected readonly logger = new Logger(ExecuteRenderStepProcessor.name);

  constructor(
    private readonly ffmpegExecutor: FFmpegComposeExecutor,
    private readonly gcTranscoderExecutor: GCTranscoderExecutor,
    private readonly storageService: StorageService,
    private readonly googleCloudService: GoogleCloudService
  ) {
    super();
  }

  async process(
    input: TaskRenderExecuteStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderExecuteStepOutput> {
    const { timelineId, editList, clipMediaMap, outputSettings } = input;
    const provider = job.data.provider || ProcessingProvider.FFMPEG;

    this.logger.log(
      `Executing render for timeline ${timelineId} using ${provider}`
    );

    // Create a temporary directory for local outputs (if needed)
    const tempDir = await this.storageService.createTempDir(job.data.taskId);
    const localOutputPath = path.join(
      tempDir,
      `timeline_${timelineId}.${outputSettings.format}`
    );

    let executorResult;

    if (provider === ProcessingProvider.GOOGLE_TRANSCODER) {
      // For GC, we need a GCS output URI
      const gcsOutputUri = this.generateGcsOutputUri(
        job.data.workspaceId,
        timelineId,
        outputSettings.format
      );

      executorResult = await this.gcTranscoderExecutor.execute(
        editList,
        clipMediaMap,
        gcsOutputUri,
        outputSettings,
        (progress) => job.updateProgress(progress).catch(() => {})
      );
    } else {
      // Default to FFmpeg
      executorResult = await this.ffmpegExecutor.execute(
        editList,
        clipMediaMap,
        localOutputPath,
        outputSettings,
        (progress) => job.updateProgress(progress).catch(() => {})
      );
    }

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

  private generateGcsOutputUri(
    workspaceId: string,
    timelineId: string,
    format: string
  ): string {
    const bucket =
      this.googleCloudService.getGcsBucketName() || 'video-ware-temp';
    return `gs://${bucket}/renders/${workspaceId}/${timelineId}_${Date.now()}/`;
  }
}
