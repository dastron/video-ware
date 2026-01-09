// Property-based tests for TimelineRecommendationWriter
// Feature: recommendation-engine, Property 4: Timeline Top-N Enforcement
// Feature: recommendation-engine, Property 6: Timeline Upsert Idempotency

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  TimelineRecommendationWriter,
} from '../timeline-recommendation-writer';
import {
  RecommendationStrategy,
  RecommendationTargetMode,
  type TimelineRecommendation,
  type TimelineRecommendationMutator,
} from '@project/shared';
import { PocketBaseService } from '../../../shared/services/pocketbase.service';

// Mock PocketBaseService
let mockService: PocketBaseService;

// In-memory storage for testing
let mockStorage: Map<string, TimelineRecommendation>;
let nextId: number;

// Helper to create a mock recommendation
function createMockRecommendation(
  input: Partial<TimelineRecommendation>
): TimelineRecommendation {
  const id = `rec_${nextId++}`;
  return {
    id,
    collectionId: 'TimelineRecommendations',
    collectionName: 'TimelineRecommendations',
    expand: {},
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    WorkspaceRef: input.WorkspaceRef || '',
    TimelineRef: input.TimelineRef || '',
    SeedClipRef: input.SeedClipRef,
    MediaClipRef: input.MediaClipRef || '',
    TimelineClipRef: input.TimelineClipRef,
    score: input.score || 0,
    rank: input.rank || 0,
    reason: input.reason || '',
    reasonData: input.reasonData || {},
    strategy: input.strategy || RecommendationStrategy.SAME_ENTITY,
    targetMode: input.targetMode || RecommendationTargetMode.APPEND,
    queryHash: input.queryHash || '',
    acceptedAt: input.acceptedAt,
    dismissedAt: input.dismissedAt,
    version: input.version || 1,
    processor: input.processor,
  };
}

// Helper function to filter items by query
function filterItems(
  items: TimelineRecommendation[],
  filter?: string
): TimelineRecommendation[] {
  if (!filter) return items;
  
  let filtered = items;
  
  // Parse simple filters for queryHash
  const queryHashMatch = filter.match(/queryHash = "([^"]+)"/);
  if (queryHashMatch) {
    const queryHash = queryHashMatch[1];
    filtered = items.filter((item) => item.queryHash === queryHash);
  }
  
  // Parse filters for MediaClipRef
  const clipRefMatch = filter.match(/MediaClipRef = "([^"]+)"/);
  if (clipRefMatch) {
    const clipRef = clipRefMatch[1];
    filtered = filtered.filter((item) => item.MediaClipRef === clipRef);
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
    
    getByQueryHash: vi.fn().mockImplementation(async (queryHash: string, options: { excludeAccepted?: boolean }, page: number, perPage: number) => {
      const items = Array.from(mockStorage.values());
      let filtered = items.filter((item) => item.queryHash === queryHash);
      
      // Handle excludeAccepted option
      if (options?.excludeAccepted === true) {
        filtered = filtered.filter((item) => !item.acceptedAt);
      }
      
      // Sort by rank, then score
      filtered.sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return b.score - a.score;
      });
      
      return {
        page,
        perPage,
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / perPage),
        items: filtered,
      };
    }),
    
    create: vi.fn().mockImplementation(async (data) => {
      // Handle RecommendedClipRef -> MediaClipRef mapping
      const { RecommendedClipRef, ...rest } = data as any;
      const rec = createMockRecommendation({
        ...rest,
        MediaClipRef: RecommendedClipRef || rest.MediaClipRef,
      });
      mockStorage.set(rec.id, rec);
      return rec;
    }),
    
    update: vi.fn().mockImplementation(async (id: string, data: Partial<TimelineRecommendation>) => {
      const existing = mockStorage.get(id);
      if (!existing) {
        throw new Error('Not found');
      }
      const updated = { ...existing, ...data, updated: new Date().toISOString() };
      mockStorage.set(id, updated);
      return updated;
    }),
    
    delete: vi.fn().mockImplementation(async (id: string) => {
      mockStorage.delete(id);
      return true;
    }),
  } as unknown as TimelineRecommendationMutator;

  mockService = {
    timelineRecommendationMutator: mockMutator,
  } as unknown as PocketBaseService;
});

// Arbitraries for generating test data
const strategyArbitrary = fc.constantFrom(
  RecommendationStrategy.SAME_ENTITY,
  RecommendationStrategy.ADJACENT_SHOT,
  RecommendationStrategy.TEMPORAL_NEARBY,
  RecommendationStrategy.CONFIDENCE_DURATION
);

