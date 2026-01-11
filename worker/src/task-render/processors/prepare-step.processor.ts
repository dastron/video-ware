import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegResolveClipsExecutor } from '../executors/ffmpeg/resolve-clips.executor';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { ProcessingProvider } from '@project/shared';
import {
  TaskRenderPrepareStep,
  TaskRenderPrepareStepOutput,
} from '@project/shared/jobs';
import type { StepJobData } from '../../queue/types/job.types';

/**
 * Processor for the PREPARE step in rendering
 * Resolves media file paths and prepares them for the selected provider
 */
@Injectable()
export class PrepareRenderStepProcessor extends BaseStepProcessor<
  TaskRenderPrepareStep,
  TaskRenderPrepareStepOutput
> {
  protected readonly logger = new Logger(PrepareRenderStepProcessor.name);

  constructor(
    private readonly resolveClipsExecutor: FFmpegResolveClipsExecutor,
    private readonly googleCloudService: GoogleCloudService
  ) {
    super();
  }

  async process(
    input: TaskRenderPrepareStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderPrepareStepOutput> {
    const { timelineId, tracks } = input;
    this.logger.log(`Preparing media for timeline ${timelineId}`);

    // 1. Resolve media clips to local paths (standard logic)
    const { clipMediaMap } = await this.resolveClipsExecutor.execute(
      timelineId,
      tracks
    );

    // 2. If using Google Cloud Transcoder, ensure all files are in GCS
    const provider = job.data.provider || ProcessingProvider.FFMPEG;

    if (provider === ProcessingProvider.GOOGLE_TRANSCODER) {
      this.logger.log(
        `Ensuring media files are available in GCS for Google Cloud Transcoder`
      );

      for (const [mediaId, clipMedia] of Object.entries(clipMediaMap)) {
        if (clipMedia.filePath.startsWith('gs://')) {
          continue; // Already in GCS
        }

        this.logger.log(`Uploading media ${mediaId} to GCS temp bucket`);
        const gcsUri = await this.googleCloudService.uploadToGcsTempBucket(
          clipMedia.filePath,
          job.data.workspaceId,
          mediaId
        );

        // Update the map with GCS URI
        clipMediaMap[mediaId].filePath = gcsUri;
      }
    }

    return { clipMediaMap };
  }
}
