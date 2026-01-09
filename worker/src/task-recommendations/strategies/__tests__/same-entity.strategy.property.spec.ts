// Property-based tests for same_entity strategy
// Feature: recommendation-engine, Property 9: Same Entity Strategy Correctness

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { SameEntityStrategy } from '../same-entity.strategy';
import {
  MediaStrategyContext,
  TimelineStrategyContext,
} from '../base-strategy';
import {
  LabelType,
  RecommendationStrategy,
  type Workspace,
  type Media,
  type MediaClip,
  type LabelClip,
  type LabelEntity,
  type Timeline,
  type TimelineClip,
  ProcessingProvider,
} from '@project/shared';

// Arbitraries for generating test data
const labelTypeArbitrary = fc.constantFrom(
  LabelType.OBJECT,
  LabelType.SHOT,
  LabelType.PERSON,
  LabelType.SPEECH,
);

// Helper to safely convert dates to ISO strings (filtering out invalid dates)
const validDateToString = fc.date().filter((d) => !isNaN(d.getTime())).map((d) => d.toISOString());

const workspaceArbitrary: fc.Arbitrary<Workspace> = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  slug: fc.option(fc.string({ minLength: 1, maxLength: 50 })),
  settings: fc.constant({}),
  created: validDateToString,
  updated: validDateToString,
  collectionId: fc.constant('workspaces'),
  collectionName: fc.constant('workspaces'),
});

const mediaArbitrary: fc.Arbitrary<Media> = fc.record({
  id: fc.uuid(),
  WorkspaceRef: fc.uuid(),
  UploadRef: fc.uuid(),
  mediaType: fc.constant('video' as const),
  mediaDate: fc.option(validDateToString),
  duration: fc.float({ min: 10, max: 3600 }),
  mediaData: fc.constant({}),
  thumbnailFileRef: fc.option(fc.uuid()),
  spriteFileRef: fc.option(fc.uuid()),
  proxyFileRef: fc.option(fc.uuid()),
  version: fc.integer({ min: 1, max: 10 }),
  processor: fc.option(fc.string()),
  created: validDateToString,
  updated: validDateToString,
  collectionId: fc.constant('media'),
  collectionName: fc.constant('media'),
});

const labelEntityArbitrary: fc.Arbitrary<LabelEntity> = fc.record({
  id: fc.uuid(),
  WorkspaceRef: fc.uuid(),
  labelType: labelTypeArbitrary,
  canonicalName: fc.string({ minLength: 1, maxLength: 50 }),
  provider: fc.constant(ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE),
  processor: fc.string({ minLength: 1, maxLength: 50 }),
  metadata: fc.option(fc.constant({})),
  entityHash: fc.string({ minLength: 32, maxLength: 32 }),
  created: validDateToString,
  updated: validDateToString,
  collectionId: fc.constant('label_entity'),
  collectionName: fc.constant('label_entity'),
});

const labelClipArbitrary = (
  mediaId: string,
  entityId: string,
  labelType: LabelType,
): fc.Arbitrary<LabelClip> =>
  fc.record({
    id: fc.uuid(),
    WorkspaceRef: fc.uuid(),
    MediaRef: fc.constant(mediaId),
    TaskRef: fc.option(fc.uuid()),
    LabelEntityRef: fc.constant(entityId),
    LabelTrackRef: fc.option(fc.uuid()),
    labelHash: fc.string({ minLength: 32, maxLength: 32 }),
    labelType: fc.constant(labelType),
    type: fc.string({ minLength: 1, maxLength: 50 }),
    start: fc.float({ min: 0, max: 100 }),
    end: fc.float({ min: 100, max: 200 }),
    duration: fc.float({ min: 1, max: 100 }),
    confidence: fc.float({ min: 0.5, max: 1.0 }),
    version: fc.integer({ min: 1, max: 10 }),
    processor: fc.string({ minLength: 1, maxLength: 50 }),
    provider: fc.constant(ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE),
    labelData: fc.constant({}),
    created: validDateToString,
    updated: validDateToString,
    collectionId: fc.constant('label_clips'),
    collectionName: fc.constant('label_clips'),
  });

const mediaClipArbitrary = (mediaId: string): fc.Arbitrary<MediaClip> =>
  fc.record({
    id: fc.uuid(),
    WorkspaceRef: fc.uuid(),
    MediaRef: fc.constant(mediaId),
    type: fc.string({ minLength: 1, maxLength: 50 }),
    start: fc.float({ min: 0, max: 100 }),
    end: fc.float({ min: 100, max: 200 }),
    duration: fc.float({ min: 1, max: 100 }),
    clipData: fc.option(fc.constant({})),
    version: fc.integer({ min: 1, max: 10 }),
    processor: fc.option(fc.string()),
    created: validDateToString,
    updated: validDateToString,
    collectionId: fc.constant('media_clips'),
    collectionName: fc.constant('media_clips'),
  });

