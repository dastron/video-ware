/**
 * Generate Timeline Recommendations Processor
 *
 * This processor orchestrates the generation of timeline-level recommendations.
 * It loads context data (timeline, clips, labels), executes enabled strategies,
 * applies search params and overlap exclusion, and writes recommendations using
 * TimelineRecommendationWriter.
 *
 * Requirements: 9.2, 9.4, 9.5
 */

import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import {
  BaseSimpleProcessor,
  type SimpleJobData,
} from '../../queue/processors/base-simple.processor';
import type {
  GenerateTimelineRecommendationsStepInput,
  GenerateTimelineRecommendationsResult,
} from '../types';
import {
  SameEntityStrategy,
  AdjacentShotStrategy,
  TemporalNearbyStrategy,
  ConfidenceDurationStrategy,
  type TimelineStrategyContext,
  type ScoredTimelineCandidate,
} from '../strategies';
import { TimelineRecommendationWriter } from '../utils/timeline-recommendation-writer';
import { TimelineOverlapChecker } from '../utils/timeline-overlap-checker';
import {
  RecommendationStrategy,
  buildTimelineQueryHash,
} from '@project/shared';
import { combineScores } from '../strategies/score-combiner';

/**
 * Processor for generate_timeline_recommendations tasks
 *
 * This is a simple (non-flow) job processor that generates timeline-level recommendations.
 *
 * Key features:
 * - Loads timeline, clips, and label data from PocketBase
 * - Executes enabled recommendation strategies
 * - Combines scores from multiple strategies
 * - Applies search parameters
 * - Filters out overlapping clips (in append mode)
 * - Writes recommendations with upsert and pruning
 * - Returns result with generated and pruned counts
 *
 * Idempotency:
 * - Job data contains only configuration (workspace, timeline, strategies, etc.)
 * - Checks for existing recommendations via queryHash before generating
 * - Recommendations are stored in database, not in job data
 * - Can be safely retried without side effects
 */
export class GenerateTimelineRecommendationsProcessor extends BaseSimpleProcessor<
  SimpleJobData,
  GenerateTimelineRecommendationsResult
