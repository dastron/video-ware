'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { LabelClip, Media } from '@project/shared';
import { LabelClipMutator, MediaClipMutator } from '@project/shared/mutator';
import pb from '@/lib/pocketbase-client';
import {
  LabelSearchFilters,
  type LabelSearchFilterValues,
} from './label-search-filters';
import { LabelSearchResults } from './label-search-results';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ChevronLeft, ChevronRight, AlertCircle } from 'lucide-react';

interface LabelSearchPanelProps {
  media: Media;
  onJumpToTime: (timeInSeconds: number) => void;
  onClipCreated?: () => void;
  onViewClip?: (clipId: string) => void;
  onAddToTimeline?: (mediaId: string, start: number, end: number, clipId?: string) => void;
}

const ITEMS_PER_PAGE = 20;

export function LabelSearchPanel({
  media,
  onJumpToTime,
  onClipCreated,
  onViewClip,
  onAddToTimeline,
}: LabelSearchPanelProps) {
  const [filters, setFilters] = useState<LabelSearchFilterValues>({
    confidenceThreshold: 0,
  });
  const [debouncedFilters, setDebouncedFilters] =
    useState<LabelSearchFilterValues>(filters);
  const [labels, setLabels] = useState<LabelClip[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [derivedClipIds, setDerivedClipIds] = useState<Set<string>>(new Set());
  const [labelToClipMap, setLabelToClipMap] = useState<Map<string, string>>(
    new Map()
  );

  // Create mutator instances
  const labelClipMutator = useMemo(() => new LabelClipMutator(pb), []);
  const mediaClipMutator = useMemo(() => new MediaClipMutator(pb), []);

  // Debounce filters (especially search query)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedFilters(filters);
      setCurrentPage(1); // Reset to first page when filters change
    }, 300);
    return () => clearTimeout(timer);
  }, [filters]);

  // Load labels based on filters
  const loadLabels = useCallback(async () => {
    if (!media?.id) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await labelClipMutator.search(
        {
          mediaRef: media.id,
          ...debouncedFilters,
        },
        currentPage,
        ITEMS_PER_PAGE
      );

      setLabels(result.items);
      setTotalPages(result.totalPages);
      setTotalItems(result.totalItems);

      // Load derived clip information
      const labelIds = result.items.map((label) => label.id);
      const derivedClips = await Promise.all(
        labelIds.map((labelId) =>
          mediaClipMutator.findDerivedClip(media.id, labelId)
        )
      );

      const derivedSet = new Set<string>();
      const clipMap = new Map<string, string>();
      derivedClips.forEach((clip, index) => {
        if (clip) {
          const labelId = labelIds[index];
          derivedSet.add(labelId);
          clipMap.set(labelId, clip.id);
        }
      });
      setDerivedClipIds(derivedSet);
      setLabelToClipMap(clipMap);
    } catch (err) {
      console.error('Failed to load labels:', err);
      setError(err instanceof Error ? err.message : 'Failed to load labels');
    } finally {
      setIsLoading(false);
    }
  }, [
    media?.id,
    debouncedFilters,
    currentPage,
    labelClipMutator,
    mediaClipMutator,
  ]);

  // Load labels when filters or page changes
  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  const handleJumpToTime = useCallback(
    (label: LabelClip) => {
      onJumpToTime(label.start);
    },
    [onJumpToTime]
  );

  const handleCreateClip = useCallback(
    async (label: LabelClip) => {
      try {
        setIsLoading(true);
        await mediaClipMutator.createFromLabel(label);
        // Refresh labels to update derived clip status
        await loadLabels();
        onClipCreated?.();
      } catch (err) {
        console.error('Failed to create clip:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to create clip'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [mediaClipMutator, loadLabels, onClipCreated]
  );

  const handleViewClip = useCallback(
    (labelId: string) => {
      const clipId = labelToClipMap.get(labelId);
      if (clipId && onViewClip) {
        onViewClip(clipId);
      }
    },
    [labelToClipMap, onViewClip]
  );

  const handleAddToTimeline = useCallback(
    async (label: LabelClip) => {
      if (!onAddToTimeline) return;

      try {
        setIsLoading(true);
        // First, create or get the derived clip
        const clip = await mediaClipMutator.createFromLabel(label);
        // Then add it to the timeline
        await onAddToTimeline(label.MediaRef, label.start, label.end, clip.id);
        // Refresh labels to update derived clip status
        await loadLabels();
        onClipCreated?.();
      } catch (err) {
        console.error('Failed to add to timeline:', err);
        setError(
          err instanceof Error ? err.message : 'Failed to add to timeline'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [onAddToTimeline, mediaClipMutator, loadLabels, onClipCreated]
  );

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Filters */}
      <LabelSearchFilters
        filters={filters}
        onFiltersChange={setFilters}
        maxDuration={media.duration}
      />

      {/* Error Alert */}
      {error && (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-4">
        <LabelSearchResults
          labels={labels}
          onJumpToTime={handleJumpToTime}
          onCreateClip={handleCreateClip}
          onAddToTimeline={onAddToTimeline ? handleAddToTimeline : undefined}
          derivedClipIds={derivedClipIds}
          onViewClip={handleViewClip}
          isLoading={isLoading}
        />
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="border-t p-4 flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages} ({totalItems} total)
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePreviousPage}
              disabled={currentPage === 1 || isLoading}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleNextPage}
              disabled={currentPage === totalPages || isLoading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
