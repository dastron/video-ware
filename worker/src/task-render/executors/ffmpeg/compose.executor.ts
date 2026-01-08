import { Injectable, Logger } from '@nestjs/common';
import { FFmpegService } from '../../../shared/services/ffmpeg.service';
import type { IComposeExecutor, ComposeResult } from '../interfaces';
import type { RenderTimelinePayload, Media } from '@project/shared';

/**
 * FFmpeg-based executor for composing timelines
 * Pure operation - builds and executes FFmpeg command
 */
@Injectable()
export class FFmpegComposeExecutor implements IComposeExecutor {
  private readonly logger = new Logger(FFmpegComposeExecutor.name);

  constructor(private readonly ffmpegService: FFmpegService) {}

  async execute(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    onProgress?: (progress: number) => void
  ): Promise<ComposeResult> {
    this.logger.log(`Composing timeline with ${editList.length} segments`);

    try {
      // Build FFmpeg command for timeline composition
      const ffmpegArgs = this.buildFFmpegCommand(
        editList,
        clipMediaMap,
        outputPath,
        outputSettings
      );

      // Execute FFmpeg with progress tracking
      await this.ffmpegService.executeWithProgress(
        ffmpegArgs,
        onProgress || (() => {})
      );

      // Probe the rendered video to get metadata
      const probeResult = await this.ffmpegService.probe(outputPath);

      // Convert ProbeResult to ProbeOutput format
      const videoStream = probeResult.streams.find(
        (s) => s.codec_type === 'video'
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

      const probeOutput = {
        duration: parseFloat(String(probeResult.format.duration)) || 0,
        width: videoStream.width || 0,
        height: videoStream.height || 0,
        codec: videoStream.codec_name || 'unknown',
        fps: parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) || 0,
        bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
        format: probeResult.format.format_name || 'unknown',
        size: parseInt(String(probeResult.format.size)) || undefined,
      };

      this.logger.log(`Timeline composition completed: ${outputPath}`);
      return { outputPath, probeOutput };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Timeline composition failed: ${errorMessage}`);
      throw error;
    }
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

    // Add input files
    const inputFiles: string[] = [];
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
      inputFiles.push(clipMedia.filePath);

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

    this.logger.debug(`FFmpeg command: ffmpeg ${args.join(' ')}`);
    return args;
  }
}
