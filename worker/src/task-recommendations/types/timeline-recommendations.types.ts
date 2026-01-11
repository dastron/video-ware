import type {
  RecommendationStrategy,
  LabelType,
  RecommendationTargetMode,
} from '@project/shared';
import {
  TaskRecommendationGenerateTimelineStep,
  TaskRecommendationGenerateTimelineResult,
} from '@project/shared/jobs';

/**
 * Payload for generating timeline recommendations
 */
export interface GenerateTimelineRecommendationsPayload {
  workspaceId: string;
  timelineId: string;
  seedClipId?: string;
  targetMode: RecommendationTargetMode;
  strategies: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  searchParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
    timeWindow?: number; // seconds for temporal_nearby
  };
  maxResults?: number; // default 20
}

/**
 * Result of timeline recommendation generation
 */
export interface GenerateTimelineRecommendationsResult extends TaskRecommendationGenerateTimelineResult {}

/**
 * Input for the generate timeline recommendations step
 */
export interface GenerateTimelineRecommendationsStepInput extends TaskRecommendationGenerateTimelineStep {}
