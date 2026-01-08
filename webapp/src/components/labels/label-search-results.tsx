'use client';

import type { LabelClip, Media } from '@project/shared';
import { LabelSearchResultItem } from './label-search-result-item';

interface LabelSearchResultsProps {
  labels: LabelClip[];
  media: Media;
  onJumpToTime: (label: LabelClip) => void;
  onCreateClip: (label: LabelClip) => void;
  onAddToTimeline?: (label: LabelClip) => void;
  derivedClipIds?: Set<string>;
  onViewClip?: (clipId: string) => void;
  isLoading?: boolean;
}

export function LabelSearchResults({
  labels,
  media,
  onJumpToTime,
  onCreateClip,
  onAddToTimeline,
  derivedClipIds,
  onViewClip,
  isLoading,
}: LabelSearchResultsProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (labels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No labels found</p>
        <p className="text-xs mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {labels.map((label) => {
        const hasDerivedClip = derivedClipIds?.has(label.id);

        return (
          <LabelSearchResultItem
            key={label.id}
            label={label}
            media={media}
            hasDerivedClip={hasDerivedClip}
            onJumpToTime={onJumpToTime}
            onCreateClip={onCreateClip}
            onAddToTimeline={onAddToTimeline}
            onViewClip={onViewClip}
          />
        );
      })}
    </div>
  );
}
