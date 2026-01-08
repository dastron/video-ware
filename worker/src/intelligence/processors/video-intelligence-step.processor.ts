import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { VideoIntelligenceStrategy } from '../strategies/video-intelligence.strategy';
import { IntelligenceStepType } from '../../queue/types/step.types';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  VideoIntelligenceStepInput,
  VideoIntelligenceOutput,
} from '../types/step-inputs';

/**
 * Processor for VIDEO_INTELLIGENCE step
 * Detects labels, objects, and scene changes in video using Google Video Intelligence API
 */
@Injectable()
export class VideoIntelligenceStepProcessor extends BaseStepProcessor<
  VideoIntelligenceStepInput,
  VideoIntelligenceOutput
> {
  protected readonly logger = new Logger(VideoIntelligenceStepProcessor.name);

  constructor(
    private readonly videoIntelligenceStrategy: VideoIntelligenceStrategy
  ) {
    super();
  }

  /**
   * Process video intelligence detection
   * Analyzes video content to detect labels, objects, and scene changes
   */
  async process(
    input: VideoIntelligenceStepInput,
    job: Job<StepJobData>
  ): Promise<VideoIntelligenceOutput> {
    this.logger.log(
      `Processing video intelligence for media ${input.mediaId}, file: ${input.filePath}`
    );

    try {
      // Ensure file path is a GCS URI (required by Google Video Intelligence API)
      const gcsUri = this.ensureGcsUri(input.filePath);

      // Perform video intelligence analysis using the strategy
      const result = await this.videoIntelligenceStrategy.detectLabels(
        gcsUri,
        input.config
      );

      this.logger.log(
        `Video intelligence completed for media ${input.mediaId}: ` +
          `${result.labels.length} labels, ${result.objects.length} objects, ` +
          `${result.sceneChanges.length} scene changes`
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Video intelligence failed for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(`Video intelligence analysis failed: ${errorMessage}`);
    }
  }

  /**
   * Ensure file path is a GCS URI
   * Google Video Intelligence API requires gs:// URIs
   */
  private ensureGcsUri(filePath: string): string {
    // If already a GCS URI, return as-is
    if (filePath.startsWith('gs://')) {
      return filePath;
    }

    // If it's an S3 path or local path, we need to construct a GCS URI
    // This assumes the file has already been uploaded to GCS
    // In practice, the flow should ensure files are in GCS before this step
    if (filePath.includes('s3://') || filePath.startsWith('/')) {
      throw new Error(
        'Video Intelligence requires GCS URI (gs://). ' +
          'File must be uploaded to Google Cloud Storage before analysis.'
      );
    }

    // Assume it's a relative path within the default GCS bucket
    const bucket = process.env.STORAGE_S3_BUCKET || 'default-bucket';
    return `gs://${bucket}/${filePath}`;
  }
}
