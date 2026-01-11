import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../../shared/services/google-cloud.service';
import type { IRenderExecutor, RenderExecutorResult } from '../interfaces';
import type { RenderTimelinePayload, Media } from '@project/shared';

/**
 * Google Cloud Video Transcoder implementation of the Render Executor
 */
@Injectable()
export class GCTranscoderExecutor implements IRenderExecutor {
  private readonly logger = new Logger(GCTranscoderExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  async execute(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputUri: string, // This must be a GCS URI for GC Transcoder
    outputSettings: RenderTimelinePayload['outputSettings'],
    onProgress?: (progress: number) => void
  ): Promise<RenderExecutorResult> {
    this.logger.log(
      `Rendering timeline with Google Cloud Transcoder: ${outputUri}`
    );

    try {
      if (!outputUri.startsWith('gs://')) {
        throw new Error(
          `Google Cloud Transcoder requires a GCS output URI (gs://...), got: ${outputUri}`
        );
      }

      // Build JobConfig
      const jobConfig = this.buildJobConfig(editList, clipMediaMap);

      // Create job
      const jobResult = await this.googleCloudService.createTranscodeJob({
        outputUri,
        jobConfig,
      });

      this.logger.log(`Created Transcoder job: ${jobResult.jobId}`);

      // Poll for completion
      const finalJob = await this.waitForCompletion(
        jobResult.jobId,
        onProgress
      );

      if (finalJob.state === 'FAILED' || finalJob.state === 'CANCELLED') {
        throw new Error(
          `Transcoder job failed: ${finalJob.error || 'Unknown error'}`
        );
      }

      this.logger.log(
        `Google Cloud Transcoder job completed successfully: ${outputUri}`
      );

      return {
        outputPath: outputUri,
        isLocal: false,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Google Cloud Transcoder execution failed: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Build Google Cloud Transcoder JobConfig
   */
  private buildJobConfig(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>
  ): any {
    // 1. Inputs
    const inputs = Object.entries(clipMediaMap).map(
      ([mediaId, { filePath }]) => ({
        key: `input_${mediaId}`, // Prefix to ensure it meets naming requirements
        uri: filePath,
      })
    );

    // 2. EditList (Atoms)
    const googleEditList = editList.map((segment, index) => {
      const startTime =
        segment.startTimeOffset.seconds + segment.startTimeOffset.nanos / 1e9;
      const endTime =
        segment.endTimeOffset.seconds + segment.endTimeOffset.nanos / 1e9;
      const duration = endTime - startTime;

      return {
        key: `atom_${index}`,
        inputs: segment.inputs.map((id) => `input_${id}`),
        startTimeOffset: {
          seconds: Math.floor(startTime),
          nanos: Math.floor((startTime % 1) * 1e9),
        },
        duration: {
          seconds: Math.floor(duration),
          nanos: Math.floor((duration % 1) * 1e9),
        },
      };
    });

    // 3. Elementary Streams (we use templateId/preset but can override)
    // For now, we'll let the preset handle it or we can provide minimal config if needed
    // However, templateId is usually enough. But if we use templateId, we don't need jobConfig.
    // Wait, GC Transcoder expects EITHER templateId OR config.
    // If we want to use presets AND custom editList, we might need to expand the preset into raw config.

    // BUT: "templateId" field in Job message: "The template Id to use. If templateId is provided, JobConfig must be empty."
    // So if we have an editList, we MUST provide a full JobConfig.

    return {
      inputs,
      editList: [
        {
          key: 'main_edit_list',
          atoms: googleEditList,
        },
      ],
      elementaryStreams: [
        {
          key: 'video_stream0',
          videoStream: {
            h264: {
              heightPixels: 720, // Default for now
              widthPixels: 1280,
              bitrateBps: 2500000,
              frameRate: 30,
            },
          },
        },
        {
          key: 'audio_stream0',
          audioStream: {
            codec: 'aac',
            bitrateBps: 128000,
            sampleRateHertz: 48000,
            channelCount: 2,
          },
        },
      ],
      muxStreams: [
        {
          key: 'sd',
          container: 'mp4',
          elementaryStreams: ['video_stream0', 'audio_stream0'],
        },
      ],
    };
  }

  /**
   * Wait for transcoder job to complete
   */
  private async waitForCompletion(
    jobId: string,
    onProgress?: (progress: number) => void
  ): Promise<any> {
    const pollInterval = 5000; // 5 seconds
    let job = await this.googleCloudService.getTranscodeJobStatus(jobId);

    while (job.state === 'PENDING' || job.state === 'RUNNING') {
      if (onProgress && job.progress !== undefined) {
        onProgress(job.progress);
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      job = await this.googleCloudService.getTranscodeJobStatus(jobId);
    }

    return job;
  }
}
