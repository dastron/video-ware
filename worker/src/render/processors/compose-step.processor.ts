import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { ComposeStepInput, ComposeOutput } from '../types/step-inputs';
import type {
  RenderTimelinePayload,
  Media,
  ProbeOutput,
} from '@project/shared';
import * as path from 'path';

/**
 * Processor for the COMPOSE step
 * Builds FFmpeg command and executes timeline composition
 */
@Injectable()
export class ComposeStepProcessor extends BaseStepProcessor<
  ComposeStepInput,
  ComposeOutput
> {
  protected readonly logger = new Logger(ComposeStepProcessor.name);

  constructor(private readonly ffmpegService: FFmpegService) {
    super();
  }

  async process(
    input: ComposeStepInput,
    job: Job<StepJobData>
  ): Promise<ComposeOutput> {
    this.logger.log(
      `Composing timeline ${input.timelineId} with ${input.editList.length} segments`
    );

    await this.updateProgress(job, 5);

    // Generate output path
    const outputPath = path.join(
      input.tempDir,
      `timeline_${input.timelineId}.${input.outputSettings.format}`
    );

    // Build FFmpeg command
    const ffmpegArgs = this.buildFFmpegCommand(
      input.editList,
      input.clipMediaMap,
      outputPath,
      input.outputSettings
    );

    this.logger.debug(`FFmpeg command: ffmpeg ${ffmpegArgs.join(' ')}`);

    await this.updateProgress(job, 10);

    // Execute FFmpeg with progress tracking
    await this.ffmpegService.executeWithProgress(
      ffmpegArgs,
      async (composeProgress) => {
        // Map compose progress (0-100) to our progress range (10-90)
        const mappedProgress = 10 + composeProgress * 0.8;
        await this.updateProgress(job, Math.min(mappedProgress, 90));
      }
    );

    await this.updateProgress(job, 95);

    // Probe the rendered video to get metadata
    const probeResult = await this.ffmpegService.probe(outputPath);
    const probeOutput = this.convertProbeResult(probeResult);

    await this.updateProgress(job, 100);

    this.logger.log(`Timeline composition completed: ${outputPath}`);

    return { outputPath, probeOutput };
  }

  /**
   * Build FFmpeg command for timeline composition
   */
  private buildFFmpegCommand(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings']
  ): string[] {
    const args: string[] = [];

    // Add input files and build filter complex
    const filterComplex: string[] = [];

    for (let i = 0; i < editList.length; i++) {
      const segment = editList[i];

      // Find the clip media for this segment
      const clipMedia = Object.values(clipMediaMap).find((cm) =>
        segment.inputs.includes(cm.media.id)
      );

      if (!clipMedia) {
        throw new Error(`No media found for segment ${segment.key}`);
      }

      // Add input file
      args.push('-i', clipMedia.filePath);

      // Calculate segment timing
      const startTime =
        segment.startTimeOffset.seconds + segment.startTimeOffset.nanos / 1e9;
      const endTime =
        segment.endTimeOffset.seconds + segment.endTimeOffset.nanos / 1e9;
      const duration = endTime - startTime;

      // Create filter for this segment
      const segmentFilter = `[${i}:v]trim=start=${startTime}:duration=${duration},setpts=PTS-STARTPTS[v${i}]; [${i}:a]atrim=start=${startTime}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`;
      filterComplex.push(segmentFilter);
    }

    // Concatenate all segments
    const videoInputs = editList.map((_, i) => `[v${i}]`).join('');
    const audioInputs = editList.map((_, i) => `[a${i}]`).join('');
    const concatFilter = `${videoInputs}${audioInputs}concat=n=${editList.length}:v=1:a=1[outv][outa]`;
    filterComplex.push(concatFilter);

    // Add filter complex
    args.push('-filter_complex', filterComplex.join('; '));

    // Map output streams
    args.push('-map', '[outv]', '-map', '[outa]');

    // Add output settings
    args.push('-c:v', outputSettings.codec);

    // Parse resolution
    const [width, height] = outputSettings.resolution.split('x').map(Number);
    args.push('-s', `${width}x${height}`);

    // Add output format
    args.push('-f', outputSettings.format);

    // Add output file
    args.push(outputPath);

    return args;
  }

  /**
   * Convert FFmpeg probe result to ProbeOutput format
   */
  private convertProbeResult(probeResult: any): ProbeOutput {
    const videoStream = probeResult.streams.find(
      (s: any) => s.codec_type === 'video'
    ) as (typeof probeResult.streams)[0] & {
      r_frame_rate?: string;
      avg_frame_rate?: string;
    };

    if (!videoStream) {
      throw new Error('No video stream found in rendered file');
    }

    // Parse FPS from FFmpeg format (e.g., "30/1" -> 30)
    const parseFps = (fpsString: string | undefined): number => {
      if (!fpsString) return 0;
      const [num, den] = fpsString.split('/').map(Number);
      return den && den > 0 ? num / den : 0;
    };

    return {
      duration: parseFloat(String(probeResult.format.duration)) || 0,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      codec: videoStream.codec_name || 'unknown',
      fps:
        parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) || 0,
      bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
      format: probeResult.format.format_name || 'unknown',
      size: parseInt(String(probeResult.format.size)) || undefined,
    };
  }
}
