import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { GoogleVideoIntelligenceExecutor } from '../executors';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { VideoIntelligenceResponse } from '../executors/interfaces';

/**
 * Step input/output types
 */
export interface VideoIntelligenceStepInput {
  type: 'video_intelligence';
  mediaId: string;
  fileRef: string;
  gcsUri: string;
  provider: ProcessingProvider;
  config: {
    detectLabels?: boolean;
    detectObjects?: boolean;
    detectShots?: boolean;
    detectPersons?: boolean;
    confidenceThreshold?: number;
  };
  cacheKey: string;
  version: number;
  processor: string;
}

export interface VideoIntelligenceStepOutput {
  response: VideoIntelligenceResponse;
  rawJsonPath: string;
  usedCache: boolean;
  processor: string;
}

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
    private readonly videoIntelligenceExecutor: GoogleVideoIntelligenceExecutor,
    private readonly googleCloudService: GoogleCloudService,
    private readonly storageService: StorageService,
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

    let uploadedGcsUri: string | null = null;

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

      // Resolve the file path and upload to GCS if needed
      const gcsUri = await this.resolveAndUploadToGcs(input.fileRef, input.mediaId);
      uploadedGcsUri = gcsUri;

      // Execute video intelligence analysis via executor
      const result = await this.videoIntelligenceExecutor.execute(gcsUri, {
        detectLabels: input.config.detectLabels !== false,
        detectObjects: input.config.detectObjects !== false,
        detectShots: input.config.detectShots !== false,
        detectPersons: input.config.detectPersons !== false,
        confidenceThreshold: input.config.confidenceThreshold,
      });

      const { response, features } = result;

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
    } finally {
      // Clean up temporary GCS file if we uploaded one
      if (uploadedGcsUri) {
        await this.googleCloudService.deleteFromGcsTempBucket(uploadedGcsUri);
      }
    }
  }

  /**
   * Resolve file path and upload to GCS if needed
   * Returns GCS URI (gs://bucket/path)
   */
  private async resolveAndUploadToGcs(
    fileRef: string,
    mediaId: string
  ): Promise<string> {
    // If already a GCS URI, return as-is
    if (fileRef.startsWith('gs://')) {
      this.logger.log(`File already in GCS: ${fileRef}`);
      return fileRef;
    }

    // For local or S3 files, we need to upload to GCS
    this.logger.log(`Resolving local file path for: ${fileRef}`);
    
    // Get local file path (downloads from S3 if needed)
    const localPath = await this.storageService.resolveFilePath({
      storagePath: fileRef,
    });

    this.logger.log(`Uploading local file to GCS: ${localPath}`);
    
    // Upload to GCS temp bucket
    const gcsUri = await this.googleCloudService.uploadToGcsTempBucket(
      localPath,
      mediaId
    );

    return gcsUri;
  }

  /**
   * Ensure file path is a GCS URI
   * Google Video Intelligence API requires gs:// URIs
   * @deprecated Use resolveAndUploadToGcs instead
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
