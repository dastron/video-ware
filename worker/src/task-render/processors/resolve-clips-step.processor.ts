import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import type { StepJobData } from '../../queue/types/job.types';
import type { ResolveClipsStepInput, ResolveClipsOutput } from '../executors/interfaces';
import { FFmpegResolveClipsExecutor } from '../executors';

/**
 * Processor for the RESOLVE_CLIPS step
 * Delegates to executor for resolving media files
 */
@Injectable()
export class ResolveClipsStepProcessor extends BaseStepProcessor<
  ResolveClipsStepInput,
  ResolveClipsOutput
> {
  protected readonly logger = new Logger(ResolveClipsStepProcessor.name);

  constructor(
    private readonly resolveClipsExecutor: FFmpegResolveClipsExecutor
  ) {
    super();
  }

  async process(
    input: ResolveClipsStepInput,
    _job: Job<StepJobData>
  ): Promise<ResolveClipsOutput> {
    const { timelineId, editList } = input;

    this.logger.log(`Resolving clips for timeline ${timelineId}`);

    // Delegate to executor
    const result = await this.resolveClipsExecutor.execute(timelineId, editList);

    this.logger.log(`Resolved ${Object.keys(result.clipMediaMap).length} clips`);
    return result;
  }
}
