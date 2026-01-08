import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { DetectLabelsParentProcessor } from './processors/detect-labels-parent.processor';
import { VideoIntelligenceStepProcessor } from './processors/video-intelligence-step.processor';
import { SpeechToTextStepProcessor } from './processors/speech-to-text-step.processor';
import { NormalizeLabelsStepProcessor } from './processors/normalize-labels-step.processor';
import { StoreResultsStepProcessor } from './processors/store-results-step.processor';
import { LabelNormalizerService } from './services/label-normalizer.service';
import { LabelCacheService } from './services/label-cache.service';

@Module({
  imports: [
    SharedModule,
    // Ensure Bull queues are registered once (and QueueService is available)
    QueueModule,
  ],
  providers: [
    // Services
    LabelNormalizerService,
    LabelCacheService,
    // Step-based processors
    DetectLabelsParentProcessor,
    VideoIntelligenceStepProcessor,
    SpeechToTextStepProcessor,
    NormalizeLabelsStepProcessor,
    StoreResultsStepProcessor,
  ],
  exports: [LabelNormalizerService, LabelCacheService],
})
export class LabelsModule {}
