import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import { StorageService } from '../../shared/services/storage.service';
import type { ProcessUploadPayload, ProbeOutput } from '@project/shared';
import type { TranscodeStrategyResult } from './ffmpeg.strategy';
import * as path from 'path';
import { randomUUID } from 'crypto';

@Injectable()
export class GoogleTranscoderStrategy {
  private readonly logger = new Logger(GoogleTranscoderStrategy.name);

  constructor(
    private readonly googleCloudService: GoogleCloudService,
    private readonly ffmpegService: FFmpegService,
    private readonly storageService: StorageService
  ) {}

  /**
   * Process upload using Google Cloud Transcoder strategy
   * Note: Google Transcoder only handles video transcoding, we still use FFmpeg for thumbnails and sprites
   */
  async process(
    filePath: string,
    payload: ProcessUploadPayload,
    progressCallback: (progress: number) => void
  ): Promise<TranscodeStrategyResult> {
    this.logger.log(
      `Processing upload ${payload.uploadId} with Google Transcoder strategy`
    );

    try {
      // Step 1: Probe the input file using FFmpeg (10% progress)
      progressCallback(10);
      const probeResult = await this.ffmpegService.probe(filePath);
      const probeOutput = this.convertProbeResult(probeResult);

      // Step 2: Generate thumbnail using FFmpeg (25% progress)
      progressCallback(25);
      const thumbnailPath = await this.generateThumbnail(
        filePath,
        payload,
        probeOutput
      );

      // Step 3: Generate sprite sheet using FFmpeg (40% progress)
      progressCallback(40);
      const spritePath = await this.generateSprite(filePath, payload);

      // Step 4: Generate proxy video using Google Transcoder if enabled (55-90% progress)
      let proxyPath: string | undefined;
      if (payload.transcode?.enabled) {
        progressCallback(55);
        proxyPath = await this.generateProxyWithGoogleTranscoder(
          filePath,
          payload,
          progressCallback
        );
      }

      progressCallback(90);

      return {
        thumbnailPath,
        spritePath,
        proxyPath,
        probeOutput: probeOutput,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Google Transcoder processing failed for upload ${payload.uploadId}: ${errorMessage}`
      );
      throw new Error(`Google Transcoder processing failed: ${errorMessage}`);
    }
  }

  /**
   * Generate thumbnail using FFmpeg (Google Transcoder doesn't handle thumbnails)
   */
  private async generateThumbnail(
    filePath: string,
    payload: ProcessUploadPayload,
    probeOutput: ProbeOutput
  ): Promise<string> {
    const config = payload.thumbnail || {
      timestamp: 'midpoint',
      width: 320,
      height: 240,
    };

    // Calculate timestamp
    let timestamp: number;
    if (config.timestamp === 'midpoint') {
      timestamp = probeOutput.duration / 2;
    } else {
      timestamp = config.timestamp;
    }

    // Ensure timestamp is within video duration
    timestamp = Math.min(timestamp, probeOutput.duration - 1);
    timestamp = Math.max(timestamp, 0);

    // Generate unique output path
    const outputPath = this.generateTempPath('thumbnail', 'jpg');

    await this.ffmpegService.generateThumbnail(
      filePath,
      outputPath,
      timestamp,
      config.width,
      config.height
    );

    this.logger.log(`Generated thumbnail: ${outputPath}`);
    return outputPath;
  }

  /**
   * Generate sprite sheet using FFmpeg (Google Transcoder doesn't handle sprites)
   */
  private async generateSprite(
    filePath: string,
    payload: ProcessUploadPayload
  ): Promise<string> {
    const config = payload.sprite || {
      fps: 0.1, // One frame every 10 seconds
      cols: 10,
      rows: 10,
      tileWidth: 160,
      tileHeight: 120,
    };

    // Generate unique output path
    const outputPath = this.generateTempPath('sprite', 'jpg');

    await this.ffmpegService.generateSprite(
      filePath,
      outputPath,
      config.fps,
      config.cols,
      config.rows,
      config.tileWidth,
      config.tileHeight
    );

    this.logger.log(`Generated sprite sheet: ${outputPath}`);
    return outputPath;
  }

  /**
   * Generate proxy video using Google Cloud Transcoder
   */
  private async generateProxyWithGoogleTranscoder(
    filePath: string,
    payload: ProcessUploadPayload,
    progressCallback: (progress: number) => void
  ): Promise<string> {
    const config = payload.transcode!;

    try {
      // Step 1: Upload input file to GCS (if not already there)
      progressCallback(60);
      const inputGcsUri = await this.ensureFileInGcs(
        filePath,
        payload.uploadId
      );

      // Step 2: Determine output GCS URI
      const outputGcsUri = this.generateOutputGcsUri(payload.uploadId, config);

      // Step 3: Create transcoding job
      progressCallback(65);
      const preset = this.selectTranscoderPreset(config);
      const job = await this.googleCloudService.createTranscodeJob(
        inputGcsUri,
        outputGcsUri,
        preset
      );

      this.logger.log(`Created Google Transcoder job: ${job.jobId}`);

      // Step 4: Poll for job completion
      progressCallback(70);
      const completedJob = await this.waitForJobCompletion(
        job.jobId,
        progressCallback
      );

      if (completedJob.state !== 'SUCCEEDED') {
        throw new Error(
          `Transcoding job failed: ${completedJob.error || 'Unknown error'}`
        );
      }

      // Step 5: Download result from GCS to local temp file
      progressCallback(85);
      const localOutputPath = await this.downloadFromGcs(
        completedJob.outputUri
      );

      this.logger.log(`Google Transcoder completed: ${localOutputPath}`);
      return localOutputPath;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Google Transcoder proxy generation failed: ${errorMessage}`
      );
      throw new Error(`Google Transcoder failed: ${errorMessage}`);
    }
  }

