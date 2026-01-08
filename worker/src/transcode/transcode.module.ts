import { Module } from '@nestjs/common';
import { TranscodeProcessor } from './transcode.processor';
import { TranscodeService } from './transcode.service';
import { FFmpegStrategy } from './strategies/ffmpeg.strategy';
import { GoogleTranscoderStrategy } from './strategies/google-transcoder.strategy';
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
    TranscodeProcessor,
    TranscodeService,
    
    // Processing strategies
    FFmpegStrategy,
    GoogleTranscoderStrategy,
  ],
  exports: [
    // Export service for potential use by other modules
    TranscodeService,
  ],
})
export class TranscodeModule {}