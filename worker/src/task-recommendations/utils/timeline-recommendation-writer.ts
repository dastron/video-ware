import { Logger } from '@nestjs/common';
import {
  type TimelineRecommendationInput,
  RecommendationStrategy,
  RecommendationTargetMode,
} from '@project/shared';
import { PocketBaseService } from '../../shared/services/pocketbase.service';

/**
 * Scored candidate for timeline recommendation
 */
export interface ScoredTimelineCandidate {
  clipId: string; // MediaClipRef
  score: number;
  reason: string;
  reasonData: Record<string, unknown>;
  strategy: RecommendationStrategy;
}

/**
 * Context for writing timeline recommendations
 */
export interface TimelineRecommendationContext {
  workspaceId: string;
  timelineId: string;
  seedClipId?: string;
  targetMode: RecommendationTargetMode;
  queryHash: string;
  version?: number;
  processor?: string;
}

/**
 * Result of write operation
 */
export interface TimelineWriteResult {
  created: number;
  updated: number;
  pruned: number;
  skipped: number; // materialized recommendations that were skipped
  total: number;
}

/**
 * TimelineRecommendationWriter handles upsert and pruning logic for timeline recommendations.
 *
 * Key responsibilities:
 * - Upsert recommendations based on queryHash + MediaClipRef
 * - Enforce top-M limit per queryHash
 * - Recompute ranks to maintain contiguous ordering
 * - Skip materialized (accepted) recommendations to preserve user actions
 *
 * Requirements: 3.2, 3.4, 3.6, 3.7, 7.4
 */
export class TimelineRecommendationWriter {
  private readonly logger = new Logger(TimelineRecommendationWriter.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly maxPerContext: number = 20
  ) {}

  /**
   * Write recommendations for a given context.
   *
   * Process:
   * 1. Identify materialized recommendations to skip
   * 2. Sort candidates by score (descending)
   * 3. Upsert each candidate with computed rank (skipping materialized)
   * 4. Prune excess recommendations beyond maxPerContext
   * 5. Recompute ranks to ensure contiguous ordering
   *
   * @param queryHash - Deterministic hash for the query context
   * @param candidates - Scored candidates to write
   * @param context - Context information for the recommendations
   * @returns Write result with counts
   */
  async write(
    queryHash: string,
    candidates: ScoredTimelineCandidate[],
    context: TimelineRecommendationContext
  ): Promise<TimelineWriteResult> {
    this.logger.debug(
      `Writing ${candidates.length} timeline recommendations for queryHash: ${queryHash}`
    );

    // Get IDs of materialized recommendations to skip
    const materializedIds = await this.skipMaterialized(queryHash);
    this.logger.debug(
      `Found ${materializedIds.length} materialized recommendations to preserve`
    );

    // Sort candidates by score descending
    const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);

