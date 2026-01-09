// Property-based tests for query hash utilities
// Feature: recommendation-engine, Property 12: Query Hash Determinism

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  buildMediaQueryHash,
  buildTimelineQueryHash,
  MediaQueryHashInput,
  TimelineQueryHashInput,
} from '../query-hash';
import {
  RecommendationStrategy,
  LabelType,
  RecommendationTargetMode,
} from '@project/shared';

// Arbitraries for generating test data
const strategyArbitrary = fc.constantFrom(
  RecommendationStrategy.SAME_ENTITY,
  RecommendationStrategy.ADJACENT_SHOT,
  RecommendationStrategy.TEMPORAL_NEARBY,
  RecommendationStrategy.CONFIDENCE_DURATION
);

const labelTypeArbitrary = fc.constantFrom(
  LabelType.OBJECT,
  LabelType.SHOT,
  LabelType.PERSON,
  LabelType.SPEECH
);

const targetModeArbitrary = fc.constantFrom(
  RecommendationTargetMode.APPEND,
  RecommendationTargetMode.REPLACE
);

const filterParamsArbitrary = fc.record({
  labelTypes: fc.option(fc.array(labelTypeArbitrary, { minLength: 1, maxLength: 4 })),
  minConfidence: fc.option(fc.float({ min: 0, max: 1 })),
  durationRange: fc.option(
    fc.record({
      min: fc.float({ min: 0, max: 100 }),
      max: fc.float({ min: 100, max: 1000 }),
    })
  ),
});

const searchParamsArbitrary = fc.record({
  labelTypes: fc.option(fc.array(labelTypeArbitrary, { minLength: 1, maxLength: 4 })),
  minConfidence: fc.option(fc.float({ min: 0, max: 1 })),
  durationRange: fc.option(
    fc.record({
      min: fc.float({ min: 0, max: 100 }),
      max: fc.float({ min: 100, max: 1000 }),
    })
  ),
  timeWindow: fc.option(fc.integer({ min: 1, max: 3600 })),
});

const mediaQueryHashInputArbitrary = fc.record({
  workspaceId: fc.uuid(),
  mediaId: fc.uuid(),
  mediaVersion: fc.integer({ min: 1, max: 1000 }),
  strategies: fc.array(strategyArbitrary, { minLength: 1, maxLength: 4 }),
  filterParams: fc.option(filterParamsArbitrary),
});

const timelineQueryHashInputArbitrary = fc.record({
  workspaceId: fc.uuid(),
  timelineId: fc.uuid(),
  mediaVersion: fc.integer({ min: 1, max: 1000 }),
  seedClipId: fc.option(fc.uuid()),
  targetMode: targetModeArbitrary,
  strategies: fc.array(strategyArbitrary, { minLength: 1, maxLength: 4 }),
  searchParams: fc.option(searchParamsArbitrary),
});