  /**
   * Ensure file is available in Google Cloud Storage
   */
  private async ensureFileInGcs(
    filePath: string,
    uploadId: string
  ): Promise<string> {
    // For now, we assume the file needs to be uploaded to GCS
    // In a real implementation, you might check if it's already there
    const gcsPath = `uploads/${uploadId}/input/${path.basename(filePath)}`;
    const gcsUri = `gs://your-bucket-name/${gcsPath}`;

    // TODO: Implement actual GCS upload using StorageService
    // This is a placeholder - in reality you'd upload the file to GCS
    this.logger.log(`File would be uploaded to GCS: ${gcsUri}`);

    return gcsUri;
  }

  /**
   * Generate output GCS URI for transcoded file
   */
  private generateOutputGcsUri(uploadId: string, config: any): string {
    const extension = 'mp4'; // Google Transcoder typically outputs MP4
    const filename = `proxy_${randomUUID()}.${extension}`;
    return `gs://your-bucket-name/uploads/${uploadId}/output/${filename}`;
  }

  /**
   * Select appropriate Google Transcoder preset based on config
   */
  private selectTranscoderPreset(config: any): string {
    // Map our config to Google Transcoder presets
    switch (config.resolution) {
      case '720p':
        return 'preset/web-hd';
      case '1080p':
        return 'preset/web-fhd';
      case 'original':
        return 'preset/web-hd'; // Default to HD for original
      default:
        return 'preset/web-hd';
    }
  }

  /**
   * Wait for Google Transcoder job to complete
   */
  private async waitForJobCompletion(
    jobId: string,
    progressCallback: (progress: number) => void
  ): Promise<any> {
    const maxWaitTime = 30 * 60 * 1000; // 30 minutes
    const pollInterval = 10 * 1000; // 10 seconds
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitTime) {
      const jobStatus =
        await this.googleCloudService.getTranscodeJobStatus(jobId);

      this.logger.debug(
        `Job ${jobId} status: ${jobStatus.state}, progress: ${jobStatus.progress || 0}%`
      );

      // Update progress (map job progress to our range 70-85)
      if (jobStatus.progress !== undefined) {
        const mappedProgress = 70 + jobStatus.progress * 0.15;
        progressCallback(mappedProgress);
      }

      if (jobStatus.state === 'SUCCEEDED') {
        return jobStatus;
      }

      if (jobStatus.state === 'FAILED') {
        throw new Error(
          `Transcoding job failed: ${jobStatus.error || 'Unknown error'}`
        );
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error('Transcoding job timed out');
  }

  /**
   * Download transcoded file from GCS to local temp file
   */
  private async downloadFromGcs(gcsUri: string): Promise<string> {
    // Generate local temp path
    const outputPath = this.generateTempPath('proxy', 'mp4');

    // TODO: Implement actual GCS download using StorageService
    // This is a placeholder - in reality you'd download from GCS
    this.logger.log(
      `File would be downloaded from GCS ${gcsUri} to ${outputPath}`
    );

    return outputPath;
  }

  /**
   * Convert FFmpeg probe result to our ProbeOutput format
   */
  private convertProbeResult(probeResult: any): ProbeOutput {
    const videoStream = probeResult.streams.find(
      (s: any) => s.codec_type === 'video'
    );
    const audioStream = probeResult.streams.find(
      (s: any) => s.codec_type === 'audio'
    );

    if (!videoStream) {
      throw new Error('No video stream found in input file');
    }

    const probeOutput: ProbeOutput = {
      duration: parseFloat(probeResult.format.duration) || 0,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      codec: videoStream.codec_name || 'unknown',
      fps:
        this.parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) ||
        0,
      bitrate: parseInt(probeResult.format.bit_rate) || undefined,
      format: probeResult.format.format_name || 'unknown',
      size: parseInt(probeResult.format.size) || undefined,
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
        bitrate: parseInt(audioStream.bit_rate) || undefined,
      };
    }

    return probeOutput;
  }

  /**
   * Parse frame rate from FFmpeg format (e.g., "30/1" -> 30)
   */
  private parseFps(fpsString: string): number {
    if (!fpsString) return 0;

    const parts = fpsString.split('/');
    if (parts.length === 2) {
      const numerator = parseFloat(parts[0]);
      const denominator = parseFloat(parts[1]);
      return denominator !== 0 ? numerator / denominator : 0;
    }

    return parseFloat(fpsString) || 0;
  }

  /**
   * Generate temporary file path for output
   */
  private generateTempPath(type: string, extension: string): string {
    const tempDir = process.env.TEMP_DIR || '/tmp';
    const filename = `${type}_${randomUUID()}.${extension}`;
    return path.join(tempDir, filename);
  }
}
