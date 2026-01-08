import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { FFmpegProbeExecutor } from '../executors';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { FileResolver } from '../utils/file-resolver';
import type { ProbeStepInput } from '../types/step-inputs';
import type { ProbeStepOutput } from '../types';
import type { StepJobData } from '../../queue/types/job.types';
import { MediaType, type MediaInput, type ProbeOutput } from '@project/shared';

/**
 * Processor for the PROBE step
 * Extracts metadata from the uploaded media file and creates Media record
 */
@Injectable()
export class ProbeStepProcessor extends BaseStepProcessor<ProbeStepInput, ProbeStepOutput> {
  protected readonly logger = new Logger(ProbeStepProcessor.name);

  constructor(
    private readonly probeExecutor: FFmpegProbeExecutor,
    private readonly storageService: StorageService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  async process(input: ProbeStepInput, _job: Job<StepJobData>): Promise<ProbeStepOutput> {
    // Resolve file path
    const filePath = await FileResolver.resolveFilePath(
      input.uploadId,
      input.filePath,
      this.storageService,
      this.pocketbaseService
    );

    // Execute probe
    const { probeOutput } = await this.probeExecutor.execute(filePath);

    // Get upload for workspace reference
    const upload = await this.pocketbaseService.getUpload(input.uploadId);
    if (!upload) {
      throw new Error(`Upload ${input.uploadId} not found`);
    }

    // Create Media record
    const mediaData: MediaInput = {
      WorkspaceRef: upload.WorkspaceRef,
      UploadRef: input.uploadId,
      mediaType: this.determineMediaType(probeOutput),
      duration: probeOutput.duration,
      mediaData: probeOutput,
      version: 1,
    };

    const media = await this.pocketbaseService.createMedia(mediaData);

    return { probeOutput, mediaId: media.id };
  }


  private determineMediaType(probeOutput: ProbeOutput): MediaType {
    if (probeOutput.video && probeOutput.width > 0 && probeOutput.height > 0) {
      return MediaType.VIDEO;
    }
    if (probeOutput.audio && !probeOutput.video) {
      return MediaType.AUDIO;
    }
    return MediaType.VIDEO;
  }
}
