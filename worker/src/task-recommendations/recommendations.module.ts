import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { QueueModule } from '../queue/queue.module';
import { RecommendationsService } from './recommendations.service';
import {
  GenerateMediaRecommendationsProcessor,
  GenerateTimelineRecommendationsProcessor,
} from './processors';

/**
 * Module for recommendation generation tasks
 * 
 * Provides:
 * - Media recommendation generation
 * - Timeline recommendation generation (future)
 * - Strategy-based recommendation algorithms
 * - Recommendation storage and pruning
 */
@Module({
  imports: [SharedModule, QueueModule],
  providers: [
    // Service
    RecommendationsService,

    // Processors
    GenerateMediaRecommendationsProcessor,
    GenerateTimelineRecommendationsProcessor,

    // Strategies are already implemented in strategies/
    // Writers are already implemented in utils/
  ],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