    // Take only top maxPerContext candidates
    const topCandidates = sortedCandidates.slice(0, this.maxPerContext);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    // Upsert each candidate with its rank
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i];

      // Check if this recommendation is materialized
      const existing =
        await this.pocketbaseService.timelineRecommendationMutator.getFirstByFilter(
          `queryHash = "${queryHash}" && MediaClipRef = "${candidate.clipId}"`
        );

      if (existing && materializedIds.includes(existing.id)) {
        // Skip materialized recommendations
        this.logger.debug(
          `Skipping materialized recommendation: ${existing.id}`
        );
        skipped++;
        continue;
      }

      const result = await this.upsertRecommendation(
        queryHash,
        candidate,
        i, // rank is 0-based index
        context
      );

      if (result === 'created') {
        created++;
      } else {
        updated++;
      }
    }

    // Prune any excess recommendations beyond maxPerContext (excluding materialized)
    const pruned = await this.pruneExcess(
      queryHash,
      this.maxPerContext,
      materializedIds
    );

    // Recompute ranks to ensure contiguous ordering (excluding materialized)
    await this.recomputeRanks(queryHash, materializedIds);

    const total = topCandidates.length;

    this.logger.debug(
      `Write complete: ${created} created, ${updated} updated, ${pruned} pruned, ${skipped} skipped, ${total} total`
    );

    return {
      created,
      updated,
      pruned,
      skipped,
      total,
    };
  }

  /**
   * Upsert a single recommendation.
   *
   * Matches on (queryHash, MediaClipRef) for upsert behavior.
   *
   * @param queryHash - Query hash
   * @param candidate - Scored candidate
   * @param rank - Computed rank (0-based)
   * @param context - Context information
   * @returns 'created' or 'updated'
   */
  private async upsertRecommendation(
    queryHash: string,
    candidate: ScoredTimelineCandidate,
    rank: number,
    context: TimelineRecommendationContext
  ): Promise<'created' | 'updated'> {
    const input: TimelineRecommendationInput = {
      WorkspaceRef: context.workspaceId,
      TimelineRef: context.timelineId,
      SeedClipRef: context.seedClipId,
      MediaClipRef: candidate.clipId,
      score: candidate.score,
      rank,
      reason: candidate.reason,
      reasonData: candidate.reasonData,
      strategy: candidate.strategy,
      targetMode: context.targetMode,
      queryHash,
      version: context.version ?? 1,
      processor: context.processor,
    };

    // Check if recommendation already exists
    const existing =
      await this.pocketbaseService.timelineRecommendationMutator.getFirstByFilter(
        `queryHash = "${queryHash}" && MediaClipRef = "${candidate.clipId}"`
      );

    if (existing) {
      // Update existing recommendation
      await this.pocketbaseService.timelineRecommendationMutator.update(
        existing.id,
        input
      );
      return 'updated';
    } else {
      // Create new recommendation
      await this.pocketbaseService.timelineRecommendationMutator.create(input);
      return 'created';
    }
  }

  /**
   * Prune excess recommendations beyond the keepCount limit.
   *
   * Deletes recommendations with rank >= keepCount for the given queryHash,
   * excluding materialized recommendations.
   *
   * @param queryHash - Query hash
   * @param keepCount - Number of recommendations to keep
   * @param materializedIds - IDs of materialized recommendations to preserve
   * @returns Number of recommendations pruned
   */
  private async pruneExcess(
    queryHash: string,
    keepCount: number,
    materializedIds: string[]
  ): Promise<number> {
    // Get all recommendations for this queryHash sorted by rank
    const allRecs =
      await this.pocketbaseService.timelineRecommendationMutator.getByQueryHash(
        queryHash,
        {},
        1,
        1000
      );

    // Find recommendations beyond the keepCount limit, excluding materialized
    const toDelete = allRecs.items.filter(
      (rec) => rec.rank >= keepCount && !materializedIds.includes(rec.id)
    );

    // Delete excess recommendations
    for (const rec of toDelete) {
      await this.pocketbaseService.timelineRecommendationMutator.delete(rec.id);
    }

    return toDelete.length;
  }

  /**
   * Recompute ranks to ensure contiguous ordering.
   *
   * Fetches all recommendations for the queryHash, sorts by score descending,
   * and updates ranks to be contiguous (0, 1, 2, ...), excluding materialized
   * recommendations which keep their original ranks.
   *
   * @param queryHash - Query hash
   * @param materializedIds - IDs of materialized recommendations to preserve
   */
  private async recomputeRanks(
    queryHash: string,
    materializedIds: string[]
  ): Promise<void> {
    // Get all recommendations for this queryHash
    const allRecs =
      await this.pocketbaseService.timelineRecommendationMutator.getByQueryHash(
        queryHash,
        {},
        1,
        1000
      );

    // Separate materialized and non-materialized recommendations
    // const materialized = allRecs.items.filter((rec) =>
    //   materializedIds.includes(rec.id)
    // );
    const nonMaterialized = allRecs.items.filter(
      (rec) => !materializedIds.includes(rec.id)
    );

    // Sort non-materialized by score descending
    const sorted = [...nonMaterialized].sort((a, b) => b.score - a.score);

    // Update ranks to be contiguous for non-materialized
    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i];
      if (rec.rank !== i) {
        // Only update if rank has changed
        await this.pocketbaseService.timelineRecommendationMutator.update(
          rec.id,
          { rank: i }
        );
      }
    }

    // Materialized recommendations keep their original ranks
    // (no updates needed for them)
  }

  /**
   * Identify materialized recommendations to skip during updates.
   *
   * Materialized recommendations are those that have been accepted (acceptedAt is set).
   * These should be preserved and not modified during regeneration.
   *
   * @param queryHash - Query hash
   * @returns Array of recommendation IDs that are materialized
   */
  private async skipMaterialized(queryHash: string): Promise<string[]> {
    // Get all recommendations for this queryHash that have been accepted
    const accepted =
      await this.pocketbaseService.timelineRecommendationMutator.getByQueryHash(
        queryHash,
        { excludeAccepted: false }, // Include accepted
        1,
        1000
      );

    // Filter to only those with acceptedAt set
    const materialized = accepted.items.filter((rec) => rec.acceptedAt);

    return materialized.map((rec) => rec.id);
  }
}
