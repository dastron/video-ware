import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MaterializationChecker } from '../materialization-checker';
import type { TimelineRecommendation } from '@project/shared';
import {
  RecommendationStrategy,
  RecommendationTargetMode,
} from '@project/shared';

describe('MaterializationChecker', () => {
  let checker: MaterializationChecker;
  let mockPocketbaseService: any;

  beforeEach(() => {
    mockPocketbaseService = {
      timelineRecommendationMutator: {
        getByQueryHash: vi.fn(),
        getByTimeline: vi.fn(),
        getList: vi.fn(),
      },
    };
    checker = new MaterializationChecker(mockPocketbaseService);
  });

  describe('isMaterialized', () => {
    it('should return true when acceptedAt is set', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: '2024-01-01T00:00:00Z',
      };

      expect(
        checker.isMaterialized(recommendation as TimelineRecommendation)
      ).toBe(true);
    });

    it('should return false when acceptedAt is not set', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: undefined,
      };

      expect(
        checker.isMaterialized(recommendation as TimelineRecommendation)
      ).toBe(false);
    });

    it('should return false when acceptedAt is null', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: null as any,
      };

      expect(
        checker.isMaterialized(recommendation as TimelineRecommendation)
      ).toBe(false);
    });
  });

  describe('shouldSkipDuringRegeneration', () => {
    it('should return true for materialized recommendations', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: '2024-01-01T00:00:00Z',
      };

      expect(
        checker.shouldSkipDuringRegeneration(
          recommendation as TimelineRecommendation
        )
      ).toBe(true);
    });

    it('should return false for non-materialized recommendations', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: undefined,
      };

      expect(
        checker.shouldSkipDuringRegeneration(
          recommendation as TimelineRecommendation
        )
      ).toBe(false);
    });
  });

  describe('hasLinkedTimelineClip', () => {
    it('should return true when TimelineClipRef is set', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        TimelineClipRef: 'clip1',
      };

      expect(
        checker.hasLinkedTimelineClip(recommendation as TimelineRecommendation)
      ).toBe(true);
    });

    it('should return false when TimelineClipRef is not set', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        TimelineClipRef: undefined,
      };

      expect(
        checker.hasLinkedTimelineClip(recommendation as TimelineRecommendation)
      ).toBe(false);
    });
  });

  describe('validateMaterialization', () => {
    it('should return valid for properly materialized recommendation', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: '2024-01-01T00:00:00Z',
        TimelineClipRef: 'clip1',
      };

      const result = checker.validateMaterialization(
        recommendation as TimelineRecommendation
      );

      expect(result.isValid).toBe(true);
      expect(result.hasAcceptedAt).toBe(true);
      expect(result.hasTimelineClipRef).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('should detect missing TimelineClipRef for accepted recommendation', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: '2024-01-01T00:00:00Z',
        TimelineClipRef: undefined,
      };

      const result = checker.validateMaterialization(
        recommendation as TimelineRecommendation
      );

      expect(result.isValid).toBe(false);
      expect(result.hasAcceptedAt).toBe(true);
      expect(result.hasTimelineClipRef).toBe(false);
      expect(result.issues).toContain(
        'Recommendation is marked as accepted but has no linked TimelineClip'
      );
    });

    it('should detect TimelineClipRef without acceptedAt', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: undefined,
        TimelineClipRef: 'clip1',
      };

      const result = checker.validateMaterialization(
        recommendation as TimelineRecommendation
      );

      expect(result.isValid).toBe(false);
      expect(result.hasAcceptedAt).toBe(false);
      expect(result.hasTimelineClipRef).toBe(true);
      expect(result.issues).toContain(
        'Recommendation has a linked TimelineClip but is not marked as accepted'
      );
    });

    it('should return valid for non-materialized recommendation', () => {
      const recommendation: Partial<TimelineRecommendation> = {
        id: 'rec1',
        acceptedAt: undefined,
        TimelineClipRef: undefined,
      };

      const result = checker.validateMaterialization(
        recommendation as TimelineRecommendation
      );

      expect(result.isValid).toBe(true);
      expect(result.hasAcceptedAt).toBe(false);
      expect(result.hasTimelineClipRef).toBe(false);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('getMaterializedIds', () => {
    it('should return IDs of materialized recommendations', async () => {
      const mockRecommendations: Partial<TimelineRecommendation>[] = [
        {
          id: 'rec1',
          acceptedAt: '2024-01-01T00:00:00Z',
          WorkspaceRef: 'ws1',
          TimelineRef: 'tl1',
          MediaClipRef: 'clip1',
          score: 0.9,
          rank: 0,
          reason: 'Test',
          reasonData: {},
          strategy: RecommendationStrategy.SAME_ENTITY,
          targetMode: RecommendationTargetMode.APPEND,
          queryHash: 'hash1',
          version: 1,
        },
        {
          id: 'rec2',
          acceptedAt: undefined,
          WorkspaceRef: 'ws1',
          TimelineRef: 'tl1',
          MediaClipRef: 'clip2',
          score: 0.8,
          rank: 1,
          reason: 'Test',
          reasonData: {},
          strategy: RecommendationStrategy.SAME_ENTITY,
          targetMode: RecommendationTargetMode.APPEND,
          queryHash: 'hash1',
          version: 1,
        },
        {
          id: 'rec3',
          acceptedAt: '2024-01-02T00:00:00Z',
          WorkspaceRef: 'ws1',
          TimelineRef: 'tl1',
          MediaClipRef: 'clip3',
          score: 0.7,
          rank: 2,
          reason: 'Test',
          reasonData: {},
          strategy: RecommendationStrategy.SAME_ENTITY,
          targetMode: RecommendationTargetMode.APPEND,
          queryHash: 'hash1',
          version: 1,
        },
      ];

      mockPocketbaseService.timelineRecommendationMutator.getByQueryHash.mockResolvedValue(
        {
          items: mockRecommendations,
          page: 1,
          perPage: 1000,
          totalItems: 3,
          totalPages: 1,
        }
      );

      const result = await checker.getMaterializedIds('hash1');

      expect(result).toEqual(['rec1', 'rec3']);
      expect(
        mockPocketbaseService.timelineRecommendationMutator.getByQueryHash
      ).toHaveBeenCalledWith('hash1', { excludeAccepted: false }, 1, 1000);
    });

    it('should return empty array when no recommendations are materialized', async () => {
      const mockRecommendations: Partial<TimelineRecommendation>[] = [
        {
          id: 'rec1',
          acceptedAt: undefined,
          WorkspaceRef: 'ws1',
          TimelineRef: 'tl1',
          MediaClipRef: 'clip1',
          score: 0.9,
          rank: 0,
          reason: 'Test',
          reasonData: {},
          strategy: RecommendationStrategy.SAME_ENTITY,
          targetMode: RecommendationTargetMode.APPEND,
          queryHash: 'hash1',
          version: 1,
        },
      ];

      mockPocketbaseService.timelineRecommendationMutator.getByQueryHash.mockResolvedValue(
        {
          items: mockRecommendations,
          page: 1,
          perPage: 1000,
          totalItems: 1,
          totalPages: 1,
        }
      );

      const result = await checker.getMaterializedIds('hash1');

      expect(result).toEqual([]);
    });
  });

  describe('getStatistics', () => {
    it('should calculate statistics correctly', async () => {
      const mockRecommendations: Partial<TimelineRecommendation>[] = [
        {
          id: 'rec1',
          acceptedAt: '2024-01-01T00:00:00Z',
          TimelineClipRef: 'clip1',
        },
        {
          id: 'rec2',
          acceptedAt: undefined,
          TimelineClipRef: undefined,
        },
        {
          id: 'rec3',
          acceptedAt: '2024-01-02T00:00:00Z',
          TimelineClipRef: 'clip3',
        },
        {
          id: 'rec4',
          acceptedAt: '2024-01-03T00:00:00Z',
          TimelineClipRef: undefined, // Materialized but missing link
        },
      ];

      mockPocketbaseService.timelineRecommendationMutator.getByQueryHash.mockResolvedValue(
        {
          items: mockRecommendations,
          page: 1,
          perPage: 1000,
          totalItems: 4,
          totalPages: 1,
        }
      );

      const result = await checker.getStatistics('hash1');

      expect(result.total).toBe(4);
      expect(result.materialized).toBe(3); // rec1, rec3, rec4
      expect(result.withLinkedClip).toBe(2); // rec1, rec3
      expect(result.withoutLinkedClip).toBe(1); // rec4
      expect(result.materializationRate).toBe(0.75); // 3/4
    });

    it('should handle empty results', async () => {
      mockPocketbaseService.timelineRecommendationMutator.getByQueryHash.mockResolvedValue(
        {
          items: [],
          page: 1,
          perPage: 1000,
          totalItems: 0,
          totalPages: 0,
        }
      );

      const result = await checker.getStatistics('hash1');

      expect(result.total).toBe(0);
      expect(result.materialized).toBe(0);
      expect(result.withLinkedClip).toBe(0);
      expect(result.withoutLinkedClip).toBe(0);
      expect(result.materializationRate).toBe(0);
    });
  });
});
