import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as path from 'path';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor, FFmpegSpriteExecutor } from '../executors';
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
    private readonly probeExecutor: FFmpegProbeExecutor,
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

    // Probe for dimensions and duration
    const { probeOutput } = await this.probeExecutor.execute(filePath);

    // Always use configured fps (1 frame per second), but cap at maxFrames
    const maxFrames = 2500;
    const configuredFps = input.config.fps; // Fixed at 1 fps
    const cols = input.config.cols; // Fixed at 10

    // Calculate how many frames we would generate at this interval
    const potentialFrames = Math.floor(probeOutput.duration * configuredFps);

    // Cap at maxFrames - we simply won't generate frames beyond this limit
    const actualFrames = Math.min(potentialFrames, maxFrames);

    // Calculate rows needed for the actual number of frames
    const rows = Math.ceil(actualFrames / cols);

    this.logger.log(
      `Generating ${actualFrames} frames (${cols}x${rows}) at ${configuredFps} fps for ${probeOutput.duration}s video` +
        (potentialFrames > maxFrames
          ? ` (capped from ${potentialFrames} frames)`
          : '')
    );

    // Create enhanced config with source dimensions and calculated rows
    const enhancedConfig = {
      ...input.config,
      sourceWidth: probeOutput.width,
      sourceHeight: probeOutput.height,
      fps: configuredFps, // Always use configured fps
      rows, // Override rows with calculated value
    };

    // Generate sprite
    const spritePath = `${filePath}_sprite.jpg`;
    await this.spriteExecutor.execute(filePath, spritePath, enhancedConfig);

    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Create File record with sprite configuration in meta
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
      meta: {
        spriteConfig: {
          cols: enhancedConfig.cols,
          rows: enhancedConfig.rows,
          fps: enhancedConfig.fps,
          tileWidth: enhancedConfig.tileWidth,
          tileHeight: enhancedConfig.tileHeight,
        },
      },
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
