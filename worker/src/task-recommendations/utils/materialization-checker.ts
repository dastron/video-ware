import { Logger } from '@nestjs/common';
import type { TimelineRecommendation } from '@project/shared';
import { PocketBaseService } from '../../shared/services/pocketbase.service';

/**
 * MaterializationChecker handles checking if timeline recommendations
 * have been materialized (accepted and converted to TimelineClips).
 *
 * Materialized recommendations should be preserved during regeneration
 * to maintain user actions and the link to created TimelineClips.
 *
 * Requirements: 7.4, 7.5
 */
export class MaterializationChecker {
  private readonly logger = new Logger(MaterializationChecker.name);

  constructor(private readonly pocketbaseService: PocketBaseService) {}

  /**
   * Check if a timeline recommendation has been materialized.
   *
   * A recommendation is considered materialized if:
   * - acceptedAt is set (user accepted the recommendation)
   *
   * @param recommendation - The timeline recommendation to check
   * @returns true if the recommendation has been materialized
   */
  isMaterialized(recommendation: TimelineRecommendation): boolean {
    return !!recommendation.acceptedAt;
  }

  /**
   * Get all materialized recommendation IDs for a given query hash.
   *
   * This is used during regeneration to identify which recommendations
   * should be preserved and not modified.
   *
   * @param queryHash - The query hash to check
   * @returns Array of recommendation IDs that are materialized
   */
  async getMaterializedIds(queryHash: string): Promise<string[]> {
    // Get all recommendations for this queryHash that have been accepted
    const result =
      await this.pocketbaseService.timelineRecommendationMutator.getByQueryHash(
        queryHash,
        { excludeAccepted: false }, // Include accepted recommendations
        1,
        1000 // Get all (reasonable max)
      );

    // Filter to only those with acceptedAt set
    const materialized = result.items.filter((rec) => this.isMaterialized(rec));

    return materialized.map((rec) => rec.id);
  }

  /**
   * Check if a recommendation should be skipped during regeneration.
   *
   * Materialized recommendations should be skipped to preserve:
   * - The user's acceptance action (acceptedAt timestamp)
   * - The link to the created TimelineClip (TimelineClipRef)
   * - The original recommendation data at the time of acceptance
   *
   * @param recommendation - The timeline recommendation to check
   * @returns true if the recommendation should be skipped during regeneration
   */
  shouldSkipDuringRegeneration(
    recommendation: TimelineRecommendation
  ): boolean {
    return this.isMaterialized(recommendation);
  }

  /**
   * Get materialized recommendations for a timeline.
   *
   * This can be used to show users which recommendations they've
   * already accepted and provide manual resolution options if needed.
   *
   * @param timelineId - The timeline ID
   * @param page - Page number (default: 1)
   * @param perPage - Items per page (default: 50)
   * @returns List of materialized recommendations with expanded relations
   */
  async getMaterializedByTimeline(timelineId: string, page = 1, perPage = 50) {
    this.logger.debug(
      `Getting materialized recommendations for timeline: ${timelineId}`
    );

    return this.pocketbaseService.timelineRecommendationMutator.getByTimeline(
      timelineId,
      {
        excludeAccepted: false, // We want accepted recommendations
        excludeDismissed: true, // But not dismissed ones
      },
      page,
      perPage
    );
  }

  /**
   * Check if a recommendation has a linked TimelineClip.
   *
   * When a recommendation is accepted, it should be linked to the
   * created TimelineClip via TimelineClipRef. This method checks
   * if that link exists.
   *
   * @param recommendation - The timeline recommendation to check
   * @returns true if the recommendation has a linked TimelineClip
   */
  hasLinkedTimelineClip(recommendation: TimelineRecommendation): boolean {
    return !!recommendation.TimelineClipRef;
  }

  /**
   * Validate that a materialized recommendation maintains its link.
   *
   * Materialized recommendations should always have:
   * - acceptedAt timestamp set
   * - TimelineClipRef pointing to the created clip
   *
   * This method can be used for validation and debugging.
   *
   * @param recommendation - The timeline recommendation to validate
   * @returns Object with validation results
   */
  validateMaterialization(recommendation: TimelineRecommendation): {
    isValid: boolean;
    hasAcceptedAt: boolean;
    hasTimelineClipRef: boolean;
    issues: string[];
  } {
    const hasAcceptedAt = !!recommendation.acceptedAt;
    const hasTimelineClipRef = this.hasLinkedTimelineClip(recommendation);
    const issues: string[] = [];

    if (hasAcceptedAt && !hasTimelineClipRef) {
      issues.push(
        'Recommendation is marked as accepted but has no linked TimelineClip'
      );
    }

    if (!hasAcceptedAt && hasTimelineClipRef) {
      issues.push(
        'Recommendation has a linked TimelineClip but is not marked as accepted'
      );
    }

    const isValid = issues.length === 0;

    return {
      isValid,
      hasAcceptedAt,
      hasTimelineClipRef,
      issues,
    };
  }

  /**
   * Get statistics about materialized recommendations.
   *
   * Useful for monitoring and debugging the recommendation system.
   *
   * @param queryHash - Optional query hash to filter by
   * @returns Statistics about materialized recommendations
   */
  async getStatistics(queryHash?: string): Promise<{
    total: number;
    materialized: number;
    withLinkedClip: number;
    withoutLinkedClip: number;
    materializationRate: number;
  }> {
    let recommendations: TimelineRecommendation[];

    if (queryHash) {
      const result =
        await this.pocketbaseService.timelineRecommendationMutator.getByQueryHash(
          queryHash,
          {},
          1,
          1000
        );
      recommendations = result.items;
    } else {
      // Get all recommendations (this could be expensive in production)
      const result =
        await this.pocketbaseService.timelineRecommendationMutator.getList(
          1,
          1000
        );
      recommendations = result.items;
    }

    const total = recommendations.length;
    const materialized = recommendations.filter((r) =>
      this.isMaterialized(r)
    ).length;
    const withLinkedClip = recommendations.filter((r) =>
      this.hasLinkedTimelineClip(r)
    ).length;
    const withoutLinkedClip = materialized - withLinkedClip;
    const materializationRate = total > 0 ? materialized / total : 0;

    return {
      total,
      materialized,
      withLinkedClip,
      withoutLinkedClip,
      materializationRate,
    };
  }
}
