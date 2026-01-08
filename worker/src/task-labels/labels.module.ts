import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { ProcessorsConfigService } from '../config/processors.config';
import { LabelsService } from './labels.service';
import {
  DetectLabelsParentProcessor,
  UploadToGcsStepProcessor,
  VideoIntelligenceStepProcessor,
  SpeechToTextStepProcessor,
  ProcessVideoIntelligenceLabelsStepProcessor,
  ProcessSpeechToTextLabelsStepProcessor,
} from './processors';
// TODO: Import new executors when processors are refactored
// import {
//   LabelDetectionExecutor,
//   ObjectTrackingExecutor,
//   FaceDetectionExecutor,
//   PersonDetectionExecutor,
//   SpeechTranscriptionExecutor,
// } from './executors';
import { LabelNormalizerService } from './services/label-normalizer.service';
import { LabelCacheService } from './services/label-cache.service';
import { LabelEntityService } from './services/label-entity.service';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Configuration
    ProcessorsConfigService,

    // Service
    LabelsService,

    // Executors (strategy implementations)
    // TODO: Register new executors when processors are refactored
    // LabelDetectionExecutor,
    // ObjectTrackingExecutor,
    // FaceDetectionExecutor,
    // PersonDetectionExecutor,
    // SpeechTranscriptionExecutor,

    // Services
    LabelNormalizerService,
    LabelCacheService,
    LabelEntityService,

    // Processors
    DetectLabelsParentProcessor,
    UploadToGcsStepProcessor,
    VideoIntelligenceStepProcessor,
    SpeechToTextStepProcessor,
    ProcessVideoIntelligenceLabelsStepProcessor,
    ProcessSpeechToTextLabelsStepProcessor,
  ],
  exports: [
    LabelsService,
    LabelNormalizerService,
    LabelCacheService,
    LabelEntityService,
    ProcessorsConfigService,
  ],
})
export class LabelsModule {}
