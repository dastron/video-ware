import { Module } from '@nestjs/common';
import { RenderProcessor } from './render.processor';
import { RenderService } from './render.service';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import {
  RenderParentProcessor,
  ResolveClipsStepProcessor,
  ComposeStepProcessor,
  UploadStepProcessor,
  CreateRecordsStepProcessor,
} from './processors';
import {
  FFmpegResolveClipsExecutor,
  FFmpegComposeExecutor,
  FFmpegUploadExecutor,
} from './executors';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Service
    RenderService,

    // Legacy processor (can be removed once fully migrated)
    RenderProcessor,

    // Executors (strategy implementations)
    FFmpegResolveClipsExecutor,
    FFmpegComposeExecutor,
    FFmpegUploadExecutor,

    // Parent processor
    RenderParentProcessor,

    // Step processors
    ResolveClipsStepProcessor,
    ComposeStepProcessor,
    UploadStepProcessor,
    CreateRecordsStepProcessor,
  ],
  exports: [RenderService],
})
export class RenderModule {}
