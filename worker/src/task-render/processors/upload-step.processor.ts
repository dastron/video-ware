import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { UploadStepInput, UploadOutput } from '../executors/interfaces';
import { FFmpegUploadExecutor } from '../executors';

/**
 * Processor for the UPLOAD step
 * Delegates to executor for uploading rendered files
 */
@Injectable()
export class UploadStepProcessor extends BaseStepProcessor<
  UploadStepInput,
  UploadOutput
> {
  protected readonly logger = new Logger(UploadStepProcessor.name);

  constructor(
    private readonly uploadExecutor: FFmpegUploadExecutor,
    private readonly storageService: StorageService
  ) {
    super();
  }

  async process(
    input: UploadStepInput,
    _job: Job<StepJobData>
  ): Promise<UploadOutput> {
    const { timelineId, workspaceId, outputPath, format } = input;

    this.logger.log(`Uploading rendered file for timeline ${timelineId}`);

    // Generate storage path
    const storagePath = this.storageService.generateDerivedPath({
      workspaceId,
      recordId: timelineId,
      suffix: 'render',
      extension: format,
    });

    // Delegate to executor
    const result = await this.uploadExecutor.execute(outputPath, storagePath);

    this.logger.log(`File uploaded to ${storagePath}`);
    return result;
  }
}
