import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as path from 'path';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegSpriteExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type { SpriteStepInput, SpriteStepOutput } from './step-types';
import type { StepJobData } from '../../queue/types/job.types';
import { FileType, FileSource } from '@project/shared';

/**
 * Processor for the SPRITE step
 * Generates a sprite sheet and creates File record
 */
@Injectable()
export class SpriteStepProcessor extends BaseStepProcessor<
  SpriteStepInput,
  SpriteStepOutput
> {
  protected readonly logger = new Logger(SpriteStepProcessor.name);

  constructor(
    private readonly spriteExecutor: FFmpegSpriteExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(
    input: SpriteStepInput,
    _job: Job<StepJobData>
  ): Promise<SpriteStepOutput> {
    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Generate sprite
    const spritePath = `${filePath}_sprite.jpg`;
    await this.spriteExecutor.execute(filePath, spritePath, input.config);

    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Create File record
    const fileName = path.basename(spritePath);
    const storageKey = `uploads/${input.uploadId}/${FileType.SPRITE}/${fileName}`;

    const spriteFile = await this.pocketbaseService.createFileWithUpload({
      localFilePath: spritePath,
      fileName,
      fileType: FileType.SPRITE,
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
        spriteFileRef: spriteFile.id,
      });
    }

    return { spritePath, spriteFileId: spriteFile.id };
  }
}
