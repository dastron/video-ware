// Property-based tests for MediaRecommendationWriter
// Feature: recommendation-engine, Property 3: Media Top-N Enforcement
// Feature: recommendation-engine, Property 5: Media Upsert Idempotency

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { MediaRecommendationWriter } from '../media-recommendation-writer';
import {
  LabelType,
  RecommendationStrategy,
  type MediaRecommendation,
  type MediaRecommendationMutator,
} from '@project/shared';
import { PocketBaseService } from '../../../shared/services/pocketbase.service';

// Mock PocketBaseService
let mockService: PocketBaseService;

// In-memory storage for testing
let mockStorage: Map<string, MediaRecommendation>;
let nextId: number;

// Helper to create a mock recommendation
function createMockRecommendation(
  input: Partial<MediaRecommendation>
): MediaRecommendation {
  const id = `rec_${nextId++}`;
  return {
    id,
    collectionId: 'MediaRecommendations',
    collectionName: 'MediaRecommendations',
    expand: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    WorkspaceRef: input.WorkspaceRef || '',
    MediaRef: input.MediaRef || '',
    start: input.start || 0,
    end: input.end || 0,
    MediaClipRef: input.MediaClipRef,
    score: input.score || 0,
    rank: input.rank || 0,
    reason: input.reason || '',
    reasonData: input.reasonData || {},
    strategy: input.strategy || RecommendationStrategy.SAME_ENTITY,
    labelType: input.labelType || LabelType.OBJECT,
    queryHash: input.queryHash || '',
    version: input.version || 1,
    processor: input.processor,
  };
}

// Helper function to filter items by query
function filterItems(
  items: MediaRecommendation[],
  filter?: string
): MediaRecommendation[] {
  if (!filter) return items;

  let filtered = items;

  // Parse simple filters for queryHash
  const queryHashMatch = filter.match(/queryHash = "([^"]+)"/);
  if (queryHashMatch) {
    const queryHash = queryHashMatch[1];
    filtered = items.filter((item) => item.queryHash === queryHash);
  }

  // Parse filters for start and end (handle scientific notation)
  const startMatch = filter.match(
    /start = (-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/
  );
  const endMatch = filter.match(
    /end = (-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/
  );
  if (startMatch && endMatch) {
    const start = parseFloat(startMatch[1]);
    const end = parseFloat(endMatch[1]);
    if (!isNaN(start) && !isNaN(end)) {
      filtered = filtered.filter(
        (item) => item.start === start && item.end === end
      );
    }
  }

  return filtered;
}

// Setup mock service
beforeEach(() => {
  mockStorage = new Map();
  nextId = 1;

  const mockMutator = {
    getFirstByFilter: vi.fn().mockImplementation(async (filter: string) => {
      const items = Array.from(mockStorage.values());
      const filtered = filterItems(items, filter);
      if (filtered.length === 0) {
        return null;
      }
      return filtered[0];
    }),

    getByQueryHash: vi
      .fn()
      .mockImplementation(
        async (
          queryHash: string,
          _options: unknown,
          page: number,
          perPage: number
        ) => {
          const items = Array.from(mockStorage.values());
          const filtered = items.filter((item) => item.queryHash === queryHash);

          // Sort by rank, then start
          filtered.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.start - b.start;
          });

          return {
            page,
            perPage,
            totalItems: filtered.length,
            totalPages: Math.ceil(filtered.length / perPage),
            items: filtered,
          };
        }
      ),

    create: vi.fn().mockImplementation(async (data) => {
      const rec = createMockRecommendation(data);
      mockStorage.set(rec.id, rec);
      return rec;
    }),

    update: vi
      .fn()
      .mockImplementation(
        async (id: string, data: Partial<MediaRecommendation>) => {
          const existing = mockStorage.get(id);
          if (!existing) {
            throw new Error('Not found');
          }
          const updated = {
            ...existing,
            ...data,
            updated: new Date().toISOString(),
          };
          mockStorage.set(id, updated);
          return updated;
        }
      ),

    delete: vi.fn().mockImplementation(async (id: string) => {
      mockStorage.delete(id);
      return true;
    }),
  } as unknown as MediaRecommendationMutator;

  mockService = {
    mediaRecommendationMutator: mockMutator,
  } as unknown as PocketBaseService;
});

