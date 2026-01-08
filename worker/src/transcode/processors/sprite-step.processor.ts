import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import type { SpriteStepInput } from '../types/step-inputs';
import type { SpriteStepOutput } from '../types';
import type { StepJobData } from '../../queue/types/job.types';

/**
 * Processor for the SPRITE step
 * Generates a sprite sheet from the media file
 */
@Injectable()
export class SpriteStepProcessor extends BaseStepProcessor<
  SpriteStepInput,
  SpriteStepOutput
> {
  protected readonly logger = new Logger(SpriteStepProcessor.name);

  constructor(private readonly ffmpegService: FFmpegService) {
    super();
  }

  /**
   * Process the SPRITE step
   * Generates a sprite sheet with multiple frames from the video
   */
  async process(
    input: SpriteStepInput,
    job: Job<StepJobData>
  ): Promise<SpriteStepOutput> {
    this.logger.log(
      `Generating sprite sheet for upload ${input.uploadId} (${input.config.cols}x${input.config.rows} tiles)`
    );

    await this.updateProgress(job, 10);

    // Generate unique output path
    const spritePath = `${input.filePath}_sprite.jpg`;

    await this.updateProgress(job, 30);

    // Generate sprite sheet using FFmpeg
    await this.ffmpegService.generateSprite(
      input.filePath,
      spritePath,
      input.config.fps,
      input.config.cols,
      input.config.rows,
      input.config.tileWidth,
      input.config.tileHeight
    );

    await this.updateProgress(job, 100);

    this.logger.log(
      `Sprite sheet generated for upload ${input.uploadId}: ${spritePath} (${input.config.cols}x${input.config.rows} tiles, ${input.config.tileWidth}x${input.config.tileHeight} each)`
    );

    return { spritePath };
  }
}