describe('Same Entity Strategy Properties', () => {
  describe('Property 9: Same Entity Strategy Correctness', () => {
    it('should only recommend segments that share a LabelEntity with seed clip for timeline recommendations', async () => {
      await fc.assert(
        fc.asyncProperty(
          workspaceArbitrary,
          mediaArbitrary,
          labelEntityArbitrary,
          fc.uuid(), // seedClipId
          fc.integer({ min: 2, max: 5 }), // number of clips with shared entity
          async (workspace, media, entity, seedClipId, numSharedClips) => {
            // Create seed clip
            const seedClip: MediaClip = {
              id: seedClipId,
              WorkspaceRef: workspace.id,
              MediaRef: media.id,
              type: 'user',
              start: 0,
              end: 10,
              duration: 10,
              clipData: {},
              version: 1,
              processor: 'test',
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              collectionId: 'media_clips',
              collectionName: 'media_clips',
            };

            // Create label clips for seed clip with the entity
            const seedLabelClips: LabelClip[] = [
              {
                id: fc.sample(fc.uuid(), 1)[0],
                WorkspaceRef: workspace.id,
                MediaRef: media.id,
                TaskRef: undefined,
                LabelEntityRef: entity.id,
                LabelTrackRef: undefined,
                labelHash: fc.sample(fc.string({ minLength: 32, maxLength: 32 }), 1)[0],
                labelType: entity.labelType,
                type: entity.canonicalName,
                start: 0,
                end: 10,
                duration: 10,
                confidence: 0.9,
                version: 1,
                processor: 'test',
                provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                labelData: {},
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                collectionId: 'label_clips',
                collectionName: 'label_clips',
              },
            ];

            // Create available clips - some with shared entity, some without
            const availableClips: MediaClip[] = [];
            const allLabelClips: LabelClip[] = [...seedLabelClips];

            // Clips with shared entity
            for (let i = 0; i < numSharedClips; i++) {
              const clipId = fc.sample(fc.uuid(), 1)[0];
              const clip: MediaClip = {
                id: clipId,
                WorkspaceRef: workspace.id,
                MediaRef: media.id,
                type: 'user',
                start: 20 + i * 20,
                end: 30 + i * 20,
                duration: 10,
                clipData: {},
                version: 1,
                processor: 'test',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                collectionId: 'media_clips',
                collectionName: 'media_clips',
              };
              availableClips.push(clip);

              // Add label clip with shared entity
              allLabelClips.push({
                id: fc.sample(fc.uuid(), 1)[0],
                WorkspaceRef: workspace.id,
                MediaRef: media.id,
                TaskRef: undefined,
                LabelEntityRef: entity.id,
                LabelTrackRef: undefined,
                labelHash: fc.sample(fc.string({ minLength: 32, maxLength: 32 }), 1)[0],
                labelType: entity.labelType,
                type: entity.canonicalName,
                start: clip.start,
                end: clip.end,
                duration: clip.duration,
                confidence: 0.8,
                version: 1,
                processor: 'test',
                provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                labelData: {},
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                collectionId: 'label_clips',
                collectionName: 'label_clips',
              });
            }

            // Clips without shared entity
            const differentEntity: LabelEntity = {
              ...entity,
              id: fc.sample(fc.uuid(), 1)[0],
              canonicalName: 'DifferentEntity',
              entityHash: fc.sample(fc.string({ minLength: 32, maxLength: 32 }), 1)[0],
            };

            for (let i = 0; i < 2; i++) {
              const clipId = fc.sample(fc.uuid(), 1)[0];
              const clip: MediaClip = {
                id: clipId,
                WorkspaceRef: workspace.id,
                MediaRef: media.id,
                type: 'user',
                start: 200 + i * 20,
                end: 210 + i * 20,
                duration: 10,
                clipData: {},
                version: 1,
                processor: 'test',
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                collectionId: 'media_clips',
                collectionName: 'media_clips',
              };
              availableClips.push(clip);

              // Add label clip with different entity
              allLabelClips.push({
                id: fc.sample(fc.uuid(), 1)[0],
                WorkspaceRef: workspace.id,
                MediaRef: media.id,
                TaskRef: undefined,
                LabelEntityRef: differentEntity.id,
                LabelTrackRef: undefined,
                labelHash: fc.sample(fc.string({ minLength: 32, maxLength: 32 }), 1)[0],
                labelType: differentEntity.labelType,
                type: differentEntity.canonicalName,
                start: clip.start,
                end: clip.end,
                duration: clip.duration,
                confidence: 0.8,
                version: 1,
                processor: 'test',
                provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                labelData: {},
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                collectionId: 'label_clips',
                collectionName: 'label_clips',
              });
            }

            const timeline: Timeline = {
              id: fc.sample(fc.uuid(), 1)[0],
              name: 'Test Timeline',
              WorkspaceRef: workspace.id,
              duration: 0,
              editList: undefined,
              UserRef: undefined,
              version: 1,
              processor: undefined,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              collectionId: 'timelines',
              collectionName: 'timelines',
            };

            const context: TimelineStrategyContext = {
              workspace,
              timeline,
              timelineClips: [],
              seedClip,
              availableClips,
              labelClips: allLabelClips,
              labelEntities: [entity, differentEntity],
              searchParams: {},
            };

            const strategy = new SameEntityStrategy();
            const candidates = await strategy.executeForTimeline(context);

            // All recommended clips should share the entity with seed clip
            for (const candidate of candidates) {
              const clip = availableClips.find((c) => c.id === candidate.clipId);
              expect(clip).toBeDefined();

              // Find label clips for this candidate
              const candidateLabelClips = allLabelClips.filter(
                (lc) =>
                  lc.MediaRef === clip!.MediaRef &&
                  lc.start >= clip!.start &&
                  lc.end <= clip!.end,
              );

              // At least one label clip should have the shared entity
              const hasSharedEntity = candidateLabelClips.some(
                (lc) => lc.LabelEntityRef === entity.id,
              );
              expect(hasSharedEntity).toBe(true);
            }

            // Should recommend exactly numSharedClips (clips with shared entity)
            expect(candidates.length).toBe(numSharedClips);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should return empty array when seed clip has no entities for timeline recommendations', async () => {
      await fc.assert(
        fc.asyncProperty(
          workspaceArbitrary,
          mediaArbitrary,
          async (workspace, media) => {
            const seedClip: MediaClip = {
              id: fc.sample(fc.uuid(), 1)[0],
              WorkspaceRef: workspace.id,
              MediaRef: media.id,
              type: 'user',
              start: 0,
              end: 10,
              duration: 10,
              clipData: {},
              version: 1,
              processor: 'test',
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              collectionId: 'media_clips',
              collectionName: 'media_clips',
            };

            const timeline: Timeline = {
              id: fc.sample(fc.uuid(), 1)[0],
              name: 'Test Timeline',
              WorkspaceRef: workspace.id,
              duration: 0,
              editList: undefined,
              UserRef: undefined,
              version: 1,
              processor: undefined,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              collectionId: 'timelines',
              collectionName: 'timelines',
            };

            const context: TimelineStrategyContext = {
              workspace,
              timeline,
              timelineClips: [],
              seedClip,
              availableClips: [],
              labelClips: [], // No label clips for seed
              labelEntities: [],
              searchParams: {},
            };

            const strategy = new SameEntityStrategy();
            const candidates = await strategy.executeForTimeline(context);

            expect(candidates).toEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should return empty array when no seed clip is provided for timeline recommendations', async () => {
      await fc.assert(
        fc.asyncProperty(
          workspaceArbitrary,
          mediaArbitrary,
          async (workspace, media) => {
            const timeline: Timeline = {
              id: fc.sample(fc.uuid(), 1)[0],
              name: 'Test Timeline',
              WorkspaceRef: workspace.id,
              duration: 0,
              editList: undefined,
              UserRef: undefined,
              version: 1,
              processor: undefined,
              created: new Date().toISOString(),
              updated: new Date().toISOString(),
              collectionId: 'timelines',
              collectionName: 'timelines',
            };

            const context: TimelineStrategyContext = {
              workspace,
              timeline,
              timelineClips: [],
              seedClip: undefined, // No seed clip
              availableClips: [],
              labelClips: [],
              labelEntities: [],
              searchParams: {},
            };

            const strategy = new SameEntityStrategy();
            const candidates = await strategy.executeForTimeline(context);

            expect(candidates).toEqual([]);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('should generate candidates with scores between 0 and 1', async () => {
      await fc.assert(
        fc.asyncProperty(
          workspaceArbitrary,
          mediaArbitrary,
          labelEntityArbitrary,
          fc.integer({ min: 2, max: 10 }),
          async (workspace, media, entity, numClips) => {
            // Create label clips with the same entity
            const labelClips: LabelClip[] = [];
            for (let i = 0; i < numClips; i++) {
              labelClips.push({
                id: fc.sample(fc.uuid(), 1)[0],
                WorkspaceRef: workspace.id,
                MediaRef: media.id,
                TaskRef: undefined,
                LabelEntityRef: entity.id,
                LabelTrackRef: undefined,
                labelHash: fc.sample(fc.string({ minLength: 32, maxLength: 32 }), 1)[0],
                labelType: entity.labelType,
                type: entity.canonicalName,
                start: i * 20,
                end: i * 20 + 10,
                duration: 10,
                confidence: 0.5 + Math.random() * 0.5, // 0.5 to 1.0
                version: 1,
                processor: 'test',
                provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                labelData: {},
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
                collectionId: 'label_clips',
                collectionName: 'label_clips',
              });
            }

            const context: MediaStrategyContext = {
              workspace,
              media,
              labelClips,
              labelEntities: [entity],
              existingClips: [],
              filterParams: {},
            };

            const strategy = new SameEntityStrategy();
            const candidates = await strategy.executeForMedia(context);

            // All scores should be between 0 and 1
            for (const candidate of candidates) {
              expect(candidate.score).toBeGreaterThanOrEqual(0);
              expect(candidate.score).toBeLessThanOrEqual(1);
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
