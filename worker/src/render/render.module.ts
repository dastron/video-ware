import { Module } from '@nestjs/common';
import { RenderProcessor } from './render.processor';
import { RenderService } from './render.service';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';

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
  ],
  exports: [
    // Export service for potential use by other modules
    RenderService,
  ],
})
export class RenderModule {}