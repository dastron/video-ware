import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegService, ProbeResult } from '../../shared/services/ffmpeg.service';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type { ProbeStepInput } from '../types/step-inputs';
import type { ProbeStepOutput } from '../types';
import type { StepJobData } from '../../queue/types/job.types';
import type { ProbeOutput } from '@project/shared';

/**
 * Processor for the PROBE step
 * Extracts metadata from the uploaded media file using FFmpeg
 */
@Injectable()
export class ProbeStepProcessor extends BaseStepProcessor<
  ProbeStepInput,
  ProbeStepOutput
> {
  protected readonly logger = new Logger(ProbeStepProcessor.name);

  constructor(
    private readonly ffmpegService: FFmpegService,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process the PROBE step
   * Extracts media metadata using FFmpeg probe
   */
  async process(
    input: ProbeStepInput,
    job: Job<StepJobData>
  ): Promise<ProbeStepOutput> {
    this.logger.log(`Probing file for upload ${input.uploadId}`);

    await this.updateProgress(job, 5);

    // Resolve file path if not provided
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    this.logger.log(
      `Resolved file path: ${filePath} for upload ${input.uploadId}`
    );

    await this.updateProgress(job, 10);

    // Probe the file using FFmpeg
    const probeResult = await this.ffmpegService.probe(filePath);

    await this.updateProgress(job, 50);

    // Convert FFmpeg probe result to our ProbeOutput format
    const probeOutput = this.convertProbeResult(probeResult);

    await this.updateProgress(job, 100);

    this.logger.log(
      `Probe completed for upload ${input.uploadId}: ${probeOutput.duration}s, ${probeOutput.width}x${probeOutput.height}`
    );

    return { probeOutput };
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
