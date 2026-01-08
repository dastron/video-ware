import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import type { ThumbnailStepInput } from '../types/step-inputs';
import type { ThumbnailStepOutput } from '../types';
import type { StepJobData } from '../../queue/types/job.types';

/**
 * Processor for the THUMBNAIL step
 * Generates a thumbnail image from the media file
 */
@Injectable()
export class ThumbnailStepProcessor extends BaseStepProcessor<
  ThumbnailStepInput,
  ThumbnailStepOutput
> {
  protected readonly logger = new Logger(ThumbnailStepProcessor.name);

  constructor(private readonly ffmpegService: FFmpegService) {
    super();
  }

  /**
   * Process the THUMBNAIL step
   * Generates a thumbnail image at the specified timestamp
   */
  async process(
    input: ThumbnailStepInput,
    job: Job<StepJobData>
  ): Promise<ThumbnailStepOutput> {
    this.logger.log(
      `Generating thumbnail for upload ${input.uploadId} at ${input.config.timestamp}`
    );

    await this.updateProgress(job, 10);

    // Calculate timestamp
    let timestamp: number;
    if (input.config.timestamp === 'midpoint') {
      timestamp = input.probeOutput.duration / 2;
    } else {
      timestamp = input.config.timestamp;
    }

    // Ensure timestamp is within video duration
    timestamp = Math.min(timestamp, input.probeOutput.duration - 1);
    timestamp = Math.max(timestamp, 0);

    await this.updateProgress(job, 30);

    // Generate unique output path
    const thumbnailPath = `${input.filePath}_thumbnail.jpg`;

    // Generate thumbnail using FFmpeg
    await this.ffmpegService.generateThumbnail(
      input.filePath,
      thumbnailPath,
      timestamp,
      input.config.width,
      input.config.height
    );

    await this.updateProgress(job, 100);

    this.logger.log(
      `Thumbnail generated for upload ${input.uploadId}: ${thumbnailPath} (${input.config.width}x${input.config.height} at ${timestamp}s)`
    );

    return { thumbnailPath };
  }
}
