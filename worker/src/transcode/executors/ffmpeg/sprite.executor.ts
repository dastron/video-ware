import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type { ISpriteExecutor, SpriteConfig, SpriteResult } from '../interfaces';

/**
 * FFmpeg implementation of the Sprite Executor
 * Generates sprite sheets using FFmpeg
 */
@Injectable()
export class FFmpegSpriteExecutor implements ISpriteExecutor {
  private readonly logger = new Logger(FFmpegSpriteExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: SpriteConfig
  ): Promise<SpriteResult> {
    this.logger.debug(`Generating sprite sheet: ${outputPath}`);

    await this.ffmpegService.generateSprite(
      filePath,
      outputPath,
      config.fps,
      config.cols,
      config.rows,
      config.tileWidth,
      config.tileHeight
    );

    return { outputPath };
  }
}
