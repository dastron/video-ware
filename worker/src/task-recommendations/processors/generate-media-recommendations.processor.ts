/**
 * Generate Media Recommendations Processor
 *
 * This processor orchestrates the generation of media-level recommendations.
 * It loads context data (media, labels), executes enabled strategies,
 * applies filters, and writes recommendations using MediaRecommendationWriter.
 *
 * Requirements: 9.1, 9.3, 9.5
 */

import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import {
  BaseSimpleProcessor,
  type SimpleJobData,
} from '../../queue/processors/base-simple.processor';
import type { StepResult } from '../../queue/types/job.types';
import type {
  GenerateMediaRecommendationsStepInput,
  GenerateMediaRecommendationsResult,
} from '../types';
import {
  SameEntityStrategy,
  AdjacentShotStrategy,
  TemporalNearbyStrategy,
  ConfidenceDurationStrategy,
  ScoreCombiner,
  type MediaStrategyContext,
  type ScoredMediaCandidate,
} from '../strategies';
import { MediaRecommendationWriter } from '../utils/media-recommendation-writer';
import {
  RecommendationStrategy,
  LabelType,
  buildMediaQueryHash,
} from '@project/shared';

/**
 * Processor for generate_media_recommendations tasks
 *
 * This is a simple (non-flow) job processor that generates media-level recommendations.
 *
 * Key features:
 * - Loads media and label data from PocketBase
 * - Executes enabled recommendation strategies
 * - Combines scores from multiple strategies
 * - Applies filter parameters
 * - Writes recommendations with upsert and pruning
 * - Returns result with generated and pruned counts
 *
 * Idempotency:
 * - Job data contains only configuration (workspace, media, strategies, etc.)
 * - Checks for existing recommendations via queryHash before generating
 * - Recommendations are stored in database, not in job data
 * - Can be safely retried without side effects
 */
export class GenerateMediaRecommendationsProcessor extends BaseSimpleProcessor<
  SimpleJobData,
  GenerateMediaRecommendationsResult
