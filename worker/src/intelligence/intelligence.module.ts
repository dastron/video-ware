import { Module } from '@nestjs/common';
import { IntelligenceProcessor } from './intelligence.processor';
import { IntelligenceService } from './intelligence.service';
import { VideoIntelligenceStrategy } from './strategies/video-intelligence.strategy';
import { SpeechToTextStrategy } from './strategies/speech-to-text.strategy';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { IntelligenceParentProcessor } from './processors/intelligence-parent.processor';
import { VideoIntelligenceStepProcessor } from './processors/video-intelligence-step.processor';
import { SpeechToTextStepProcessor } from './processors/speech-to-text-step.processor';
import { StoreResultsStepProcessor } from './processors/store-results-step.processor';

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
    // Step-based processors
    IntelligenceParentProcessor,
    VideoIntelligenceStepProcessor,
    SpeechToTextStepProcessor,
    StoreResultsStepProcessor,
  ],
  exports: [IntelligenceService],
})
export class IntelligenceModule {}
