import { Injectable, Logger } from '@nestjs/common';
import { FlowService } from '../queue/flow.service';
import type { Task, ProcessUploadPayload } from '@project/shared';

/**
 * Transcode Service
 * 
 * Entry point for transcode operations.
 * Creates flow-based jobs that are processed by step processors.
 */
@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  constructor(private readonly flowService: FlowService) {}

  async processTask(task: Task): Promise<string> {
    const payload = task.payload as ProcessUploadPayload;
    
    this.logger.log('Creating transcode flow for task ' + task.id);

    const parentJobId = await this.flowService.createTranscodeFlow(task);

    this.logger.log('Transcode flow created, parent job: ' + parentJobId);

    return parentJobId;
  }
}
