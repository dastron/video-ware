import type { TypedPocketBase } from '@project/shared/types';
import {
  MediaMutator,
  TimelineMutator,
  TimelineClipMutator,
  MediaClipMutator,
  LabelClipMutator,
  LabelEntityMutator,
  MediaRecommendationMutator,
  TimelineRecommendationMutator,
} from '@project/shared/mutator';
import {
  RecommendationStrategy,
  RecommendationTargetMode,
  type MediaClip,
  type LabelEntity,
  type Workspace,
  type MediaRecommendation,
  type TimelineRecommendation,
  buildMediaQueryHash,
  buildTimelineQueryHash,
} from '@project/shared';

import { StrategyRegistry, ScoreCombiner } from './recommendations/strategies';
import type {
  FilterParams,
  SearchParams,
  MediaStrategyContext,
  TimelineStrategyContext,
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './recommendations/types';

/**
 * Recommendation service that provides on-demand recommendations
 * using a pluggable strategy pattern.
 */
export class RecommendationService {
  private labelClipMutator: LabelClipMutator;
  private labelEntityMutator: LabelEntityMutator;
  private mediaRecommendationMutator: MediaRecommendationMutator;
  private timelineRecommendationMutator: TimelineRecommendationMutator;

  private registry: StrategyRegistry;
  private combiner: ScoreCombiner;

  private _pb: TypedPocketBase;

  constructor(pb: TypedPocketBase) {
    this._pb = pb;
    this.labelClipMutator = new LabelClipMutator(pb);
    this.labelEntityMutator = new LabelEntityMutator(pb);
    this.mediaRecommendationMutator = new MediaRecommendationMutator(pb);
    this.timelineRecommendationMutator = new TimelineRecommendationMutator(pb);

    this.registry = new StrategyRegistry();
    this.combiner = new ScoreCombiner();
  }

  private get pb(): TypedPocketBase {
    return this._pb;
  }

  /**
   * Get media-level recommendations (segments)
   */
  async getMediaRecommendations(
    workspaceId: string,
    mediaId: string,
    filterParams: FilterParams = {},
    maxResults: number = 10,
    forceRefresh: boolean = false
  ): Promise<MediaRecommendation[]> {
    const context = await this.loadMediaContext(
      workspaceId,
      mediaId,
      filterParams
    );
    const strategies = this.registry.getAll();

    const queryHash = buildMediaQueryHash({
      workspaceId,
      mediaId,
      mediaVersion: context.media.version || 1,
      strategies: strategies.map((s) => s.name),
      filterParams,
    });

    // Check cache unless forceRefresh is true
    if (!forceRefresh) {
      const cached = await this.mediaRecommendationMutator.getTopByQueryHash(
        queryHash,
        maxResults
      );
      if (cached.length > 0) {
        return cached;
      }
    }

    const candidatesByStrategy = new Map<
      RecommendationStrategy,
      ScoredMediaCandidate[]
    >();

    for (const strategy of strategies) {
      const candidates = await strategy.executeForMedia(context);
      candidatesByStrategy.set(strategy.name, candidates);
    }

    const combined = this.combiner.combineMediaCandidates(candidatesByStrategy);

    // Final filtering and sorting
    let filtered = combined;
    if (filterParams.durationRange?.max) {
      filtered = filtered.filter(
        (c) => c.end - c.start <= filterParams.durationRange!.max!
      );
    }

    const ranked = filtered
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Persist recommendations
    const persisted = await Promise.all(
      ranked.map((c, index) =>
        this.mediaRecommendationMutator.upsert({
          WorkspaceRef: workspaceId,
          MediaRef: mediaId,
          start: c.start,
          end: c.end,
          MediaClipRef: c.clipId,
          score: c.score,
          rank: index,
          reason: c.reason,
          reasonData: c.reasonData,
          strategy: RecommendationStrategy.SAME_ENTITY, // Default for combined
          labelType: c.labelType,
          queryHash,
          version: 1,
        })
      )
    );

    return persisted;
  }

  /**
   * Get timeline-level recommendations
   */
  async getTimelineRecommendations(
    workspaceId: string,
    timelineId: string,
    seedClipId?: string,
    searchParams: SearchParams = {},
    maxResults: number = 10,
    forceRefresh: boolean = false
  ): Promise<TimelineRecommendation[]> {
    const context = await this.loadTimelineContext(
      workspaceId,
      timelineId,
      seedClipId,
      searchParams
    );
    const strategies = this.registry.getAll();

    // Calculate query hash for caching
    const queryHash = buildTimelineQueryHash({
      workspaceId,
      timelineId,
      mediaVersion: 1, // Default for now
      seedClipId,
      targetMode: RecommendationTargetMode.APPEND, // Default for now
      strategies: strategies.map((s) => s.name),
      searchParams,
    });

    // Check cache
    if (!forceRefresh) {
      const cached = await this.timelineRecommendationMutator.getTopByQueryHash(
        queryHash,
        maxResults
      );
      if (cached.length > 0) {
        return cached;
      }
    }

    const candidatesByStrategy = new Map<
      RecommendationStrategy,
      ScoredTimelineCandidate[]
    >();

    for (const strategy of strategies) {
      const candidates = await strategy.executeForTimeline(context);
      candidatesByStrategy.set(strategy.name, candidates);
    }

    const combined =
      this.combiner.combineTimelineCandidates(candidatesByStrategy);

    // Filter out duplicates (clips already in timeline)
    const timelineClipIds = new Set(
      context.timelineClips.map((tc) => tc.MediaClipRef)
    );
    const uniqueCandidates = combined.filter(
      (c) => !timelineClipIds.has(c.clipId)
    );

    const ranked = uniqueCandidates
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    // Persist recommendations
    const persisted = await Promise.all(
      ranked.map((c, index) =>
        this.timelineRecommendationMutator.upsert({
          WorkspaceRef: workspaceId,
          TimelineRef: timelineId,
          SeedClipRef: seedClipId,
          MediaClipRef: c.clipId,
          score: c.score,
          rank: index,
          reason: c.reason,
          reasonData: c.reasonData,
          strategy: RecommendationStrategy.SAME_ENTITY, // Default for combined
          targetMode: RecommendationTargetMode.APPEND,
          queryHash,
          version: 1,
        })
      )
    );

    return persisted;
  }

  /**
   * Get replacement recommendations for a specific timeline clip
   */
  async getTimelineClipReplacementRecommendations(
    workspaceId: string,
    timelineId: string,
    timelineClipId: string
  ): Promise<TimelineRecommendation[]> {
    const timelineClipMutator = new TimelineClipMutator(this.pb);
    const timelineClip = await timelineClipMutator.getById(timelineClipId);
    if (!timelineClip || !timelineClip.MediaClipRef) {
      throw new Error(
        `Timeline clip ${timelineClipId} not found or has no media clip reference`
      );
    }

    return this.getTimelineRecommendations(
      workspaceId,
      timelineId,
      timelineClip.MediaClipRef,
      {}
    );
  }

  private async loadMediaContext(
    workspaceId: string,
    mediaId: string,
    filterParams: FilterParams
  ): Promise<MediaStrategyContext> {
    const workspace = { id: workspaceId, name: 'Workspace' } as Workspace;
    const mediaMutator = new MediaMutator(this.pb);
    const media = await mediaMutator.getById(mediaId);
    if (!media) throw new Error(`Media ${mediaId} not found`);

    const labelClipsResult = await this.labelClipMutator.getByMedia(mediaId);
    const labelClips = labelClipsResult.items;

    const entityIds = new Set(
      labelClips
        .map((lc) => lc.LabelEntityRef)
        .filter((id): id is string => !!id)
    );
    const labelEntities = await Promise.all(
      Array.from(entityIds).map((id) => this.labelEntityMutator.getById(id))
    ).then((entities) => entities.filter((e): e is LabelEntity => !!e));

    const mediaClipMutator = new MediaClipMutator(this.pb);
    const existingClipsResult = await mediaClipMutator.getByMedia(mediaId);
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

  private async loadTimelineContext(
    workspaceId: string,
    timelineId: string,
    seedClipId: string | undefined,
    searchParams: SearchParams
  ): Promise<TimelineStrategyContext> {
    const workspace = { id: workspaceId, name: 'Workspace' } as Workspace;
    const timelineMutator = new TimelineMutator(this.pb);
    const timeline = await timelineMutator.getById(timelineId);
    if (!timeline) throw new Error(`Timeline ${timelineId} not found`);

    const timelineClipMutator = new TimelineClipMutator(this.pb);
    const timelineClips = await timelineClipMutator.getByTimeline(timelineId);

    const mediaClipMutator = new MediaClipMutator(this.pb);
    let seedClip: MediaClip | undefined;
    if (seedClipId) {
      seedClip = (await mediaClipMutator.getById(seedClipId)) ?? undefined;
    }

    const availableClipsResult =
      await mediaClipMutator.getByWorkspace(workspaceId);
    const availableClips = availableClipsResult.items;

    const mediaIds = new Set(availableClips.map((clip) => clip.MediaRef));
    const labelClipsResults = await Promise.all(
      Array.from(mediaIds).map((id) => this.labelClipMutator.getByMedia(id))
    );
    const labelClips = labelClipsResults.flatMap((r) => r.items);

    const entityIds = new Set(
      labelClips
        .map((lc) => lc.LabelEntityRef)
        .filter((id): id is string => !!id)
    );
    const labelEntities = await Promise.all(
      Array.from(entityIds).map((id) => this.labelEntityMutator.getById(id))
    ).then((entities) => entities.filter((e): e is LabelEntity => !!e));

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
}

export function createRecommendationService(
  pb: TypedPocketBase
): RecommendationService {
  return new RecommendationService(pb);
}
