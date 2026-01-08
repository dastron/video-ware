import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';

/**
 * Step input/output types
 */
export interface UploadToGcsStepInput {
  type: 'upload_to_gcs';
  mediaId: string;
  fileRef: string;
}

export interface UploadToGcsStepOutput {
  gcsUri: string;
  uploaded: boolean;
  alreadyExists: boolean;
}

/**
 * Processor for UPLOAD_TO_GCS step in detect_labels flow
 * Uploads local/S3 files to GCS for use by Video Intelligence and Speech-to-Text APIs
 * Uses deterministic paths so files can be reused across multiple analysis runs
 */
@Injectable()
export class UploadToGcsStepProcessor extends BaseStepProcessor<
  UploadToGcsStepInput,
  UploadToGcsStepOutput
> {
  protected readonly logger = new Logger(UploadToGcsStepProcessor.name);

  constructor(
    private readonly googleCloudService: GoogleCloudService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  /**
   * Upload file to GCS with deterministic path
   * Checks if file already exists to avoid redundant uploads
   */
  async process(
    input: UploadToGcsStepInput,
    job: Job<StepJobData>
  ): Promise<UploadToGcsStepOutput> {
    this.logger.log(`Uploading file to GCS for media ${input.mediaId}`);

    try {
      // If already a GCS URI, return as-is
      if (input.fileRef.startsWith('gs://')) {
        this.logger.log(`File already in GCS: ${input.fileRef}`);
        return {
          gcsUri: input.fileRef,
          uploaded: false,
          alreadyExists: true,
        };
      }

      // Get deterministic GCS path
      const fileName = input.fileRef.split('/').pop() || 'video';
      const expectedGcsUri = await this.googleCloudService.getExpectedGcsUri(
        input.mediaId,
        fileName
      );

      // Check if file already exists in GCS
      const exists =
        await this.googleCloudService.checkGcsFileExists(expectedGcsUri);
      if (exists) {
        this.logger.log(`File already exists in GCS: ${expectedGcsUri}`);
        return {
          gcsUri: expectedGcsUri,
          uploaded: false,
          alreadyExists: true,
        };
      }

      // Resolve local file path (downloads from S3 if needed)
      this.logger.log(`Resolving local file path for: ${input.fileRef}`);
      const localPath = await this.storageService.resolveFilePath({
        storagePath: input.fileRef,
      });

      // Upload to GCS with deterministic path
      this.logger.log(`Uploading local file to GCS: ${localPath}`);
      const gcsUri = await this.googleCloudService.uploadToGcsTempBucket(
        localPath,
        input.mediaId
      );

      this.logger.log(`Successfully uploaded to GCS: ${gcsUri}`);

      return {
        gcsUri,
        uploaded: true,
        alreadyExists: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to upload to GCS for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(`GCS upload failed: ${errorMessage}`);
    }
  }

  /**
   * Get the processor version for this step
   */
  getProcessorVersion(): string {
    return 'upload-to-gcs:1.0.0';
  }
}
