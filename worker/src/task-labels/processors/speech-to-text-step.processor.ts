import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { GoogleSpeechToTextExecutor } from '../executors';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeechToTextResponse } from '../executors/interfaces';

/**
 * Step input/output types
 */
export interface SpeechToTextStepInput {
  type: 'speech_to_text';
  mediaId: string;
  fileRef: string;
  gcsUri: string;
  provider: ProcessingProvider;
  cacheKey: string;
  version: number;
  processor: string;
}

export interface SpeechToTextStepOutput {
  response: SpeechToTextResponse;
  rawJsonPath: string;
  usedCache: boolean;
  processor: string;
}

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
    private readonly speechToTextExecutor: GoogleSpeechToTextExecutor,
    private readonly googleCloudService: GoogleCloudService,
    private readonly storageService: StorageService,
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

    let uploadedGcsUri: string | null = null;

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

      // Resolve the file path and upload to GCS if needed
      const gcsUri = await this.resolveAndUploadToGcs(input.fileRef, input.mediaId);
      uploadedGcsUri = gcsUri;

      // Execute speech-to-text transcription via executor
      const result = await this.speechToTextExecutor.execute(gcsUri);
      const { response } = result;

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
   * Google Speech-to-Text API requires gs:// URIs
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
