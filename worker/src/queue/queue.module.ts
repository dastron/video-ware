import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueService } from './queue.service';
import { FlowService } from './flow.service';
import { JobService } from './job.service';
import { QUEUE_NAMES } from './queue.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_NAMES.TRANSCODE },
      { name: QUEUE_NAMES.INTELLIGENCE },
      { name: QUEUE_NAMES.RENDER },
      { name: QUEUE_NAMES.LABELS },
      { name: QUEUE_NAMES.MEDIA_RECOMMENDATIONS },
      { name: QUEUE_NAMES.TIMELINE_RECOMMENDATIONS }
    ),
  ],
  providers: [QueueService, FlowService, JobService],
  exports: [QueueService, FlowService, JobService, BullModule],
})
export class QueueModule {}
