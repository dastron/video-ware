import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService, ProbeResult } from '../../shared/services/ffmpeg.service';
import { StorageService } from '../../shared/services/storage.service';
import type { ProcessUploadPayload, ProbeOutput } from '@project/shared';

export interface TranscodeStrategyResult {
  thumbnailPath?: string;
  spritePath?: string;
  proxyPath?: string;
  probeOutput: ProbeOutput;
}

@Injectable()
export class FFmpegStrategy {
  private readonly logger = new Logger(FFmpegStrategy.name);

  constructor(
    private readonly ffmpegService: FFmpegService,
    private readonly storageService: StorageService
  ) {}

  async process(
    filePath: string,
    payload: ProcessUploadPayload,
    progressCallback: (progress: number) => void
  ): Promise<TranscodeStrategyResult> {
    this.logger.log(`Processing file with FFmpeg: ${filePath}`);

    const result: TranscodeStrategyResult = {
      probeOutput: {} as ProbeOutput, // Will be set below
    };

    try {
      // Probe the file for metadata
      progressCallback(10);
      const probeResult = await this.ffmpegService.probe(filePath);
      result.probeOutput = this.convertProbeResult(probeResult);

      // Generate thumbnail if config provided
      if (payload.thumbnail) {
        progressCallback(30);
        const thumbnailPath = `${filePath}_thumbnail.jpg`;

        // Calculate timestamp - handle "midpoint" or use provided number
        let timestamp: number;
        if (payload.thumbnail.timestamp === 'midpoint') {
          timestamp = result.probeOutput.duration / 2;
        } else {
          timestamp = payload.thumbnail.timestamp;
        }
        // Ensure timestamp is within video duration
        timestamp = Math.min(timestamp, result.probeOutput.duration - 1);
        timestamp = Math.max(timestamp, 0);

        await this.ffmpegService.generateThumbnail(
          filePath,
          thumbnailPath,
          timestamp,
          payload.thumbnail.width || 320,
          payload.thumbnail.height || 240
        );
        result.thumbnailPath = thumbnailPath;
      }

      // Generate sprite if config provided
      if (payload.sprite) {
        progressCallback(50);
        const spritePath = `${filePath}_sprite.jpg`;
        await this.ffmpegService.generateSprite(
          filePath,
          spritePath,
          payload.sprite.fps || 1,
          payload.sprite.cols || 10,
          payload.sprite.rows || 10,
          payload.sprite.tileWidth || 160,
          payload.sprite.tileHeight || 120
        );
        result.spritePath = spritePath;
      }

      // Generate proxy video if enabled
      if (payload.transcode?.enabled) {
        progressCallback(70);
        const proxyPath = `${filePath}_proxy.mp4`;

        // Map resolution to width/height
        const resolutionMap: Record<string, { width: number; height: number }> =
          {
            '720p': { width: 1280, height: 720 },
            '1080p': { width: 1920, height: 1080 },
            original: {
              width: result.probeOutput.width,
              height: result.probeOutput.height,
            },
          };

        const targetResolution =
          resolutionMap[payload.transcode.resolution] || resolutionMap['720p'];

        // Map codec to video codec string
        const codecMap: Record<string, string> = {
          h264: 'libx264',
          h265: 'libx265',
          vp9: 'libvpx-vp9',
        };

        const videoCodec = codecMap[payload.transcode.codec] || 'libx264';

        // Map bitrate (it's in bits per second, convert to string format)
        const bitrateString = payload.transcode.bitrate
          ? `${Math.round(payload.transcode.bitrate / 1000000)}M`
          : '2M';

        await this.ffmpegService.transcode(filePath, proxyPath, {
          width: targetResolution.width,
          height: targetResolution.height,
          videoCodec,
          videoBitrate: bitrateString,
          audioBitrate: '128k',
        });
        result.proxyPath = proxyPath;
      }

      progressCallback(90);
      this.logger.log(`FFmpeg processing completed for: ${filePath}`);

      return result;
    } catch (error) {
      this.logger.error(`FFmpeg processing failed for ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Convert FFmpeg probe result to our ProbeOutput format
   */
  private convertProbeResult(probeResult: ProbeResult): ProbeOutput {
    const videoStream = probeResult.streams.find(
      (s) => s.codec_type === 'video'
    );
    const audioStream = probeResult.streams.find(
      (s) => s.codec_type === 'audio'
    );

    if (!videoStream) {
      throw new Error('No video stream found in input file');
    }

    const probeOutput: ProbeOutput = {
      duration: probeResult.format.duration || 0,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      codec: videoStream.codec_name || 'unknown',
      fps: this.parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) || 0,
      bitrate: probeResult.format.bit_rate || undefined,
      format: probeResult.format.format_name || 'unknown',
      size: probeResult.format.size || undefined,
      video: {
        codec: videoStream.codec_name || 'unknown',
        profile: videoStream.profile || undefined,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        aspectRatio: videoStream.display_aspect_ratio || undefined,
        pixFmt: videoStream.pix_fmt || undefined,
        level: videoStream.level?.toString() || undefined,
        colorSpace: videoStream.color_space || undefined,
      },
    };

    // Add audio information if available
    if (audioStream) {
      probeOutput.audio = {
        codec: audioStream.codec_name || 'unknown',
        channels: audioStream.channels || 0,
        sampleRate: audioStream.sample_rate || 0,
        bitrate: audioStream.bit_rate || undefined,
      };
    }

    return probeOutput;
  }

  /**
   * Parse frame rate from FFmpeg format (e.g., "30/1" -> 30)
   */
  private parseFps(fpsString?: string): number {
    if (!fpsString) return 0;

    const parts = fpsString.split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      return denominator !== 0 ? numerator / denominator : 0;
    }

    return parseFloat(fpsString) || 0;
  }
}
