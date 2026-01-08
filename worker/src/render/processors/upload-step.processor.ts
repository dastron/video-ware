import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { UploadStepInput, UploadOutput } from '../types/step-inputs';

/**
 * Processor for the UPLOAD step
 * Uploads rendered video to storage
 */
@Injectable()
export class UploadStepProcessor extends BaseStepProcessor<
  UploadStepInput,
  UploadOutput
> {
  protected readonly logger = new Logger(UploadStepProcessor.name);

  constructor(private readonly storageService: StorageService) {
    super();
  }

  async process(
    input: UploadStepInput,
    job: Job<StepJobData>
  ): Promise<UploadOutput> {
    this.logger.log(
      `Uploading rendered video for timeline ${input.timelineId}`
    );

    await this.updateProgress(job, 10);

    // Generate storage path for the rendered video
    const storagePath = this.storageService.generateDerivedPath({
      workspaceId: input.workspaceId,
      recordId: input.timelineId,
      suffix: 'render',
      extension: input.format,
    });

    this.logger.log(`Uploading to storage path: ${storagePath}`);

    await this.updateProgress(job, 30);

    // Upload the file to storage
    await this.storageService.uploadFromPath(input.outputPath, storagePath);

    await this.updateProgress(job, 100);

    this.logger.log(`Successfully uploaded rendered video to: ${storagePath}`);

    return { storagePath };
  }
}
