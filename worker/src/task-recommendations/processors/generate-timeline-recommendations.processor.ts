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

import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '../../queue/queue.constants';
import { RecommendationStepType } from '../../queue/types/step.types';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { BaseParentProcessor } from '../../queue/processors/base-parent.processor';
import type {
  ParentJobData,
  StepJobData,
  StepResult,
} from '../../queue/types/job.types';
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
import { buildTimelineQueryHash } from '../utils/query-hash';
import { RecommendationStrategy } from '@project/shared';
import { combineScores } from '../strategies/score-combiner';

/**
 * Parent processor for generate_timeline_recommendations tasks
 *
 * Key features:
 * - Loads timeline, clips, and label data from PocketBase
 * - Executes enabled recommendation strategies
 * - Combines scores from multiple strategies
 * - Applies search parameters
 * - Filters out overlapping clips (in append mode)
 * - Writes recommendations with upsert and pruning
 * - Returns result with generated and pruned counts
 */
@Processor(QUEUE_NAMES.TIMELINE_RECOMMENDATIONS)
export class GenerateTimelineRecommendationsProcessor extends BaseParentProcessor {
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

  constructor(
    @InjectQueue(QUEUE_NAMES.TIMELINE_RECOMMENDATIONS)
    private readonly recommendationsQueue: Queue,
    pocketbaseService: PocketBaseService
  ) {
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
   * Get the queue instance for accessing child jobs
   */
  protected getQueue(): Queue {
    return this.recommendationsQueue;
  }

  /**
   * Get the total number of steps expected for this task
   * Timeline recommendations has only 1 step: generate recommendations
   */
  protected getTotalSteps(_parentData: ParentJobData): number {
    return 1;
  }

  /**
   * Process parent job - orchestrates recommendation generation
   */
  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { task, stepResults } = job.data;

    this.logger.log(`Processing parent job for task ${task.id}`);

    // Wait for child to complete
    const childrenValues = await job.getChildrenValues();

    this.logger.log(`Child completed for task ${task.id}`, {
      childrenCount: Object.keys(childrenValues).length,
    });

    // Aggregate step results from children
    const aggregatedResults: Record<string, StepResult> = { ...stepResults };

    for (const [, childResult] of Object.entries(childrenValues)) {
      if (
        childResult &&
        typeof childResult === 'object' &&
        'stepType' in childResult
      ) {
        const result = childResult as StepResult;
        aggregatedResults[result.stepType] = result;
      }
    }

    // Cache step results in parent job data
    await job.updateData({
      ...job.data,
      stepResults: aggregatedResults,
    });

    this.logger.log(
      `Cached ${Object.keys(aggregatedResults).length} step results for task ${task.id}`
    );

    // Check if generation succeeded
    const generateResult =
      aggregatedResults[RecommendationStepType.GENERATE_TIMELINE_RECOMMENDATIONS];

    if (generateResult?.status === 'completed') {
      this.logger.log(
        `Task ${task.id} completed successfully: timeline recommendations generated`
      );
    } else {
      this.logger.error(
        `Task ${task.id} failed: timeline recommendations generation failed`
      );
      throw new Error('Timeline recommendations generation failed');
    }
  }

  /**
   * Process step job - generates timeline recommendations
   */
  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input } = job.data;
    const startedAt = new Date();

    this.logger.log(`Processing step ${stepType} for job ${job.id}`);

    try {
      const stepInput = input as GenerateTimelineRecommendationsStepInput;

      // Execute recommendation generation
      const output = await this.generateRecommendations(stepInput, job);

      // Create successful result
      const result: StepResult = {
        stepType,
        status: 'completed',
        output,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      this.logger.log(`Step ${stepType} completed successfully`);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Step ${stepType} failed: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined
      );

      // Create failed result
      const result: StepResult = {
        stepType,
        status: 'failed',
        error: errorMessage,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
      };

      // Re-throw to let BullMQ handle retry logic
      throw error;
    }
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
   * 6. Write recommendations with upsert and pruning
   * 7. Return result with counts
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
    searchParams: NonNullable<GenerateTimelineRecommendationsStepInput['searchParams']>
  ): Promise<TimelineStrategyContext> {
    // Load workspace
    const workspace = await this.pocketbaseService.workspaceMutator.getById(
      workspaceId
    );
    if (!workspace) {
      throw new Error(`Workspace ${workspaceId} not found`);
    }

    // Load timeline
    const timeline = await this.pocketbaseService.timelineMutator.getById(
      timelineId
    );
    if (!timeline) {
      throw new Error(`Timeline ${timelineId} not found`);
    }

    // Load timeline clips
    const timelineClips = await this.pocketbaseService.timelineClipMutator.getByTimeline(
      timelineId
    );

    // Load seed clip if provided
    let seedClip: TimelineStrategyContext['seedClip'];
    if (seedClipId) {
      const loadedClip = await this.pocketbaseService.mediaClipMutator.getById(
        seedClipId
      );
      if (!loadedClip) {
        this.logger.warn(`Seed clip ${seedClipId} not found, continuing without seed`);
      }
      seedClip = loadedClip ?? undefined;
    }

    // Load available media clips for the workspace
    // TODO: Apply search params to filter available clips
    const availableClipsResult = await this.pocketbaseService.mediaClipMutator.getByWorkspace(
      workspaceId
    );
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
    candidatesByStrategy: Map<RecommendationStrategy, ScoredTimelineCandidate[]>,
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
      const [strategy, candidates] = Array.from(candidatesByStrategy.entries())[0];
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

        candidatesByClip.get(candidate.clipId)!.set(strategy, candidate);
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
      const scoresByStrategy: Partial<Record<RecommendationStrategy, number>> = {};
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
    const occupiedRanges = this.overlapChecker.buildOccupiedRanges(timelineClips);

    // Build clip lookup map
    const clipLookup = new Map(
      availableClips.map((clip) => [clip.id, clip])
    );

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
  private getMediaVersion(availableClips: TimelineStrategyContext['availableClips']): number {
    // Get unique media IDs
    const mediaIds = new Set(availableClips.map((clip) => clip.MediaRef));

    // For now, return 1 as default
    // TODO: Load media records and get max version
    return 1;
  }
}
