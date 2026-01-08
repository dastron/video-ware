import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegStrategy } from '../strategies/ffmpeg.strategy';
import { GoogleTranscoderStrategy } from '../strategies/google-transcoder.strategy';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import { FileResolver } from '../utils/file-resolver';
import type { TranscodeStepInput } from '../types/step-inputs';
import type { TranscodeStepOutput } from '../types';
import type { StepJobData } from '../../queue/types/job.types';
import { ProcessingProvider } from '@project/shared';

/**
 * Processor for the TRANSCODE step
 * Creates a proxy/transcoded version of the media file
 * Supports both FFmpeg and Google Transcoder strategies
 */
@Injectable()
export class TranscodeStepProcessor extends BaseStepProcessor<
  TranscodeStepInput,
  TranscodeStepOutput
> {
  protected readonly logger = new Logger(TranscodeStepProcessor.name);

  constructor(
    private readonly ffmpegStrategy: FFmpegStrategy,
    private readonly googleTranscoderStrategy: GoogleTranscoderStrategy,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process the TRANSCODE step
   * Selects the appropriate strategy based on the provider and transcodes the video
   */
  async process(
    input: TranscodeStepInput,
    job: Job<StepJobData>
  ): Promise<TranscodeStepOutput> {
    this.logger.log(
      `Transcoding video for upload ${input.uploadId} using ${input.provider} provider`
    );

    await this.updateProgress(job, 5);

    // Resolve file path if not provided
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    await this.updateProgress(job, 10);

    // Select strategy based on provider
    const strategy = this.selectStrategy(input.provider);

    // Generate unique output path
    const proxyPath = `${filePath}_proxy.mp4`;

    await this.updateProgress(job, 20);

    // Transcode using the selected strategy
    await this.transcodeWithStrategy(strategy, input, filePath, proxyPath, (progress) => {
      // Map strategy progress (0-100) to our range (20-100)
      const mappedProgress = 20 + progress * 0.8;
      this.updateProgress(job, mappedProgress);
    });

    await this.updateProgress(job, 100);

    this.logger.log(
      `Transcode completed for upload ${input.uploadId}: ${proxyPath}`
    );

    return { proxyPath };
  }

  /**
   * Select the appropriate transcoding strategy based on provider
   */
  private selectStrategy(
    provider: ProcessingProvider
  ): FFmpegStrategy | GoogleTranscoderStrategy {
    switch (provider) {
      case ProcessingProvider.FFMPEG:
        return this.ffmpegStrategy;
      case ProcessingProvider.GOOGLE_TRANSCODER:
        return this.googleTranscoderStrategy;
      default:
        this.logger.warn(`Unknown provider ${provider}, defaulting to FFmpeg`);
        return this.ffmpegStrategy;
    }
  }

  /**
   * Transcode using the selected strategy
   */
  private async transcodeWithStrategy(
    strategy: FFmpegStrategy | GoogleTranscoderStrategy,
    input: TranscodeStepInput,
    inputFilePath: string,
    outputPath: string,
    onProgress: (progress: number) => void
  ): Promise<void> {
    if (strategy instanceof FFmpegStrategy) {
      await this.transcodeWithFFmpeg(input, inputFilePath, outputPath, onProgress);
    } else {
      await this.transcodeWithGoogleTranscoder(input, inputFilePath, outputPath, onProgress);
    }
  }

  /**
   * Transcode using FFmpeg strategy
   */
  private async transcodeWithFFmpeg(
    input: TranscodeStepInput,
    inputFilePath: string,
    outputPath: string,
    onProgress: (progress: number) => void
  ): Promise<void> {
    // Map resolution to width/height
    const resolutionMap: Record<string, { width: number; height: number }> = {
      '720p': { width: 1280, height: 720 },
      '1080p': { width: 1920, height: 1080 },
      original: {
        width: input.probeOutput.width,
        height: input.probeOutput.height,
      },
    };

    const targetResolution =
      resolutionMap[input.config.resolution] || resolutionMap['720p'];

    // Map codec to video codec string
    const codecMap: Record<string, string> = {
      h264: 'libx264',
      h265: 'libx265',
      vp9: 'libvpx-vp9',
    };

    const videoCodec = codecMap[input.config.codec] || 'libx264';

    // Map bitrate (it's in bits per second, convert to string format)
    const bitrateString = input.config.bitrate
      ? `${Math.round(input.config.bitrate / 1000000)}M`
      : '2M';

    // Use FFmpegService directly
    const ffmpegService = this.ffmpegStrategy['ffmpegService'] as FFmpegService;

    await ffmpegService.transcode(
      inputFilePath,
      outputPath,
      {
        width: targetResolution.width,
        height: targetResolution.height,
        videoCodec,
        videoBitrate: bitrateString,
        audioBitrate: '128k',
      },
      onProgress
    );
  }

  /**
   * Transcode using Google Transcoder strategy
   * Note: This is a placeholder - actual implementation would use Google Cloud Transcoder API
   */
  private async transcodeWithGoogleTranscoder(
    input: TranscodeStepInput,
    inputFilePath: string,
    outputPath: string,
    onProgress: (progress: number) => void
  ): Promise<void> {
    this.logger.warn(
      'Google Transcoder strategy not fully implemented, falling back to FFmpeg'
    );
    // For now, fall back to FFmpeg
    await this.transcodeWithFFmpeg(input, inputFilePath, outputPath, onProgress);
  }
}
