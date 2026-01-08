import { Module } from '@nestjs/common';
import { TranscodeProcessor } from './transcode.processor';
import { TranscodeService } from './transcode.service';
import { FFmpegStrategy } from './strategies/ffmpeg.strategy';
import { GoogleTranscoderStrategy } from './strategies/google-transcoder.strategy';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';

// Import step processors
import { TranscodeParentProcessor } from './processors/transcode-parent.processor';
import { ProbeStepProcessor } from './processors/probe-step.processor';
import { ThumbnailStepProcessor } from './processors/thumbnail-step.processor';
import { SpriteStepProcessor } from './processors/sprite-step.processor';
import { TranscodeStepProcessor } from './processors/transcode-step.processor';
import { FinalizeStepProcessor } from './processors/finalize-step.processor';

@Module({
  imports: [
    SharedModule,
    // Ensure Bull queues are registered once (and QueueService is available)
    QueueModule,
  ],
  providers: [
    // Main processor and service
    TranscodeProcessor,
    TranscodeService,

    // Processing strategies
    FFmpegStrategy,
    GoogleTranscoderStrategy,

    // Step processors for new flow-based architecture
    TranscodeParentProcessor,
    ProbeStepProcessor,
    ThumbnailStepProcessor,
    SpriteStepProcessor,
    TranscodeStepProcessor,
    FinalizeStepProcessor,
  ],
  exports: [
    // Export service for potential use by other modules
    TranscodeService,
  ],
})
export class TranscodeModule {}