// Arbitraries for generating test data
const labelTypeArbitrary = fc.constantFrom(
  LabelType.OBJECT,
  LabelType.SHOT,
  LabelType.PERSON,
  LabelType.SPEECH
);

const strategyArbitrary = fc.constantFrom(
  RecommendationStrategy.SAME_ENTITY,
  RecommendationStrategy.ADJACENT_SHOT,
  RecommendationStrategy.TEMPORAL_NEARBY,
  RecommendationStrategy.CONFIDENCE_DURATION
);

const scoredCandidateArbitrary = fc
  .record({
    start: fc.integer({ min: 0, max: 10000 }).map((x) => x / 10),
    duration: fc.integer({ min: 1, max: 1000 }).map((x) => x / 10),
    clipId: fc.option(fc.uuid()).map((v) => v ?? undefined),
    score: fc.integer({ min: 0, max: 1000 }).map((x) => x / 1000),
    reason: fc.string({ minLength: 1, maxLength: 100 }),
    reasonData: fc.dictionary(fc.string(), fc.anything()),
    labelType: labelTypeArbitrary,
    strategy: strategyArbitrary,
  })
  .map((candidate) => ({
    ...candidate,
    end: candidate.start + candidate.duration,
  }));

const contextArbitrary = fc.record({
  workspaceId: fc.uuid(),
  mediaId: fc.uuid(),
  queryHash: fc.string({ minLength: 32, maxLength: 32 }).map((s) =>
    s
      .split('')
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 32)
  ),
  version: fc
    .option(fc.integer({ min: 1, max: 100 }))
    .map((v) => v ?? undefined),
  processor: fc.option(fc.string()).map((v) => v ?? undefined),
});

