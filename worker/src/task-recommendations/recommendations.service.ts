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

  constructor(
    @InjectQueue(QUEUE_NAMES.MEDIA_RECOMMENDATIONS)
    private readonly recommendationsQueue: Queue
  ) {}

  /**
   * Enqueue a media recommendation generation task
   * @returns Parent job ID
   */
  async generateMediaRecommendations(
    task: Task,
    payload: GenerateMediaRecommendationsPayload
  ): Promise<string> {
    this.logger.log(
      `Enqueueing media recommendations generation for task ${task.id}`
    );

    // Create step input
    const stepInput: GenerateMediaRecommendationsStepInput = {
      type: 'recommendations:generate_media',
      workspaceId: payload.workspaceId,
      mediaId: payload.mediaId,
      strategies: payload.strategies,
      strategyWeights: payload.strategyWeights,
      filterParams: payload.filterParams,
      maxResults: payload.maxResults,
    };

    // Create parent job data
    const parentJobData: ParentJobData = {
      taskId: task.id,
      workspaceId: payload.workspaceId,
      attemptNumber: 1,
      task,
      stepResults: {},
    };

    // Add parent job to queue
    const parentJob = await this.recommendationsQueue.add(
      'generate_media_recommendations',
      parentJobData,
      {
        jobId: `task-${task.id}`,
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    // Add child step job
    await this.recommendationsQueue.add(
      RecommendationStepType.GENERATE_MEDIA_RECOMMENDATIONS,
      {
        taskId: task.id,
        workspaceId: payload.workspaceId,
        attemptNumber: 1,
        stepType: RecommendationStepType.GENERATE_MEDIA_RECOMMENDATIONS,
        parentJobId: parentJob.id,
        input: stepInput,
      },
      {
        parent: {
          id: parentJob.id!,
          queue: `bull:${QUEUE_NAMES.MEDIA_RECOMMENDATIONS}`,
        },
        removeOnComplete: false,
        removeOnFail: false,
      }
    );

    this.logger.log(
      `Enqueued media recommendations generation for task ${task.id}, parent job: ${parentJob.id}`
    );

    return parentJob.id!;
  }
}