describe('Query Hash Properties', () => {
  describe('Property 12: Query Hash Determinism', () => {
    it('should generate identical hashes for identical media query inputs', () => {
      fc.assert(
        fc.property(mediaQueryHashInputArbitrary, (input) => {
          const hash1 = buildMediaQueryHash(input);
          const hash2 = buildMediaQueryHash(input);
          
          expect(hash1).toBe(hash2);
          expect(hash1).toHaveLength(32);
          expect(hash1).toMatch(/^[0-9a-f]{32}$/);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate identical hashes for identical timeline query inputs', () => {
      fc.assert(
        fc.property(timelineQueryHashInputArbitrary, (input) => {
          const hash1 = buildTimelineQueryHash(input);
          const hash2 = buildTimelineQueryHash(input);
          
          expect(hash1).toBe(hash2);
          expect(hash1).toHaveLength(32);
          expect(hash1).toMatch(/^[0-9a-f]{32}$/);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when mediaVersion changes', () => {
      fc.assert(
        fc.property(
          mediaQueryHashInputArbitrary,
          fc.integer({ min: 1, max: 1000 }),
          (input, newVersion) => {
            fc.pre(input.mediaVersion !== newVersion);
            
            const hash1 = buildMediaQueryHash(input);
            const hash2 = buildMediaQueryHash({ ...input, mediaVersion: newVersion });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when workspaceId changes', () => {
      fc.assert(
        fc.property(
          mediaQueryHashInputArbitrary,
          fc.uuid(),
          (input, newWorkspaceId) => {
            fc.pre(input.workspaceId !== newWorkspaceId);
            
            const hash1 = buildMediaQueryHash(input);
            const hash2 = buildMediaQueryHash({ ...input, workspaceId: newWorkspaceId });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when mediaId changes', () => {
      fc.assert(
        fc.property(
          mediaQueryHashInputArbitrary,
          fc.uuid(),
          (input, newMediaId) => {
            fc.pre(input.mediaId !== newMediaId);
            
            const hash1 = buildMediaQueryHash(input);
            const hash2 = buildMediaQueryHash({ ...input, mediaId: newMediaId });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when strategies change', () => {
      fc.assert(
        fc.property(
          mediaQueryHashInputArbitrary,
          fc.array(strategyArbitrary, { minLength: 1, maxLength: 4 }),
          (input, newStrategies) => {
            fc.pre(JSON.stringify(input.strategies) !== JSON.stringify(newStrategies));
            
            const hash1 = buildMediaQueryHash(input);
            const hash2 = buildMediaQueryHash({ ...input, strategies: newStrategies });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when seedClipId changes in timeline queries', () => {
      fc.assert(
        fc.property(
          timelineQueryHashInputArbitrary,
          fc.uuid(),
          (input, newSeedClipId) => {
            fc.pre(input.seedClipId !== newSeedClipId);
            
            const hash1 = buildTimelineQueryHash(input);
            const hash2 = buildTimelineQueryHash({ ...input, seedClipId: newSeedClipId });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when targetMode changes in timeline queries', () => {
      fc.assert(
        fc.property(timelineQueryHashInputArbitrary, (input) => {
          const oppositeMode =
            input.targetMode === RecommendationTargetMode.APPEND
              ? RecommendationTargetMode.REPLACE
              : RecommendationTargetMode.APPEND;
          
          const hash1 = buildTimelineQueryHash(input);
          const hash2 = buildTimelineQueryHash({ ...input, targetMode: oppositeMode });
          
          expect(hash1).not.toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when filterParams change', () => {
      fc.assert(
        fc.property(
          mediaQueryHashInputArbitrary,
          filterParamsArbitrary,
          (input, newFilterParams) => {
            fc.pre(JSON.stringify(input.filterParams) !== JSON.stringify(newFilterParams));
            
            const hash1 = buildMediaQueryHash(input);
            const hash2 = buildMediaQueryHash({ ...input, filterParams: newFilterParams });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should generate different hashes when searchParams change', () => {
      fc.assert(
        fc.property(
          timelineQueryHashInputArbitrary,
          searchParamsArbitrary,
          (input, newSearchParams) => {
            fc.pre(JSON.stringify(input.searchParams) !== JSON.stringify(newSearchParams));
            
            const hash1 = buildTimelineQueryHash(input);
            const hash2 = buildTimelineQueryHash({ ...input, searchParams: newSearchParams });
            
            expect(hash1).not.toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should be deterministic across multiple calls with deep-cloned inputs', () => {
      fc.assert(
        fc.property(mediaQueryHashInputArbitrary, (input) => {
          // Deep clone the input to ensure no reference sharing
          const clonedInput = JSON.parse(JSON.stringify(input));
          
          const hash1 = buildMediaQueryHash(input);
          const hash2 = buildMediaQueryHash(clonedInput);
          
          expect(hash1).toBe(hash2);
        }),
        { numRuns: 100 }
      );
    });

    it('should handle undefined optional fields consistently', () => {
      fc.assert(
        fc.property(
          fc.uuid(),
          fc.uuid(),
          fc.integer({ min: 1, max: 1000 }),
          fc.array(strategyArbitrary, { minLength: 1, maxLength: 4 }),
          (workspaceId, mediaId, mediaVersion, strategies) => {
            const inputWithUndefined: MediaQueryHashInput = {
              workspaceId,
              mediaId,
              mediaVersion,
              strategies,
              filterParams: undefined,
            };
            
            const inputWithoutField: MediaQueryHashInput = {
              workspaceId,
              mediaId,
              mediaVersion,
              strategies,
            };
            
            const hash1 = buildMediaQueryHash(inputWithUndefined);
            const hash2 = buildMediaQueryHash(inputWithoutField);
            
            // Both should produce the same hash since undefined is omitted in JSON.stringify
            expect(hash1).toBe(hash2);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
