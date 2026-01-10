import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as path from 'path';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor, FFmpegThumbnailExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type { ThumbnailStepInput, ThumbnailStepOutput } from './step-types';
import type { StepJobData } from '../../queue/types/job.types';
import { FileType, FileSource } from '@project/shared';

/**
 * Processor for the THUMBNAIL step
 * Generates a thumbnail image and creates File record
 */
@Injectable()
export class ThumbnailStepProcessor extends BaseStepProcessor<
  ThumbnailStepInput,
  ThumbnailStepOutput
> {
  protected readonly logger = new Logger(ThumbnailStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly thumbnailExecutor: FFmpegThumbnailExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: ThumbnailStepInput,
    _job: Job<StepJobData>
  ): Promise<ThumbnailStepOutput> {
    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    const mediaData = await this.pocketbaseService.getMedia(input.mediaId);

    // Create enhanced config with source dimensions
    const enhancedConfig = {
      ...input.config,
      sourceWidth: mediaData.width,
      sourceHeight: mediaData.height,
    };

    // Generate thumbnail
    const thumbnailPath = `${filePath}_thumbnail.jpg`;
    await this.thumbnailExecutor.execute(
      filePath,
      thumbnailPath,
      enhancedConfig,
      mediaData.duration
    );

    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Create File record
    const fileName = path.basename(thumbnailPath);
    const storageKey = `uploads/${input.uploadId}/${FileType.THUMBNAIL}/${fileName}`;

    const thumbnailFile = await this.pocketbaseService.createFileWithUpload({
      localFilePath: thumbnailPath,
      fileName,
      fileType: FileType.THUMBNAIL,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef: upload.WorkspaceRef,
      uploadRef: input.uploadId,
      mimeType: 'image/jpeg',
    });

    // Update Media record
    const media = await this.pocketbaseService.findMediaByUpload(
      input.uploadId
    );
    if (media) {
      await this.pocketbaseService.updateMedia(media.id, {
        thumbnailFileRef: thumbnailFile.id,
      });
    }

    return { thumbnailPath, thumbnailFileId: thumbnailFile.id };
  }
}
