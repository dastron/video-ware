import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '../queue/queue.constants';
import type { Task } from '@project/shared';
import type { ParentJobData } from '../queue/types/job.types';
import type {
  GenerateMediaRecommendationsPayload,
  GenerateMediaRecommendationsStepInput,
} from './types';
import { RecommendationStepType } from '../queue/types/step.types';

/**
 * Service for managing recommendation generation tasks
 */
@Injectable()
export class RecommendationsService {
  private readonly logger = new Logger(RecommendationsService.name);
  constructor() {}
}
