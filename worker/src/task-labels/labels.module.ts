import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { LabelsService } from './labels.service';
import {
  DetectLabelsParentProcessor,
  VideoIntelligenceStepProcessor,
  SpeechToTextStepProcessor,
  NormalizeLabelsStepProcessor,
  StoreResultsStepProcessor,
} from './processors';
import {
  GoogleVideoIntelligenceExecutor,
  GoogleSpeechToTextExecutor,
} from './executors';
import { LabelNormalizerService } from './services/label-normalizer.service';
import { LabelCacheService } from './services/label-cache.service';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Service
    LabelsService,

    // Executors (strategy implementations)
    GoogleVideoIntelligenceExecutor,
    GoogleSpeechToTextExecutor,

    // Services
    LabelNormalizerService,
    LabelCacheService,

    // Processors
    DetectLabelsParentProcessor,
    VideoIntelligenceStepProcessor,
    SpeechToTextStepProcessor,
    NormalizeLabelsStepProcessor,
    StoreResultsStepProcessor,
  ],
  exports: [LabelsService, LabelNormalizerService, LabelCacheService],
})
export class LabelsModule {}
