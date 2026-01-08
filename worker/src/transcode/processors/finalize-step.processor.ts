import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { FinalizeStepInput } from '../types/step-inputs';
import type { FinalizeStepOutput } from '../types';
import type { StepJobData } from '../../queue/types/job.types';
import {
  FileType,
  FileSource,
  MediaType,
  type MediaInput,
  type ProcessUploadResult,
} from '@project/shared';
import * as path from 'path';

/**
 * Processor for the FINALIZE step
 * Creates File and Media records in PocketBase with references to all generated files
 */
@Injectable()
export class FinalizeStepProcessor extends BaseStepProcessor<
  FinalizeStepInput,
  FinalizeStepOutput
> {
  protected readonly logger = new Logger(FinalizeStepProcessor.name);

  constructor(private readonly pocketbaseService: PocketBaseService) {
    super();
  }

  /**
   * Process the FINALIZE step
   * Creates File records for all generated assets and a Media record linking them
   */
  async process(
    input: FinalizeStepInput,
    job: Job<StepJobData>
  ): Promise<FinalizeStepOutput> {
    this.logger.log(
      `Finalizing upload ${input.uploadId} - creating File and Media records`
    );

    await this.updateProgress(job, 10);

    // Get the upload record to retrieve workspace info
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    await this.updateProgress(job, 20);

    const result: ProcessUploadResult = {
      mediaId: '',
      probeOutput: input.probeOutput,
    };

    // Create File record for thumbnail if provided
    if (input.thumbnailPath) {
      await this.updateProgress(job, 30);
      const thumbnailFile = await this.createFileRecord(
        input.thumbnailPath,
        FileType.THUMBNAIL,
        upload.WorkspaceRef,
        input.uploadId,
        'image/jpeg'
      );
      result.thumbnailFileId = thumbnailFile.id;
      this.logger.log(`Created thumbnail file record: ${thumbnailFile.id}`);
    }

    // Create File record for sprite if provided
    if (input.spritePath) {
      await this.updateProgress(job, 50);
      const spriteFile = await this.createFileRecord(
        input.spritePath,
        FileType.SPRITE,
        upload.WorkspaceRef,
        input.uploadId,
        'image/jpeg'
      );
      result.spriteFileId = spriteFile.id;
      this.logger.log(`Created sprite file record: ${spriteFile.id}`);
    }

    // Create File record for proxy if provided
    if (input.proxyPath) {
      await this.updateProgress(job, 70);
      const proxyFile = await this.createFileRecord(
        input.proxyPath,
        FileType.PROXY,
        upload.WorkspaceRef,
        input.uploadId,
        'video/mp4'
      );
      result.proxyFileId = proxyFile.id;
      this.logger.log(`Created proxy file record: ${proxyFile.id}`);
    }

    await this.updateProgress(job, 85);

    // Create Media record
    const mediaData: MediaInput = {
      WorkspaceRef: upload.WorkspaceRef,
      UploadRef: input.uploadId,
      mediaType: this.determineMediaType(input.probeOutput),
      duration: input.probeOutput.duration,
      mediaData: input.probeOutput,
      thumbnailFileRef: result.thumbnailFileId,
      spriteFileRef: result.spriteFileId,
      proxyFileRef: result.proxyFileId,
      version: 1,
    };

    const media = await this.pocketbaseService.createMedia(mediaData);
    result.mediaId = media.id;

    await this.updateProgress(job, 100);

    this.logger.log(
      `Finalize completed for upload ${input.uploadId}: Media record ${media.id} created`
    );

    return { result };
  }

  /**
   * Create a File record in PocketBase
   */
  private async createFileRecord(
    localFilePath: string,
    fileType: FileType,
    workspaceRef: string,
    uploadRef: string,
    mimeType: string
  ) {
    const fileName = path.basename(localFilePath);
    const storageKey = `uploads/${uploadRef}/${fileType}/${fileName}`;

    return await this.pocketbaseService.createFileWithUpload({
      localFilePath,
      fileName,
      fileType,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef,
      uploadRef,
      mimeType,
    });
  }

  /**
   * Determine media type from probe output
   */
  private determineMediaType(probeOutput: any): MediaType {
    // Check if there's video stream data
    if (probeOutput.video && probeOutput.width > 0 && probeOutput.height > 0) {
      return MediaType.VIDEO;
    }

    // Check if there's only audio
    if (probeOutput.audio && !probeOutput.video) {
      return MediaType.AUDIO;
    }

    // Default to video
    return MediaType.VIDEO;
  }
}
