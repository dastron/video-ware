import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  VideoIntelligenceStepInput,
  VideoIntelligenceStepOutput,
} from '../types/step-inputs';
import type { VideoIntelligenceResponse } from '../types/normalizer';

/**
 * Processor for VIDEO_INTELLIGENCE step in detect_labels flow
 * Detects labels, objects, shots, and persons in video using Google Video Intelligence API
 * Implements cache-aware processing to avoid redundant API calls
 */
@Injectable()
export class VideoIntelligenceStepProcessor extends BaseStepProcessor<
  VideoIntelligenceStepInput,
  VideoIntelligenceStepOutput
> {
  protected readonly logger = new Logger(
    VideoIntelligenceStepProcessor.name,
  );
  private readonly processorVersion = 'video-intelligence:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly googleCloudService: GoogleCloudService,
  ) {
    super();
  }

  /**
   * Process video intelligence detection with cache awareness
   * Checks cache before making API call, stores raw JSON on success
   */
  async process(
    input: VideoIntelligenceStepInput,
    job: Job<StepJobData>,
  ): Promise<VideoIntelligenceStepOutput> {
    this.logger.log(
      `Processing video intelligence for media ${input.mediaId}, version ${input.version}`,
    );

    try {
      // Check cache before API call
      const cached = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      );

      if (cached && this.labelCacheService.isCacheValid(cached, this.processorVersion)) {
        this.logger.log(
          `Using cached video intelligence for media ${input.mediaId}, version ${input.version}`,
        );


        return {
          response: cached.response as VideoIntelligenceResponse,
          rawJsonPath: input.cacheKey,
          usedCache: true,
          processor: this.processorVersion,
        };
      }

      // Cache miss or invalid - make API call
      this.logger.log(
        `Cache miss or invalid for media ${input.mediaId}, calling Video Intelligence API`,
      );


      // Ensure file path is a GCS URI (required by Google Video Intelligence API)
      const gcsUri = this.ensureGcsUri(input.gcsUri);


      // Build features array based on config
      const features: string[] = [];
      if (input.config.detectLabels !== false) {
        features.push('LABEL_DETECTION');
      }
      if (input.config.detectObjects !== false) {
        features.push('OBJECT_TRACKING');
      }
      if (input.config.detectShots !== false) {
        features.push('SHOT_CHANGE_DETECTION');
      }
      if (input.config.detectPersons !== false) {
        features.push('PERSON_DETECTION');
      }

      if (features.length === 0) {
        throw new Error('No detection features enabled in config');
      }

      this.logger.log(
        `Calling Video Intelligence API with features: ${features.join(', ')}`,
      );

      // Call Google Video Intelligence API
      const response = await this.googleCloudService.analyzeVideo(
        gcsUri,
        features,
      );


      // Store raw JSON to cache
      await this.labelCacheService.storeLabelCache(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        response,
        this.processorVersion,
        features,
      );


      this.logger.log(
        `Video intelligence completed for media ${input.mediaId}, stored to cache`,
      );


      return {
        response: response as VideoIntelligenceResponse,
        rawJsonPath: input.cacheKey,
        usedCache: false,
        processor: this.processorVersion,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Video intelligence failed for media ${input.mediaId}: ${errorMessage}`,
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
    if (filePath.includes('s3://') || filePath.startsWith('/')) {
      throw new Error(
        'Video Intelligence requires GCS URI (gs://). ' +
          'File must be uploaded to Google Cloud Storage before analysis.',
      );
    }

    // Assume it's a relative path within the default GCS bucket
    const bucket = process.env.GCS_BUCKET || 'default-bucket';
    return `gs://${bucket}/${filePath}`;
  }

  /**
   * Get the processor version for this step
   */
  getProcessorVersion(): string {
    return this.processorVersion;
  }
}
