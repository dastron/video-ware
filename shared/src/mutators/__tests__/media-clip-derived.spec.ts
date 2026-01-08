import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MediaClipMutator } from '../media-clip';
import { LabelType, ClipType, ProcessingProvider } from '../../enums';
import type { LabelClip, MediaClip } from '../../schema';

describe('MediaClipMutator - Derived Clips', () => {
  let mutator: MediaClipMutator;
  let mockPb: any;

  beforeEach(() => {
    mockPb = {
      collection: vi.fn().mockReturnValue({
        getList: vi.fn(),
        create: vi.fn(),
      }),
    };
    mutator = new MediaClipMutator(mockPb);
  });

  describe('findDerivedClip', () => {
    it('should find existing derived clip by mediaRef and sourceLabelId', async () => {
      const mockClip: MediaClip = {
        id: 'clip123',
        collectionId: 'mediaclips',
        collectionName: 'MediaClips',
        expand: {},
        WorkspaceRef: 'ws1',
        MediaRef: 'media1',
        type: ClipType.SHOT,
        start: 10,
        end: 20,
        duration: 10,
        version: 1,
        processor: 'test:1.0.0',
        clipData: {
          sourceLabel: 'label123',
        },
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      mockPb.collection().getList.mockResolvedValue({
        items: [mockClip],
        page: 1,
        perPage: 1,
        totalItems: 1,
        totalPages: 1,
      });

      const result = await mutator.findDerivedClip('media1', 'label123');

      expect(result).toEqual(mockClip);
      expect(mockPb.collection().getList).toHaveBeenCalledWith(
        1,
        1,
        expect.objectContaining({
          filter: 'MediaRef = "media1" && clipData.sourceLabel = "label123"',
        })
      );
    });

    it('should return null when no derived clip exists', async () => {
      mockPb.collection().getList.mockResolvedValue({
        items: [],
        page: 1,
        perPage: 1,
        totalItems: 0,
        totalPages: 0,
      });

      const result = await mutator.findDerivedClip('media1', 'label123');

      expect(result).toBeNull();
    });
  });

  describe('createFromLabel', () => {
    const mockLabelClip: LabelClip = {
      id: 'label123',
      collectionId: 'labelclips',
      collectionName: 'LabelClips',
      expand: {},
      WorkspaceRef: 'ws1',
      MediaRef: 'media1',
      labelHash: 'hash123',
      labelType: LabelType.SHOT,
      type: 'shot',
      start: 10.5,
      end: 20.5,
      duration: 10,
      confidence: 0.95,
      version: 2,
      processor: 'label-normalizer:1.0.0',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      labelData: {
        entityId: 'shot_1',
        entityDescription: 'Scene change',
        rawJsonPath: 'labels/media1/v2/google_video_intelligence.json',
      },
      created: '2024-01-01T00:00:00Z',
      updated: '2024-01-01T00:00:00Z',
    };

    it('should create a new MediaClip from a LabelClip with correct type mapping', async () => {
      // Mock no existing clip
      mockPb.collection().getList.mockResolvedValue({
        items: [],
        page: 1,
        perPage: 1,
        totalItems: 0,
        totalPages: 0,
      });

      const mockCreatedClip: MediaClip = {
        id: 'clip123',
        collectionId: 'mediaclips',
        collectionName: 'MediaClips',
        expand: {},
        WorkspaceRef: 'ws1',
        MediaRef: 'media1',
        type: ClipType.SHOT,
        start: 10.5,
        end: 20.5,
        duration: 10,
        version: 2,
        processor: 'label-normalizer:1.0.0',
        clipData: {
          sourceLabel: 'label123',
          labelType: LabelType.SHOT,
          confidence: 0.95,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        },
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      mockPb.collection().create.mockResolvedValue(mockCreatedClip);

      const result = await mutator.createFromLabel(mockLabelClip);

      expect(result).toEqual(mockCreatedClip);
      expect(mockPb.collection().create).toHaveBeenCalledWith(
        expect.objectContaining({
          WorkspaceRef: 'ws1',
          MediaRef: 'media1',
          type: ClipType.SHOT,
          start: 10.5,
          end: 20.5,
          duration: 10,
          version: 2,
          processor: 'label-normalizer:1.0.0',
          clipData: {
            sourceLabel: 'label123',
            labelType: LabelType.SHOT,
            confidence: 0.95,
            provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          },
        }),
        expect.objectContaining({
          expand: expect.any(String),
        })
      );
    });

    it('should map all label types correctly to clip types', async () => {
      mockPb.collection().getList.mockResolvedValue({
        items: [],
        page: 1,
        perPage: 1,
        totalItems: 0,
        totalPages: 0,
      });

      const labelTypes = [
        { label: LabelType.OBJECT, clip: ClipType.OBJECT },
        { label: LabelType.SHOT, clip: ClipType.SHOT },
        { label: LabelType.PERSON, clip: ClipType.PERSON },
        { label: LabelType.SPEECH, clip: ClipType.SPEECH },
      ];

      for (const { label, clip } of labelTypes) {
        const labelClip = { ...mockLabelClip, labelType: label };
        mockPb.collection().create.mockResolvedValue({
          id: 'clip123',
          type: clip,
        });

        await mutator.createFromLabel(labelClip);

        expect(mockPb.collection().create).toHaveBeenCalledWith(
          expect.objectContaining({
            type: clip,
          }),
          expect.any(Object)
        );
      }
    });

    it('should return existing clip if deduplication finds one', async () => {
      const existingClip: MediaClip = {
        id: 'existing_clip',
        collectionId: 'mediaclips',
        collectionName: 'MediaClips',
        expand: {},
        WorkspaceRef: 'ws1',
        MediaRef: 'media1',
        type: ClipType.SHOT,
        start: 10.5,
        end: 20.5,
        duration: 10,
        version: 2,
        processor: 'label-normalizer:1.0.0',
        clipData: {
          sourceLabel: 'label123',
        },
        created: '2024-01-01T00:00:00Z',
        updated: '2024-01-01T00:00:00Z',
      };

      mockPb.collection().getList.mockResolvedValue({
        items: [existingClip],
        page: 1,
        perPage: 1,
        totalItems: 1,
        totalPages: 1,
      });

      const result = await mutator.createFromLabel(mockLabelClip);

      expect(result).toEqual(existingClip);
      expect(mockPb.collection().create).not.toHaveBeenCalled();
    });

    it('should use custom processor version if provided', async () => {
      mockPb.collection().getList.mockResolvedValue({
        items: [],
        page: 1,
        perPage: 1,
        totalItems: 0,
        totalPages: 0,
      });

      mockPb.collection().create.mockResolvedValue({
        id: 'clip123',
        processor: 'custom-processor:2.0.0',
      });

      await mutator.createFromLabel(mockLabelClip, 'custom-processor:2.0.0');

      expect(mockPb.collection().create).toHaveBeenCalledWith(
        expect.objectContaining({
          processor: 'custom-processor:2.0.0',
        }),
        expect.any(Object)
      );
    });

    it('should copy time values exactly from label clip', async () => {
      mockPb.collection().getList.mockResolvedValue({
        items: [],
        page: 1,
        perPage: 1,
        totalItems: 0,
        totalPages: 0,
      });

      const labelWithPreciseTime = {
        ...mockLabelClip,
        start: 123.456789,
        end: 234.56789,
        duration: 111.111101,
      };

      mockPb.collection().create.mockResolvedValue({
        id: 'clip123',
      });

      await mutator.createFromLabel(labelWithPreciseTime);

      expect(mockPb.collection().create).toHaveBeenCalledWith(
        expect.objectContaining({
          start: 123.456789,
          end: 234.56789,
          duration: 111.111101,
        }),
        expect.any(Object)
      );
    });
  });
});
