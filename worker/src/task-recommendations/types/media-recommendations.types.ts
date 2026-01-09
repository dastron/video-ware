import type {
  RecommendationStrategy,
  LabelType,
} from '@project/shared';

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
export interface GenerateMediaRecommendationsResult {
  generated: number;
  pruned: number;
  queryHash: string;
}

/**
 * Input for the generate media recommendations step
 */
export interface GenerateMediaRecommendationsStepInput {
  type: 'recommendations:generate_media';
  workspaceId: string;
  mediaId: string;
  strategies: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  filterParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
  };
  maxResults?: number;
}