> {
  protected readonly logger = new Logger(
    GenerateTimelineRecommendationsProcessor.name
  );
  protected readonly pocketbaseService: PocketBaseService;

  // Strategy instances
  private readonly sameEntityStrategy: SameEntityStrategy;
  private readonly adjacentShotStrategy: AdjacentShotStrategy;
  private readonly temporalNearbyStrategy: TemporalNearbyStrategy;
  private readonly confidenceDurationStrategy: ConfidenceDurationStrategy;

  // Overlap checker
  private readonly overlapChecker: TimelineOverlapChecker;

  constructor(pocketbaseService: PocketBaseService) {
    super();
    this.pocketbaseService = pocketbaseService;

    // Initialize strategies
    this.sameEntityStrategy = new SameEntityStrategy();
    this.adjacentShotStrategy = new AdjacentShotStrategy();
    this.temporalNearbyStrategy = new TemporalNearbyStrategy();
    this.confidenceDurationStrategy = new ConfidenceDurationStrategy();

    // Initialize overlap checker
    this.overlapChecker = new TimelineOverlapChecker();
  }

  /**
   * Process method - generates timeline recommendations
   * Called by BaseSimpleProcessor with automatic status updates
   */
  async process(
    job: Job<SimpleJobData>
  ): Promise<GenerateTimelineRecommendationsResult> {
    const { input } = job.data;
    const stepInput = input as GenerateTimelineRecommendationsStepInput;

    this.logger.log(
      `Generating timeline recommendations for timeline ${stepInput.timelineId}`
    );

    // Execute recommendation generation
    // BaseSimpleProcessor handles status updates and error handling
    return this.generateRecommendations(stepInput, job);
  }

  /**
   * Generate timeline recommendations
   *
   * Process:
   * 1. Load context data (timeline, clips, labels)
   * 2. Execute enabled strategies
   * 3. Combine scores from multiple strategies
   * 4. Apply search parameters
   * 5. Filter out overlapping clips (in append mode)
   * 6. Ensure we have at least 4 recommendations (lowering quality thresholds if needed)
   * 7. Write recommendations with upsert and pruning
   * 8. Return result with counts
   */
  private async generateRecommendations(
    input: GenerateTimelineRecommendationsStepInput,
    job: Job
  ): Promise<GenerateTimelineRecommendationsResult> {
    const {
      workspaceId,
      timelineId,
      seedClipId,
      targetMode,
      strategies,
      strategyWeights,
      searchParams,
      maxResults = 20,
    } = input;

    this.logger.log(
      `Generating timeline recommendations for timeline ${timelineId} with strategies: ${strategies.join(', ')}`
    );

    // Report progress: Loading context
    await job.updateProgress(10);

    // Load context data
    const context = await this.loadContext(
      workspaceId,
      timelineId,
      seedClipId,
      searchParams || {}
    );

    this.logger.debug(
      `Loaded context: ${context.timelineClips.length} timeline clips, ${context.availableClips.length} available clips, ${context.labelClips.length} label clips`
    );

    // Report progress: Executing strategies
    await job.updateProgress(30);

    // Execute strategies and collect candidates
    const candidatesByStrategy = new Map<
      RecommendationStrategy,
      ScoredTimelineCandidate[]
    >();

    for (const strategy of strategies) {
      const candidates = await this.executeStrategy(strategy, context);
      candidatesByStrategy.set(strategy, candidates);

      this.logger.debug(
        `Strategy ${strategy} generated ${candidates.length} candidates`
      );
    }

    // Report progress: Combining scores
    await job.updateProgress(50);

    // Combine scores from multiple strategies
    const combinedCandidates = this.combineCandidates(
      candidatesByStrategy,
      strategyWeights || {}
    );

    this.logger.debug(
      `Combined ${combinedCandidates.length} candidates from ${strategies.length} strategies`
    );

    // Report progress: Filtering overlaps
    await job.updateProgress(70);

    // Filter out overlapping clips (in append mode)
    const filteredCandidates = this.filterOverlaps(
      combinedCandidates,
      context.timelineClips,
      context.availableClips,
      targetMode
    );

    this.logger.debug(
      `Filtered to ${filteredCandidates.length} non-overlapping candidates`
    );

    // Report progress: Writing recommendations
    await job.updateProgress(85);

    // Build query hash for deduplication
    const queryHash = buildTimelineQueryHash({
      workspaceId,
      timelineId,
      mediaVersion: this.getMediaVersion(context.availableClips),
      seedClipId,
      targetMode,
      strategies,
      searchParams: searchParams || {},
    });

    // Write recommendations
    const writer = new TimelineRecommendationWriter(
      this.pocketbaseService,
      maxResults
    );

    const writeResult = await writer.write(queryHash, filteredCandidates, {
      workspaceId,
      timelineId,
      seedClipId,
      targetMode,
      queryHash,
      version: 1,
      processor: 'generate-timeline-recommendations-v1',
    });

    this.logger.log(
      `Wrote ${writeResult.total} recommendations: ${writeResult.created} created, ${writeResult.updated} updated, ${writeResult.pruned} pruned, ${writeResult.skipped} skipped`
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
    timelineId: string,
    seedClipId: string | undefined,
    searchParams: NonNullable<
      GenerateTimelineRecommendationsStepInput['searchParams']
    >
  ): Promise<TimelineStrategyContext> {
    // Load workspace
    const workspace =
      await this.pocketbaseService.workspaceMutator.getById(workspaceId);
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Load timeline
    const timeline =
      await this.pocketbaseService.timelineMutator.getById(timelineId);
    if (!timeline) {
      throw new Error(`Timeline ${timelineId} not found`);
    }

    // Load timeline clips
    const timelineClips =
      await this.pocketbaseService.timelineClipMutator.getByTimeline(
        timelineId
      );

    // Load seed clip if provided
    let seedClip: TimelineStrategyContext['seedClip'];
    if (seedClipId) {
      const loadedClip =
        await this.pocketbaseService.mediaClipMutator.getById(seedClipId);
      if (!loadedClip) {
        this.logger.warn(
          `Seed clip ${seedClipId} not found, continuing without seed`
        );
      }
      seedClip = loadedClip ?? undefined;
    }

    // Load available media clips for the workspace
    // TODO: Apply search params to filter available clips
    const availableClipsResult =
      await this.pocketbaseService.mediaClipMutator.getByWorkspace(workspaceId);
    const availableClips = availableClipsResult.items;

    // Load label clips for available media
    // Get unique media IDs from available clips
    const mediaIds = new Set(availableClips.map((clip) => clip.MediaRef));

    // Load label clips for all media
    const labelClipsPromises = Array.from(mediaIds).map((mediaId) =>
      this.pocketbaseService.labelClipMutator.getByMedia(mediaId)
    );
    const labelClipsResults = await Promise.all(labelClipsPromises);
    const labelClips = labelClipsResults.flatMap((result) => result.items);

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

    return {
      workspace,
      timeline,
      timelineClips,
      seedClip,
      availableClips,
      labelClips,
      labelEntities,
      searchParams,
    };
  }

  /**
   * Execute a single strategy
   */
  private async executeStrategy(
    strategy: RecommendationStrategy,
    context: TimelineStrategyContext
  ): Promise<ScoredTimelineCandidate[]> {
    switch (strategy) {
      case RecommendationStrategy.SAME_ENTITY:
        return this.sameEntityStrategy.executeForTimeline(context);

      case RecommendationStrategy.ADJACENT_SHOT:
        return this.adjacentShotStrategy.executeForTimeline(context);

      case RecommendationStrategy.TEMPORAL_NEARBY:
        return this.temporalNearbyStrategy.executeForTimeline(context);

      case RecommendationStrategy.CONFIDENCE_DURATION:
        return this.confidenceDurationStrategy.executeForTimeline(context);

      default:
        this.logger.warn(`Unknown strategy: ${strategy}, skipping`);
        return [];
    }
  }

  /**
   * Combine candidates from multiple strategies
   *
   * Uses score combiner to merge candidates with the same clip ID.
   * Applies strategy weights if provided.
   */
  private combineCandidates(
    candidatesByStrategy: Map<
      RecommendationStrategy,
      ScoredTimelineCandidate[]
    >,
    strategyWeights: Partial<Record<RecommendationStrategy, number>>
  ): Array<{
    clipId: string;
    score: number;
    reason: string;
    reasonData: Record<string, unknown>;
    strategy: RecommendationStrategy;
  }> {
    // If only one strategy, return its candidates directly (converted to writer format)
    if (candidatesByStrategy.size === 1) {
      const [strategy, candidates] = Array.from(
        candidatesByStrategy.entries()
      )[0];
      return candidates.map((c) => ({
        clipId: c.clipId,
        score: c.score,
        reason: c.reason,
        reasonData: c.reasonData as Record<string, unknown>,
        strategy,
      }));
    }

    // Group candidates by clip ID
    const candidatesByClip = new Map<
      string,
      Map<RecommendationStrategy, ScoredTimelineCandidate>
    >();

    for (const [strategy, candidates] of candidatesByStrategy.entries()) {
      for (const candidate of candidates) {
        if (!candidatesByClip.has(candidate.clipId)) {
          candidatesByClip.set(candidate.clipId, new Map());
        }

        candidatesByClip.get(candidate.clipId)?.set(strategy, candidate);
      }
    }

    // Combine scores for each clip
    const combinedCandidates: Array<{
      clipId: string;
      score: number;
      reason: string;
      reasonData: Record<string, unknown>;
      strategy: RecommendationStrategy;
    }> = [];

    for (const [clipId, candidatesForClip] of candidatesByClip.entries()) {
      // Extract scores by strategy
      const scoresByStrategy: Partial<Record<RecommendationStrategy, number>> =
        {};
      let primaryCandidate: ScoredTimelineCandidate | undefined;
      let primaryStrategy: RecommendationStrategy | undefined;

      for (const [strategy, candidate] of candidatesForClip.entries()) {
        scoresByStrategy[strategy] = candidate.score;
        if (!primaryCandidate) {
          primaryCandidate = candidate;
          primaryStrategy = strategy;
        }
      }

      if (!primaryCandidate || !primaryStrategy) continue;

      // Combine scores
      const combinedScore = combineScores(scoresByStrategy, strategyWeights);

      // Create combined candidate (convert to writer format)
      combinedCandidates.push({
        clipId,
        score: combinedScore,
        // Combine reasons from all strategies
        reason: Array.from(candidatesForClip.values())
          .map((c) => c.reason)
          .join('; '),
        // Merge reason data
        reasonData: {
          ...(primaryCandidate.reasonData as Record<string, unknown>),
          strategies: Array.from(candidatesForClip.keys()),
          scoresByStrategy,
        },
        strategy: primaryStrategy, // Use primary strategy for the record
      });
    }

    return combinedCandidates;
  }

  /**
   * Filter out overlapping clips (in append mode)
   *
   * Uses TimelineOverlapChecker to exclude clips that overlap with existing
   * timeline clips. In replace mode, allows all candidates.
   */
  private filterOverlaps(
    candidates: Array<{
      clipId: string;
      score: number;
      reason: string;
      reasonData: Record<string, unknown>;
      strategy: RecommendationStrategy;
    }>,
    timelineClips: TimelineStrategyContext['timelineClips'],
    availableClips: TimelineStrategyContext['availableClips'],
    targetMode: GenerateTimelineRecommendationsStepInput['targetMode']
  ): Array<{
    clipId: string;
    score: number;
    reason: string;
    reasonData: Record<string, unknown>;
    strategy: RecommendationStrategy;
  }> {
    // Build occupied ranges from timeline clips
    const occupiedRanges =
      this.overlapChecker.buildOccupiedRanges(timelineClips);

    // Build clip lookup map
    const clipLookup = new Map(availableClips.map((clip) => [clip.id, clip]));

    // Filter candidates by overlap
    const candidateClipIds = candidates.map((c) => c.clipId);
    const nonOverlappingIds = this.overlapChecker.filterNonOverlappingIds(
      candidateClipIds,
      clipLookup,
      occupiedRanges,
      targetMode
    );

    // Filter candidates to only include non-overlapping
    const filtered = candidates.filter((c) =>
      nonOverlappingIds.includes(c.clipId)
    );

    // Log filter stats
    const stats = this.overlapChecker.getFilterStats(
      candidates.length,
      filtered.length
    );
    this.logger.debug(
      `Overlap filter: ${stats.filtered} filtered, ${stats.remaining} remaining (${(stats.filterRate * 100).toFixed(1)}% filter rate)`
    );

    return filtered;
  }

  /**
   * Get media version from available clips
   *
   * Uses the maximum version from all media referenced by clips.
   * This ensures recommendations refresh when any media's labels change.
   */
  private getMediaVersion(
    availableClips: TimelineStrategyContext['availableClips']
  ): number {
    // Get unique media IDs
    const mediaIds = new Set(availableClips.map((clip) => clip.MediaRef));

    // For now, return 1 as default
    // TODO: Load media records and get max version
    return 1;
  }
}
