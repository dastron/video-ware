import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type {
  IThumbnailExecutor,
  ThumbnailConfig,
  ThumbnailResult,
} from '../interfaces';

/**
 * FFmpeg implementation of the Thumbnail Executor
 * Generates thumbnail images using FFmpeg
 */
@Injectable()
export class FFmpegThumbnailExecutor implements IThumbnailExecutor {
  private readonly logger = new Logger(FFmpegThumbnailExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: ThumbnailConfig,
    duration: number
  ): Promise<ThumbnailResult> {
    const timestamp = this.calculateTimestamp(config.timestamp, duration);

    this.logger.debug(`Generating thumbnail at ${timestamp}s: ${outputPath}`);

    await this.ffmpegService.generateThumbnail(
      filePath,
      outputPath,
      timestamp,
      config.width,
      config.height
    );

    return { outputPath };
  }

  private calculateTimestamp(
    timestamp: number | 'midpoint',
    duration: number
  ): number {
    let calculated = timestamp === 'midpoint' ? duration / 2 : timestamp;
    calculated = Math.max(0, Math.min(calculated, duration - 1));
    return calculated;
  }
}
