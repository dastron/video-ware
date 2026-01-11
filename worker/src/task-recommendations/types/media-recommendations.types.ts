import { RecommendationStrategy, LabelType } from '@project/shared';
import {
  TaskRecommendationGenerateMediaStep,
  TaskRecommendationGenerateMediaResult,
} from '@project/shared/jobs';

/**
 * Payload for generating media recommendations
 */
export interface GenerateMediaRecommendationsPayload {
  workspaceId: string;
  mediaId: string;
  strategies: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  filterParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
  };
  maxResults?: number; // default 20
}

/**
 * Result of media recommendation generation
 */
export interface GenerateMediaRecommendationsResult extends TaskRecommendationGenerateMediaResult {}

/**
 * Input for the generate media recommendations step
 */
export interface GenerateMediaRecommendationsStepInput extends TaskRecommendationGenerateMediaStep {}