describe('MediaRecommendationWriter Properties', () => {
  describe('Property 3: Media Top-N Enforcement', () => {
    it('should enforce maximum N recommendations per queryHash', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 20 }), // maxPerContext
          fc.integer({ min: 10, max: 50 }), // number of candidates (more than max)
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, {
            minLength: 10,
            maxLength: 50,
          }),
          async (maxPerContext, numCandidates, context, candidates) => {
            fc.pre(numCandidates > maxPerContext);
            fc.pre(candidates.length >= numCandidates);

            const writer = new MediaRecommendationWriter(
              mockService,
              maxPerContext
            );

            await writer.write(
              context.queryHash,
              candidates.slice(0, numCandidates),
              context
            );

            // Get all recommendations for this queryHash
            const result =
              await mockService.mediaRecommendationMutator.getByQueryHash(
                context.queryHash,
                {},
                1,
                1000
              );

            // Should not exceed maxPerContext
            expect(result.items.length).toBeLessThanOrEqual(maxPerContext);

            // Ranks should be contiguous from 0 to count-1
            const ranks = result.items
              .map((item: MediaRecommendation) => item.rank)
              .sort((a: number, b: number) => a - b);
            for (let i = 0; i < ranks.length; i++) {
              expect(ranks[i]).toBe(i);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain contiguous ranks after pruning', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 15 }), // maxPerContext
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, {
            minLength: 10,
            maxLength: 35,
          }),
          async (maxPerContext, context, candidates) => {
            fc.pre(candidates.length >= maxPerContext + 5);

            const writer = new MediaRecommendationWriter(
              mockService,
              maxPerContext
            );

            await writer.write(context.queryHash, candidates, context);

            // Get all recommendations for this queryHash
            const result =
              await mockService.mediaRecommendationMutator.getByQueryHash(
                context.queryHash,
                {},
                1,
                1000
              );

            // Ranks should be contiguous integers from 0 to count-1
            const ranks = result.items
              .map((item: MediaRecommendation) => item.rank)
              .sort((a: number, b: number) => a - b);
            expect(ranks).toEqual(
              Array.from({ length: ranks.length }, (_, i) => i)
            );
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should keep only top-scoring recommendations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 15 }), // maxPerContext
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, {
            minLength: 10,
            maxLength: 35,
          }),
          async (maxPerContext, context, candidates) => {
            fc.pre(candidates.length >= maxPerContext + 5);

            const writer = new MediaRecommendationWriter(
              mockService,
              maxPerContext
            );

            // Sort candidates by score to know what should be kept
            const sortedByScore = [...candidates].sort(
              (a, b) => b.score - a.score
            );
            const topScores = sortedByScore
              .slice(0, maxPerContext)
              .map((c) => c.score)
              .sort((a, b) => b - a);

            await writer.write(context.queryHash, candidates, context);

            // Get all recommendations for this queryHash
            const result =
              await mockService.mediaRecommendationMutator.getByQueryHash(
                context.queryHash,
                {},
                1,
                1000
              );

            // All kept recommendations should have scores >= the lowest top score
            const minTopScore = Math.min(...topScores);
            for (const item of result.items) {
              expect(item.score).toBeGreaterThanOrEqual(minTopScore - 0.0001); // small epsilon for float comparison
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('Property 5: Media Upsert Idempotency', () => {
    it('should not create duplicates when run twice with same inputs', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 5, maxLength: 15 }),
          async (context, candidates) => {
            const writer = new MediaRecommendationWriter(mockService, 20);

            // Run write twice with same inputs
            await writer.write(context.queryHash, candidates, context);
            const countAfterFirst = mockStorage.size;

            await writer.write(context.queryHash, candidates, context);
            const countAfterSecond = mockStorage.size;

            // Count should remain the same (no duplicates created)
            expect(countAfterSecond).toBe(countAfterFirst);

            // Get all recommendations for this queryHash
            const result =
              await mockService.mediaRecommendationMutator.getByQueryHash(
                context.queryHash,
                {},
                1,
                1000
              );

            // Should have at most as many recommendations as candidates
            expect(result.items.length).toBeLessThanOrEqual(candidates.length);

            // No duplicate segments (queryHash + start + end)
            const segments = new Set<string>();
            for (const item of result.items) {
              const key = `${item.queryHash}-${item.start}-${item.end}`;
              expect(segments.has(key)).toBe(false);
              segments.add(key);
            }
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should update existing recommendations on second run', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 3, maxLength: 10 }),
          async (context, candidates) => {
            const writer = new MediaRecommendationWriter(mockService, 20);

            // First write
            const result1 = await writer.write(
              context.queryHash,
              candidates,
              context
            );

            // Modify scores slightly
            const modifiedCandidates = candidates.map((c) => ({
              ...c,
              score: Math.min(1, c.score + 0.1),
              reason: c.reason + ' (updated)',
            }));

            // Second write with modified data
            const result2 = await writer.write(
              context.queryHash,
              modifiedCandidates,
              context
            );

            // Should have updates, not all creates
            expect(result2.updated).toBeGreaterThan(0);

            // Total count should remain the same
            expect(result2.total).toBe(result1.total);
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should maintain queryHash uniqueness constraint', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 5, maxLength: 15 }),
          async (context, candidates) => {
            // Ensure all candidates have unique (start, end) pairs
            // Use rounded values to match the uniqueness check below
            const segmentKeys = new Set<string>();
            for (const candidate of candidates) {
              const roundedStart = Math.round(candidate.start * 1e6) / 1e6;
              const roundedEnd = Math.round(candidate.end * 1e6) / 1e6;
              const key = `${roundedStart}-${roundedEnd}`;
              segmentKeys.add(key);
            }
            fc.pre(segmentKeys.size === candidates.length); // All segments must be unique

            const writer = new MediaRecommendationWriter(mockService, 20);

            // Run write multiple times
            await writer.write(context.queryHash, candidates, context);
            await writer.write(context.queryHash, candidates, context);
            await writer.write(context.queryHash, candidates, context);

            // Get all recommendations for this queryHash
            const result =
              await mockService.mediaRecommendationMutator.getByQueryHash(
                context.queryHash,
                {},
                1,
                1000
              );

            // Check uniqueness: no two recommendations should have same (queryHash, start, end)
            // Use rounded values to avoid floating-point precision issues
            const uniqueKeys = new Set<string>();
            for (const item of result.items) {
              // Round to 6 decimal places to handle floating-point precision
              const roundedStart = Math.round(item.start * 1e6) / 1e6;
              const roundedEnd = Math.round(item.end * 1e6) / 1e6;
              const key = `${item.queryHash}-${roundedStart}-${roundedEnd}`;
              expect(uniqueKeys.has(key)).toBe(false);
              uniqueKeys.add(key);
            }

            // All items should have the same queryHash
            for (const item of result.items) {
              expect(item.queryHash).toBe(context.queryHash);
            }
          }
        ),
        { numRuns: 20, timeout: 10000 }
      );
    }, 12000);
  });
});
