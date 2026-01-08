import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LabelClipMutator } from '../label-clip';
import { LabelType } from '../../enums';
import type { TypedPocketBase } from '../../types';

describe('LabelClipMutator', () => {
  let mutator: LabelClipMutator;
  let mockPb: TypedPocketBase;
  let mockCollection: any;

  beforeEach(() => {
    mockCollection = {
      getList: vi.fn().mockResolvedValue({
        page: 1,
        perPage: 50,
        totalItems: 0,
        totalPages: 0,
        items: [],
      }),
    };

    mockPb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    } as any;

    mutator = new LabelClipMutator(mockPb);
  });

  describe('search', () => {
    it('should build correct filter for labelType', async () => {
      await mutator.search({ labelType: LabelType.OBJECT });

      const call = mockCollection.getList.mock.calls[0];
      expect(call[0]).toBe(1);
      expect(call[1]).toBe(50);
      expect(call[2]).toMatchObject({
        filter: 'labelType = "object"',
        sort: 'start',
      });
      expect(call[2].expand).toContain('MediaRef');
      expect(call[2].expand).toContain('WorkspaceRef');
      expect(call[2].expand).toContain('TaskRef');
    });

    it('should build correct filter for searchQuery', async () => {
      await mutator.search({ searchQuery: 'person' });

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'labelData ~ "person"',
          sort: 'start',
        })
      );
    });

    it('should build correct filter for confidenceThreshold', async () => {
      await mutator.search({ confidenceThreshold: 0.8 });

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'confidence >= 0.8',
          sort: 'start',
        })
      );
    });

    it('should build correct filter for time window', async () => {
      await mutator.search({ minTime: 10, maxTime: 20 });

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'start >= 10&&end <= 20',
          sort: 'start',
        })
      );
    });

    it('should build correct filter for mediaRef', async () => {
      await mutator.search({ mediaRef: 'media123' });

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'MediaRef = "media123"',
          sort: 'start',
        })
      );
    });

    it('should build correct filter for workspaceRef', async () => {
      await mutator.search({ workspaceRef: 'workspace123' });

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'WorkspaceRef = "workspace123"',
          sort: 'start',
        })
      );
    });

    it('should combine multiple filters with AND operator', async () => {
      await mutator.search({
        labelType: LabelType.SPEECH,
        confidenceThreshold: 0.9,
        mediaRef: 'media123',
      });

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'labelType = "speech"&&confidence >= 0.9&&MediaRef = "media123"',
          sort: 'start',
        })
      );
    });

    it('should support pagination', async () => {
      await mutator.search({}, 2, 25);

      expect(mockCollection.getList).toHaveBeenCalledWith(
        2,
        25,
        expect.any(Object)
      );
    });

    it('should sort by start time ascending by default', async () => {
      await mutator.search({});

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          sort: 'start',
        })
      );
    });

    it('should handle empty search options', async () => {
      await mutator.search({});

      const call = mockCollection.getList.mock.calls[0];
      expect(call[0]).toBe(1);
      expect(call[1]).toBe(50);
      expect(call[2]).toMatchObject({
        sort: 'start',
      });
      expect(call[2].expand).toContain('MediaRef');
      expect(call[2].expand).toContain('WorkspaceRef');
      expect(call[2].expand).toContain('TaskRef');
    });
  });

  describe('getByMedia', () => {
    it('should filter by media ID', async () => {
      await mutator.getByMedia('media123');

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        100,
        expect.objectContaining({
          filter: 'MediaRef = "media123"',
        })
      );
    });

    it('should support pagination', async () => {
      await mutator.getByMedia('media123', 2, 50);

      expect(mockCollection.getList).toHaveBeenCalledWith(
        2,
        50,
        expect.any(Object)
      );
    });
  });

  describe('getByWorkspace', () => {
    it('should filter by workspace ID', async () => {
      await mutator.getByWorkspace('workspace123');

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          filter: 'WorkspaceRef = "workspace123"',
        })
      );
    });

    it('should sort by most recent first', async () => {
      await mutator.getByWorkspace('workspace123');

      expect(mockCollection.getList).toHaveBeenCalledWith(
        1,
        50,
        expect.objectContaining({
          sort: '-created',
        })
      );
    });

    it('should support pagination', async () => {
      await mutator.getByWorkspace('workspace123', 3, 20);

      expect(mockCollection.getList).toHaveBeenCalledWith(
        3,
        20,
        expect.any(Object)
      );
    });
  });
});
