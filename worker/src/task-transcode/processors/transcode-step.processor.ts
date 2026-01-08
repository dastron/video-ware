import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import * as path from 'path';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor, FFmpegTranscodeExecutor, GoogleTranscodeExecutor } from '../executors';
import type { ITranscodeExecutor, TranscodeConfig as ExecutorTranscodeConfig } from '../executors/interfaces';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type { TranscodeStepInput, TranscodeStepOutput } from './step-types';
import type { StepJobData } from '../../queue/types/job.types';
import { ProcessingProvider, FileType, FileSource } from '@project/shared';

/**
 * Processor for the TRANSCODE step
 * Creates a proxy video using the configured provider (FFmpeg or Google Cloud)
 */
@Injectable()
export class TranscodeStepProcessor extends BaseStepProcessor<TranscodeStepInput, TranscodeStepOutput> {
  protected readonly logger = new Logger(TranscodeStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly ffmpegTranscodeExecutor: FFmpegTranscodeExecutor,
    private readonly googleTranscodeExecutor: GoogleTranscodeExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(input: TranscodeStepInput, _job: Job<StepJobData>): Promise<TranscodeStepOutput> {
    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Probe for dimensions (independent of other steps)
    const { probeOutput } = await this.probeExecutor.execute(filePath);

    // Select executor based on provider
    const executor = this.selectExecutor(input.provider);

    // Build executor config
    const executorConfig: ExecutorTranscodeConfig = {
      resolution: input.config.resolution as '720p' | '1080p' | 'original',
      codec: input.config.codec as 'h264' | 'h265' | 'vp9',
      bitrate: input.config.bitrate,
      sourceWidth: probeOutput.width,
      sourceHeight: probeOutput.height,
    };


    // Execute transcode
    const proxyPath = `${filePath}_proxy.mp4`;
    await executor.execute(filePath, proxyPath, executorConfig);

    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Create File record
    const fileName = path.basename(proxyPath);
    const storageKey = `uploads/${input.uploadId}/${FileType.PROXY}/${fileName}`;

    const proxyFile = await this.pocketbaseService.createFileWithUpload({
      localFilePath: proxyPath,
      fileName,
      fileType: FileType.PROXY,
      fileSource: FileSource.POCKETBASE,
      storageKey,
      workspaceRef: upload.WorkspaceRef,
      uploadRef: input.uploadId,
      mimeType: 'video/mp4',
    });

    // Update Media record
    const media = await this.pocketbaseService.findMediaByUpload(input.uploadId);
    if (media) {
      await this.pocketbaseService.updateMedia(media.id, {
        proxyFileRef: proxyFile.id,
      });
    }

    return { proxyPath, proxyFileId: proxyFile.id };
  }

  private selectExecutor(provider: ProcessingProvider): ITranscodeExecutor {
    switch (provider) {
      case ProcessingProvider.GOOGLE_TRANSCODER:
        return this.googleTranscodeExecutor;
      case ProcessingProvider.FFMPEG:
      default:
        return this.ffmpegTranscodeExecutor;
    }
  }
}
