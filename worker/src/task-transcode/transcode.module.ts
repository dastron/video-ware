import { Module } from '@nestjs/common';
import { TranscodeService } from './transcode.service';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';

// Executors
import {
  FFmpegProbeExecutor,
  FFmpegThumbnailExecutor,
  FFmpegSpriteExecutor,
  FFmpegTranscodeExecutor,
  GoogleTranscodeExecutor,
} from './executors';

// Processors
import {
  TranscodeParentProcessor,
  ProbeStepProcessor,
  ThumbnailStepProcessor,
  SpriteStepProcessor,
  TranscodeStepProcessor,
} from './processors';

@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Service
    TranscodeService,

    // Executors (strategy implementations)
    FFmpegProbeExecutor,
    FFmpegThumbnailExecutor,
    FFmpegSpriteExecutor,
    FFmpegTranscodeExecutor,
    GoogleTranscodeExecutor,

    // Step processors
    TranscodeParentProcessor,
    ProbeStepProcessor,
    ThumbnailStepProcessor,
    SpriteStepProcessor,
    TranscodeStepProcessor,
  ],
  exports: [TranscodeService],
})
export class TranscodeModule {}
