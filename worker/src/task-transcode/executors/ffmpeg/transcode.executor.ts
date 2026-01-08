import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type {
  ITranscodeExecutor,
  TranscodeConfig,
  TranscodeResult,
  ProgressCallback,
} from '../interfaces';

/**
 * FFmpeg implementation of the Transcode Executor
 * Transcodes video files using FFmpeg
 */
@Injectable()
export class FFmpegTranscodeExecutor implements ITranscodeExecutor {
  private readonly logger = new Logger(FFmpegTranscodeExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    filePath: string,
    outputPath: string,
    config: TranscodeConfig,
    onProgress?: ProgressCallback
  ): Promise<TranscodeResult> {
    this.logger.debug(`Transcoding to ${config.resolution}: ${outputPath}`);

    const { width, height } = this.resolveResolution(config);
    const videoCodec = this.resolveCodec(config.codec);
    const bitrate = this.resolveBitrate(config.bitrate);

    await this.ffmpegService.transcode(
      filePath,
      outputPath,
      {
        width,
        height,
        videoCodec,
        videoBitrate: bitrate,
        audioBitrate: '128k',
      },
      onProgress
    );

    return { outputPath };
  }

  private resolveResolution(config: TranscodeConfig): {
    width: number;
    height: number;
  } {
    const resolutions: Record<string, { width: number; height: number }> = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
    };

    if (config.resolution === 'original') {
      return { width: config.sourceWidth, height: config.sourceHeight };
    }

    return resolutions[config.resolution] || resolutions['720p'];
  }

  private resolveCodec(codec: string): string {
    const codecs: Record<string, string> = {
      h264: 'libx264',
      h265: 'libx265',
      vp9: 'libvpx-vp9',
    };
    return codecs[codec] || 'libx264';
  }

  private resolveBitrate(bitrate?: number): string {
    if (!bitrate) return '2M';
    return `${Math.round(bitrate / 1000000)}M`;
  }
}