const targetModeArbitrary = fc.constantFrom(
  RecommendationTargetMode.APPEND,
  RecommendationTargetMode.REPLACE
);

const scoredCandidateArbitrary = fc.record({
  clipId: fc.uuid(),
  score: fc.integer({ min: 0, max: 1000 }).map((x) => x / 1000), // Ensures valid number in [0, 1]
  reason: fc.string({ minLength: 1, maxLength: 100 }),
  reasonData: fc.dictionary(fc.string(), fc.anything()),
  strategy: strategyArbitrary,
});

const contextArbitrary = fc.record({
  workspaceId: fc.uuid(),
  timelineId: fc.uuid(),
  seedClipId: fc.option(fc.uuid()).map((v) => v ?? undefined),
  targetMode: targetModeArbitrary,
  queryHash: fc.string({ minLength: 32, maxLength: 32 }).map((s) => 
    s.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('').slice(0, 32)
  ),
  version: fc.option(fc.integer({ min: 1, max: 100 })).map((v) => v ?? undefined),
  processor: fc.option(fc.string()).map((v) => v ?? undefined),
});

describe('TimelineRecommendationWriter Properties', () => {
  describe('Property 4: Timeline Top-N Enforcement', () => {
    it('should enforce maximum M recommendations per queryHash', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 20 }), // maxPerContext
          fc.integer({ min: 10, max: 50 }), // number of candidates (more than max)
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 10, maxLength: 50 }),
          async (maxPerContext, numCandidates, context, candidates) => {
            fc.pre(numCandidates > maxPerContext);
            fc.pre(candidates.length >= numCandidates);
            
            const writer = new TimelineRecommendationWriter(mockService, maxPerContext);
            
            await writer.write(context.queryHash, candidates.slice(0, numCandidates), context);
            
            // Get all recommendations for this queryHash
            const result = await mockService.timelineRecommendationMutator.getByQueryHash(
              context.queryHash,
              {},
              1,
              1000
            );
            
            // Should not exceed maxPerContext
            expect(result.items.length).toBeLessThanOrEqual(maxPerContext);
            
            // Ranks should be contiguous from 0 to count-1
            const ranks = result.items.map((item: TimelineRecommendation) => item.rank).sort((a: number, b: number) => a - b);
            for (let i = 0; i < ranks.length; i++) {
              expect(ranks[i]).toBe(i);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should maintain contiguous ranks after pruning', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 5, max: 15 }), // maxPerContext
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 10, maxLength: 35 }),
          async (maxPerContext, context, candidates) => {
            fc.pre(candidates.length >= maxPerContext + 5);
            
            const writer = new TimelineRecommendationWriter(mockService, maxPerContext);
            
            await writer.write(context.queryHash, candidates, context);
            
            // Get all recommendations for this queryHash
            const result = await mockService.timelineRecommendationMutator.getByQueryHash(
              context.queryHash,
              {},
              1,
              1000
            );
            
            // Ranks should be contiguous integers from 0 to count-1
            const ranks = result.items.map((item: TimelineRecommendation) => item.rank).sort((a: number, b: number) => a - b);
            expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i));
          }
        ),
        { numRuns: 100 }
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
            
            const writer = new TimelineRecommendationWriter(mockService, maxPerContext);
            
            // Sort candidates by score to know what should be kept
            const sortedByScore = [...candidates].sort((a, b) => b.score - a.score);
            const topScores = sortedByScore
              .slice(0, maxPerContext)
              .map((c) => c.score)
              .sort((a, b) => b - a);
            
            await writer.write(context.queryHash, candidates, context);
            
            // Get all recommendations for this queryHash
            const result = await mockService.timelineRecommendationMutator.getByQueryHash(
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
        { numRuns: 100 }
      );
    });

    it('should preserve materialized recommendations during pruning', async () => {
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
            
            const writer = new TimelineRecommendationWriter(mockService, maxPerContext);
            
            // First write
            await writer.write(context.queryHash, candidates, context);
            
            // Mark some recommendations as accepted (materialized)
            const allRecs = await mockService.timelineRecommendationMutator.getByQueryHash(
              context.queryHash,
              {},
              1,
              1000
            );
            
            const toMaterialize = allRecs.items.slice(0, Math.min(3, allRecs.items.length));
            for (const rec of toMaterialize) {
              await mockService.timelineRecommendationMutator.update(rec.id, {
                acceptedAt: new Date().toISOString(),
              });
            }
            
            // Second write with different candidates
            const newCandidates = candidates.map((c) => ({
              ...c,
              score: Math.random(), // Different scores
            }));
            
            await writer.write(context.queryHash, newCandidates, context);
            
            // Materialized recommendations should still exist
            for (const rec of toMaterialize) {
              const stillExists = mockStorage.has(rec.id);
              expect(stillExists).toBe(true);
              
              const current = mockStorage.get(rec.id);
              expect(current?.acceptedAt).toBeTruthy();
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Property 6: Timeline Upsert Idempotency', () => {
    it('should not create duplicates when run twice with same inputs', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 5, maxLength: 15 }),
          async (context, candidates) => {
            const writer = new TimelineRecommendationWriter(mockService, 20);
            
            // Run write twice with same inputs
            await writer.write(context.queryHash, candidates, context);
            const countAfterFirst = mockStorage.size;
            
            await writer.write(context.queryHash, candidates, context);
            const countAfterSecond = mockStorage.size;
            
            // Count should remain the same (no duplicates created)
            expect(countAfterSecond).toBe(countAfterFirst);
            
            // Get all recommendations for this queryHash
            const result = await mockService.timelineRecommendationMutator.getByQueryHash(
              context.queryHash,
              {},
              1,
              1000
            );
            
            // Should have at most as many recommendations as candidates
            expect(result.items.length).toBeLessThanOrEqual(candidates.length);
            
            // No duplicate clips (queryHash + MediaClipRef)
            const clips = new Set<string>();
            for (const item of result.items) {
              const key = `${item.queryHash}-${item.MediaClipRef}`;
              expect(clips.has(key)).toBe(false);
              clips.add(key);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should update existing recommendations on second run', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 3, maxLength: 10 }),
          async (context, candidates) => {
            const writer = new TimelineRecommendationWriter(mockService, 20);
            
            // First write
            const result1 = await writer.write(context.queryHash, candidates, context);
            
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
        { numRuns: 100 }
      );
    });

    it('should maintain queryHash + clipId uniqueness constraint', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 5, maxLength: 15 }),
          async (context, candidates) => {
            const writer = new TimelineRecommendationWriter(mockService, 20);
            
            // Run write multiple times
            await writer.write(context.queryHash, candidates, context);
            await writer.write(context.queryHash, candidates, context);
            await writer.write(context.queryHash, candidates, context);
            
            // Get all recommendations for this queryHash
            const result = await mockService.timelineRecommendationMutator.getByQueryHash(
              context.queryHash,
              {},
              1,
              1000
            );
            
            // Check uniqueness: no two recommendations should have same (queryHash, MediaClipRef)
            const uniqueKeys = new Set<string>();
            for (const item of result.items) {
              const key = `${item.queryHash}-${item.MediaClipRef}`;
              expect(uniqueKeys.has(key)).toBe(false);
              uniqueKeys.add(key);
            }
            
            // All items should have the same queryHash
            for (const item of result.items) {
              expect(item.queryHash).toBe(context.queryHash);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should not modify materialized recommendations on regeneration', async () => {
      await fc.assert(
        fc.asyncProperty(
          contextArbitrary,
          fc.array(scoredCandidateArbitrary, { minLength: 5, maxLength: 10 }),
          async (context, candidates) => {
            const writer = new TimelineRecommendationWriter(mockService, 20);
            
            // First write
            await writer.write(context.queryHash, candidates, context);
            
            // Mark some recommendations as accepted (materialized)
            const allRecs = await mockService.timelineRecommendationMutator.getByQueryHash(
              context.queryHash,
              {},
              1,
              1000
            );
            
            const toMaterialize = allRecs.items.slice(0, Math.min(2, allRecs.items.length));
            const materializedData = new Map<string, TimelineRecommendation>();
            
            for (const rec of toMaterialize) {
              const updated = await mockService.timelineRecommendationMutator.update(rec.id, {
                acceptedAt: new Date().toISOString(),
              });
              materializedData.set(rec.id, updated);
            }
            
            // Second write with modified data
            const modifiedCandidates = candidates.map((c) => ({
              ...c,
              score: Math.min(1, c.score + 0.2),
              reason: c.reason + ' (regenerated)',
            }));
            
            await writer.write(context.queryHash, modifiedCandidates, context);
            
            // Materialized recommendations should not have been modified
            for (const [id, original] of materializedData) {
              const current = mockStorage.get(id);
              expect(current).toBeDefined();
              
              // Score and reason should not have changed
              expect(current?.score).toBe(original.score);
              expect(current?.reason).toBe(original.reason);
              expect(current?.acceptedAt).toBe(original.acceptedAt);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
