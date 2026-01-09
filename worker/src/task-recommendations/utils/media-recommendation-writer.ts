import { Logger } from '@nestjs/common';
import {
  type MediaRecommendationInput,
  LabelType,
  RecommendationStrategy,
} from '@project/shared';
import { PocketBaseService } from '../../shared/services/pocketbase.service';

/**
 * Scored candidate for media recommendation
 */
export interface ScoredMediaCandidate {
  start: number;
  end: number;
  clipId?: string; // if matches existing clip
  score: number;
  reason: string;
  reasonData: Record<string, unknown>;
  labelType: LabelType;
  strategy: RecommendationStrategy;
}

/**
 * Context for writing media recommendations
 */
export interface MediaRecommendationContext {
  workspaceId: string;
  mediaId: string;
  queryHash: string;
  version?: number;
  processor?: string;
}

/**
 * Result of write operation
 */
export interface MediaWriteResult {
  created: number;
  updated: number;
  pruned: number;
  total: number;
}

/**
 * MediaRecommendationWriter handles upsert and pruning logic for media recommendations.
 *
 * Key responsibilities:
 * - Upsert recommendations based on queryHash + segment (start, end)
 * - Enforce top-N limit per queryHash
 * - Recompute ranks to maintain contiguous ordering
 *
 * Requirements: 3.1, 3.3, 3.5, 3.7
 */
export class MediaRecommendationWriter {
  private readonly logger = new Logger(MediaRecommendationWriter.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly maxPerContext: number = 20
  ) {}

  /**
   * Write recommendations for a given context.
   *
   * Process:
   * 1. Sort candidates by score (descending)
   * 2. Upsert each candidate with computed rank
   * 3. Prune excess recommendations beyond maxPerContext
   * 4. Recompute ranks to ensure contiguous ordering
   *
   * @param queryHash - Deterministic hash for the query context
   * @param candidates - Scored candidates to write
   * @param context - Context information for the recommendations
   * @returns Write result with counts
   */
  async write(
    queryHash: string,
    candidates: ScoredMediaCandidate[],
    context: MediaRecommendationContext
  ): Promise<MediaWriteResult> {
    this.logger.debug(
      `Writing ${candidates.length} media recommendations for queryHash: ${queryHash}`
    );

    // Sort candidates by score descending
    const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);

    // Take only top maxPerContext candidates
    const topCandidates = sortedCandidates.slice(0, this.maxPerContext);

    let created = 0;
    let updated = 0;

    // Upsert each candidate with its rank
    for (let i = 0; i < topCandidates.length; i++) {
      const candidate = topCandidates[i];
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

    // Prune any excess recommendations beyond maxPerContext
    const pruned = await this.pruneExcess(queryHash, this.maxPerContext);

    // Recompute ranks to ensure contiguous ordering
    await this.recomputeRanks(queryHash);

    const total = topCandidates.length;

    this.logger.debug(
      `Write complete: ${created} created, ${updated} updated, ${pruned} pruned, ${total} total`
    );

    return {
      created,
      updated,
      pruned,
      total,
    };
  }

  /**
   * Upsert a single recommendation.
   *
   * Matches on (queryHash, start, end) for upsert behavior.
   *
   * @param queryHash - Query hash
   * @param candidate - Scored candidate
   * @param rank - Computed rank (0-based)
   * @param context - Context information
   * @returns 'created' or 'updated'
   */
  private async upsertRecommendation(
    queryHash: string,
    candidate: ScoredMediaCandidate,
    rank: number,
    context: MediaRecommendationContext
  ): Promise<'created' | 'updated'> {
    const input: MediaRecommendationInput = {
      WorkspaceRef: context.workspaceId,
      MediaRef: context.mediaId,
      start: candidate.start,
      end: candidate.end,
      MediaClipRef: candidate.clipId,
      score: candidate.score,
      rank,
      reason: candidate.reason,
      reasonData: candidate.reasonData,
      strategy: candidate.strategy,
      labelType: candidate.labelType,
      queryHash,
      version: context.version ?? 1,
      processor: context.processor,
    };

    // Check if recommendation already exists
    const existing =
      await this.pocketbaseService.mediaRecommendationMutator.getFirstByFilter(
        `queryHash = "${queryHash}" && start = ${candidate.start} && end = ${candidate.end}`
      );

    if (existing) {
      // Update existing recommendation
      await this.pocketbaseService.mediaRecommendationMutator.update(
        existing.id,
        input
      );
      return 'updated';
    } else {
      // Create new recommendation
      await this.pocketbaseService.mediaRecommendationMutator.create(input);
      return 'created';
    }
  }

  /**
   * Prune excess recommendations beyond the keepCount limit.
   *
   * Deletes recommendations with rank >= keepCount for the given queryHash.
   *
   * @param queryHash - Query hash
   * @param keepCount - Number of recommendations to keep
   * @returns Number of recommendations pruned
   */
  private async pruneExcess(
    queryHash: string,
    keepCount: number
  ): Promise<number> {
    // Get all recommendations for this queryHash sorted by rank
    const allRecs =
      await this.pocketbaseService.mediaRecommendationMutator.getByQueryHash(
        queryHash,
        {},
        1,
        1000
      );

    // Find recommendations beyond the keepCount limit
    const toDelete = allRecs.items.filter((rec) => rec.rank >= keepCount);

    // Delete excess recommendations
    for (const rec of toDelete) {
      await this.pocketbaseService.mediaRecommendationMutator.delete(rec.id);
    }

    return toDelete.length;
  }

  /**
   * Recompute ranks to ensure contiguous ordering.
   *
   * Fetches all recommendations for the queryHash, sorts by score descending,
   * and updates ranks to be contiguous (0, 1, 2, ...).
   *
   * @param queryHash - Query hash
   */
  private async recomputeRanks(queryHash: string): Promise<void> {
    // Get all recommendations for this queryHash
    const allRecs =
      await this.pocketbaseService.mediaRecommendationMutator.getByQueryHash(
        queryHash,
        {},
        1,
        1000
      );

    // Sort by score descending
    const sorted = [...allRecs.items].sort((a, b) => b.score - a.score);

    // Update ranks to be contiguous
    for (let i = 0; i < sorted.length; i++) {
      const rec = sorted[i];
      if (rec.rank !== i) {
        // Only update if rank has changed
        await this.pocketbaseService.mediaRecommendationMutator.update(rec.id, {
          rank: i,
        });
      }
    }
  }
}
