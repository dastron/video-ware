import { Module } from '@nestjs/common';
import { IntelligenceProcessor } from './intelligence.processor';
import { IntelligenceService } from './intelligence.service';
import { VideoIntelligenceStrategy } from './strategies/video-intelligence.strategy';
import { SpeechToTextStrategy } from './strategies/speech-to-text.strategy';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    SharedModule,
    // Ensure Bull queues are registered once (and QueueService is available)
    QueueModule,
  ],
  providers: [
    IntelligenceProcessor,
    IntelligenceService,
    VideoIntelligenceStrategy,
    SpeechToTextStrategy,
  ],
  exports: [IntelligenceService],
})
export class IntelligenceModule {}