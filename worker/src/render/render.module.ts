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

@Module({
  imports: [
    SharedModule,
    // Ensure Bull queues are registered once (and QueueService is available)
    QueueModule,
  ],
  providers: [
    // Main processor and service
    RenderProcessor,
    RenderService,
    // Parent processor
    RenderParentProcessor,
    // Step processors
    ResolveClipsStepProcessor,
    ComposeStepProcessor,
    UploadStepProcessor,
    CreateRecordsStepProcessor,
  ],
  exports: [
    // Export service for potential use by other modules
    RenderService,
  ],
})
export class RenderModule {}
