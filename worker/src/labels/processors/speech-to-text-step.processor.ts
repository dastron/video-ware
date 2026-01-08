import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  SpeechToTextStepInput,
  SpeechToTextStepOutput,
} from '../types/step-inputs';
import type { SpeechToTextResponse } from '../types/normalizer';

/**
 * Processor for SPEECH_TO_TEXT step in detect_labels flow
 * Transcribes audio from video using Google Speech-to-Text API
 * Implements cache-aware processing to avoid redundant API calls
 */
@Injectable()
export class SpeechToTextStepProcessor extends BaseStepProcessor<
  SpeechToTextStepInput,
  SpeechToTextStepOutput
> {
  protected readonly logger = new Logger(SpeechToTextStepProcessor.name);
  private readonly processorVersion = 'speech-to-text:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly googleCloudService: GoogleCloudService,
  ) {
    super();
  }

  /**
   * Process speech-to-text transcription with cache awareness
   * Checks cache before making API call, stores raw JSON on success
   */
  async process(
    input: SpeechToTextStepInput,
    job: Job<StepJobData>,
  ): Promise<SpeechToTextStepOutput> {
    this.logger.log(
      `Processing speech-to-text for media ${input.mediaId}, version ${input.version}`,
    );


    try {
      // Check cache before API call
      const cached = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_SPEECH,
      );

      if (cached && this.labelCacheService.isCacheValid(cached, this.processorVersion)) {
        this.logger.log(
          `Using cached speech-to-text for media ${input.mediaId}, version ${input.version}`,
        );

        return {
          response: cached.response as SpeechToTextResponse,
          rawJsonPath: input.cacheKey,
          usedCache: true,
          processor: this.processorVersion,
        };
      }

      // Cache miss or invalid - make API call
      this.logger.log(
        `Cache miss or invalid for media ${input.mediaId}, calling Speech-to-Text API`,
      );


      // Ensure file path is a GCS URI (required by Google Speech-to-Text API)
      const gcsUri = this.ensureGcsUri(input.gcsUri);


      this.logger.log(`Calling Speech-to-Text API for ${gcsUri}`);

      // Call Google Speech-to-Text API
      const response = await this.googleCloudService.transcribeAudio(gcsUri);


      // Store raw JSON to cache
      await this.labelCacheService.storeLabelCache(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_SPEECH,
        response,
        this.processorVersion,
        ['SPEECH_RECOGNITION'],
      );


      this.logger.log(
        `Speech-to-text completed for media ${input.mediaId}, stored to cache`,
      );


      return {
        response: response as SpeechToTextResponse,
        rawJsonPath: input.cacheKey,
        usedCache: false,
        processor: this.processorVersion,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speech-to-text failed for media ${input.mediaId}: ${errorMessage}`,
      );
      throw new Error(`Speech-to-text transcription failed: ${errorMessage}`);
    }
  }

  /**
   * Ensure file path is a GCS URI
   * Google Speech-to-Text API requires gs:// URIs
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
        'Speech-to-Text requires GCS URI (gs://). ' +
          'File must be uploaded to Google Cloud Storage before transcription.',
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
