/**
 * Base Strategy Interface for Recommendation Engine
 *
 * This module defines the core interfaces and types for recommendation strategies.
 * Strategies are pluggable algorithms that generate scored candidates for both
 * media-level and timeline-level recommendations.
 */

import type {
  Workspace,
  Media,
  MediaClip,
  LabelClip,
  LabelEntity,
  Timeline,
  TimelineClip,
  MediaReasonData,
  TimelineReasonData,
} from '@project/shared';
import { LabelType, RecommendationStrategy } from '@project/shared';

/**
 * Filter parameters for media recommendations
 */
export interface FilterParams {
  labelTypes?: LabelType[];
  minConfidence?: number;
  durationRange?: { min: number; max: number };
}

/**
 * Search parameters for timeline recommendations
 */
export interface SearchParams {
  labelTypes?: LabelType[];
  minConfidence?: number;
  durationRange?: { min: number; max: number };
  timeWindow?: number; // seconds for temporal_nearby strategy
}

/**
 * Context for media-level recommendation generation
 */
export interface MediaStrategyContext {
  workspace: Workspace;
  media: Media;
  labelClips: LabelClip[];
  labelEntities: LabelEntity[];
  existingClips: MediaClip[];
  filterParams: FilterParams;
}

/**
 * Context for timeline-level recommendation generation
 */
export interface TimelineStrategyContext {
  workspace: Workspace;
  timeline: Timeline;
  timelineClips: TimelineClip[];
  seedClip?: MediaClip;
  availableClips: MediaClip[];
  labelClips: LabelClip[];
  labelEntities: LabelEntity[];
  searchParams: SearchParams;
}

/**
 * Scored candidate for media recommendations
 */
export interface ScoredMediaCandidate {
  startTime: number;
  endTime: number;
  clipId?: string; // if matches existing MediaClip
  score: number; // 0-1 relevance score
  reason: string; // human-readable explanation
  reasonData: MediaReasonData; // structured explanation data
  labelType: LabelType;
}

/**
 * Scored candidate for timeline recommendations
 */
export interface ScoredTimelineCandidate {
  clipId: string; // MediaClip ID
  score: number; // 0-1 relevance score
  reason: string; // human-readable explanation
  reasonData: TimelineReasonData; // structured explanation data
}

/**
 * Base interface for recommendation strategies
 *
 * Each strategy implements algorithms for generating recommendations
 * for both media-level (segment discovery) and timeline-level (editing context).
 */
export interface IRecommendationStrategy {
  /**
   * Strategy identifier
   */
  readonly name: RecommendationStrategy;

  /**
   * Execute strategy for media-level recommendations
   *
   * @param context - Media context including labels and existing clips
   * @returns Array of scored media candidates
   */
  executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]>;

  /**
   * Execute strategy for timeline-level recommendations
   *
   * @param context - Timeline context including clips and labels
   * @returns Array of scored timeline candidates
   */
  executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]>;
}

/**
 * Abstract base class for recommendation strategies
 *
 * Provides common utilities and enforces the strategy interface.
 */
export abstract class BaseRecommendationStrategy implements IRecommendationStrategy {
  abstract readonly name: RecommendationStrategy;

  abstract executeForMedia(
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]>;

  abstract executeForTimeline(
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]>;

  /**
   * Helper: Check if a segment passes filter criteria
   */
  protected passesFilters(
    segment: {
      start: number;
      end: number;
      confidence: number;
      labelType: LabelType;
    },
    filters: FilterParams
  ): boolean {
    // Label type filter
    if (filters.labelTypes && filters.labelTypes.length > 0) {
      if (!filters.labelTypes.includes(segment.labelType)) {
        return false;
      }
    }

    // Confidence filter
    if (filters.minConfidence !== undefined) {
      if (segment.confidence < filters.minConfidence) {
        return false;
      }
    }

    // Duration range filter
    if (filters.durationRange) {
      const duration = segment.end - segment.start;
      if (
        duration < filters.durationRange.min ||
        duration > filters.durationRange.max
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Helper: Calculate duration of a segment
   */
  protected calculateDuration(start: number, end: number): number {
    return end - start;
  }

  /**
   * Helper: Calculate temporal distance between two time points
   */
  protected calculateTimeDelta(time1: number, time2: number): number {
    return Math.abs(time1 - time2);
  }

  /**
   * Helper: Normalize score to 0-1 range
   */
  protected normalizeScore(score: number, min: number, max: number): number {
    if (max === min) return 1;
    return Math.max(0, Math.min(1, (score - min) / (max - min)));
  }
}