> {
  protected readonly logger = new Logger(
    GenerateMediaRecommendationsProcessor.name
  );
  protected readonly pocketbaseService: PocketBaseService;

  // Strategy instances
  private readonly sameEntityStrategy: SameEntityStrategy;
  private readonly adjacentShotStrategy: AdjacentShotStrategy;
  private readonly temporalNearbyStrategy: TemporalNearbyStrategy;
  private readonly confidenceDurationStrategy: ConfidenceDurationStrategy;

  constructor(pocketbaseService: PocketBaseService) {
    super();
    this.pocketbaseService = pocketbaseService;

    // Initialize strategies
    this.sameEntityStrategy = new SameEntityStrategy();
    this.adjacentShotStrategy = new AdjacentShotStrategy();
    this.temporalNearbyStrategy = new TemporalNearbyStrategy();
    this.confidenceDurationStrategy = new ConfidenceDurationStrategy();
  }

  /**
   * Process method - generates media recommendations
   * Called by BaseSimpleProcessor with automatic status updates
   */
  async process(
    job: Job<SimpleJobData>
  ): Promise<GenerateMediaRecommendationsResult> {
    const { input } = job.data;
    const stepInput = input as GenerateMediaRecommendationsStepInput;

    this.logger.log(
      `Generating media recommendations for media ${stepInput.mediaId}`
    );

    // Execute recommendation generation
    // BaseSimpleProcessor handles status updates and error handling
    return this.generateRecommendations(stepInput, job);
  }

  /**
   * Generate media recommendations
   *
   * Process:
   * 1. Load context data (media, labels, existing clips)
   * 2. Execute enabled strategies
   * 3. Combine scores from multiple strategies
   * 4. Apply filter parameters
   * 5. Write recommendations with upsert and pruning
   * 6. Return result with counts
   */
  private async generateRecommendations(
    input: GenerateMediaRecommendationsStepInput,
    job: Job
  ): Promise<GenerateMediaRecommendationsResult> {
    const {
      workspaceId,
      mediaId,
      strategies,
      strategyWeights,
      filterParams,
      maxResults = 20,
    } = input;

    this.logger.log(
      `Generating media recommendations for media ${mediaId} with strategies: ${strategies.join(', ')}`
    );

    // Report progress: Loading context
    await job.updateProgress(10);

    // Load context data
    const context = await this.loadContext(
      workspaceId,
      mediaId,
      filterParams || {}
    );

    this.logger.debug(
      `Loaded context: ${context.labelClips.length} label clips, ${context.labelEntities.length} entities, ${context.existingClips.length} existing clips`
    );

    // Report progress: Executing strategies
    await job.updateProgress(30);

    // Execute strategies and collect candidates
    const candidatesByStrategy = new Map<
      RecommendationStrategy,
      ScoredMediaCandidate[]
    >();

    for (const strategy of strategies) {
      const candidates = await this.executeStrategy(strategy, context);
      candidatesByStrategy.set(strategy, candidates);

      this.logger.debug(
        `Strategy ${strategy} generated ${candidates.length} candidates`
      );
    }

    // Report progress: Combining scores
    await job.updateProgress(60);

    // Combine scores from multiple strategies
    const combinedCandidates = this.combineCandidates(
      candidatesByStrategy,
      strategyWeights || {}
    );

    this.logger.debug(
      `Combined ${combinedCandidates.length} candidates from ${strategies.length} strategies`
    );

    // Report progress: Writing recommendations
    await job.updateProgress(80);

    // Build query hash for deduplication
    const queryHash = buildMediaQueryHash({
      workspaceId,
      mediaId,
      mediaVersion: context.media.version || 1,
      strategies,
      filterParams: filterParams || {},
    });

    // Write recommendations
    const writer = new MediaRecommendationWriter(
      this.pocketbaseService,
      maxResults
    );

    const writeResult = await writer.write(queryHash, combinedCandidates, {
      workspaceId,
      mediaId,
      queryHash,
      version: 1,
      processor: 'generate-media-recommendations-v1',
    });

    this.logger.log(
      `Wrote ${writeResult.total} recommendations: ${writeResult.created} created, ${writeResult.updated} updated, ${writeResult.pruned} pruned`
    );

    // Report progress: Complete
    await job.updateProgress(100);

    return {
      generated: writeResult.created + writeResult.updated,
      pruned: writeResult.pruned,
      queryHash,
    };
  }

  /**
   * Load context data for recommendation generation
   */
  private async loadContext(
    workspaceId: string,
    mediaId: string,
    filterParams: NonNullable<
      GenerateMediaRecommendationsStepInput['filterParams']
    >
  ): Promise<MediaStrategyContext> {
    // Load workspace
    const workspace =
      await this.pocketbaseService.workspaceMutator.getById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Load media
    const media = await this.pocketbaseService.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media ${mediaId} not found`);
    }

    // Load label clips for this media
    const labelClipsResult =
      await this.pocketbaseService.labelClipMutator.getByMedia(mediaId);
    const labelClips = labelClipsResult.items;

    // Load label entities referenced by label clips
    const entityIds = new Set(
      labelClips
        .map((lc) => lc.LabelEntityRef)
        .filter((id): id is string => !!id)
    );

    const labelEntities = await Promise.all(
      Array.from(entityIds).map((id) =>
        this.pocketbaseService.labelEntityMutator.getById(id)
      )
    ).then((entities) =>
      entities.filter((e): e is NonNullable<typeof e> => !!e)
    );

    // Load existing media clips for this media
    const existingClipsResult =
      await this.pocketbaseService.mediaClipMutator.getByMedia(mediaId);
    const existingClips = existingClipsResult.items;

    return {
      workspace,
      media,
      labelClips,
      labelEntities,
      existingClips,
      filterParams,
    };
  }

  /**
   * Execute a single strategy
   */
  private async executeStrategy(
    strategy: RecommendationStrategy,
    context: MediaStrategyContext
  ): Promise<ScoredMediaCandidate[]> {
    switch (strategy) {
      case RecommendationStrategy.SAME_ENTITY:
        return this.sameEntityStrategy.executeForMedia(context);

      case RecommendationStrategy.ADJACENT_SHOT:
        return this.adjacentShotStrategy.executeForMedia(context);

      case RecommendationStrategy.TEMPORAL_NEARBY:
        return this.temporalNearbyStrategy.executeForMedia(context);

      case RecommendationStrategy.CONFIDENCE_DURATION:
        return this.confidenceDurationStrategy.executeForMedia(context);

      default:
        this.logger.warn(`Unknown strategy: ${strategy}, skipping`);
        return [];
    }
  }

  /**
   * Combine candidates from multiple strategies
   *
   * Uses ScoreCombiner to merge candidates with the same segment (start, end).
   * Applies strategy weights if provided.
   */
  private combineCandidates(
    candidatesByStrategy: Map<RecommendationStrategy, ScoredMediaCandidate[]>,
    strategyWeights: Partial<Record<RecommendationStrategy, number>>
  ): Array<{
    start: number;
    end: number;
    clipId?: string;
    score: number;
    reason: string;
    reasonData: Record<string, unknown>;
    labelType: LabelType;
    strategy: RecommendationStrategy;
  }> {
    // Use ScoreCombiner to combine candidates from multiple strategies
    const scoreCombiner = new ScoreCombiner(strategyWeights);
    const combinedCandidates =
      scoreCombiner.combineMediaCandidates(candidatesByStrategy);

    // Convert to writer format
    return combinedCandidates.map((candidate) => ({
      start: candidate.start,
      end: candidate.end,
      clipId: candidate.clipId,
      score: candidate.score,
      reason: candidate.reason,
      reasonData: candidate.reasonData as Record<string, unknown>,
      labelType: candidate.labelType,
      strategy: RecommendationStrategy.SAME_ENTITY, // Default strategy for combined results
    }));
  }
}
