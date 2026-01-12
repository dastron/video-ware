'use client';

import { useState } from 'react';
import { Media, MediaRecommendation } from '@project/shared';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ScoredMediaCandidate } from '@/services/recommendations/types';
import { MediaRecommendationCard } from './media-recommendation-card';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw, LayoutGrid } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaRecommendationsPanelProps {
  recommendations: MediaRecommendation[];
  media?: Media;
  isLoading?: boolean;
  onCreateClip?: (recommendation: MediaRecommendation) => void;
  onPreview?: (recommendation: MediaRecommendation) => void;
  onRefresh?: () => void;
  className?: string;
}

/**
 * MediaRecommendationsPanel Component
 *
 * Displays a panel of media recommendations with:
 * - "Recommended Segments" header
 * - Grid of MediaRecommendationCards (clickable to select and preview)
 * - Single "Create Clip" button at the bottom for selected recommendation
 * - "Generate More" button to trigger regeneration
 * - Empty state when no recommendations available
 * - Loading state with skeleton loaders
 *
 * Requirements: 10.2, 10.3, 10.4
 */
export function MediaRecommendationsPanel({
  recommendations,
  media,
  isLoading = false,
  onCreateClip,
  onPreview,
  onRefresh,
  className,
}: MediaRecommendationsPanelProps) {
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<MediaRecommendation | null>(null);

  const handleSelect = (recommendation: MediaRecommendation) => {
    setSelectedRecommendation(recommendation);
    if (onPreview) {
      onPreview(recommendation);
    }
  };
  // Show loading state
  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2"></div>
        </div>

        {/* Loading skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-48 bg-muted/50 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Show empty state
  if (!recommendations || recommendations.length === 0) {
    return (
      <div className={cn('flex flex-col h-full', className)}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2"></div>
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary transition-colors"
              onClick={onRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn('h-4 w-4', isLoading && 'animate-spin')}
              />
            </Button>
          )}
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center flex-1 py-12 px-6 text-center">
          <div className="bg-muted/30 p-6 rounded-full mb-6">
            <Sparkles className="h-10 w-10 text-muted-foreground/30" />
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">
            No suggestions yet
          </h3>
          <p className="text-sm text-muted-foreground max-w-[240px] leading-relaxed mb-8">
            Click refresh to generate intelligent clip suggestions based on your
            media content.
          </p>
          {onRefresh && (
            <Button
              variant="default"
              className="rounded-full px-8 shadow-lg shadow-primary/20"
              onClick={onRefresh}
            >
              Refresh Recommendations
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full bg-background/50', className)}>
      {/* Refined Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b sticky top-0 bg-background/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 p-2 rounded-lg">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight uppercase">
              AI Suggestions
            </h2>
            <p className="text-[10px] text-muted-foreground font-medium">
              {recommendations.length} SEGMENTS FOUND
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {onRefresh && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-primary transition-colors hover:bg-primary/5"
              onClick={onRefresh}
              disabled={isLoading}
              title="Refresh suggestions"
            >
              <RefreshCw
                className={cn('h-4 w-4', isLoading && 'animate-spin')}
              />
            </Button>
          )}
        </div>
      </div>

      {/* Recommendations Grid - Single Column for Sidebar/Panel feel */}
      <div className="flex-1 overflow-y-auto">
        {recommendations.map((recommendation, idx) => (
          <MediaRecommendationCard
            key={`${recommendation.start}-${recommendation.end}-${idx}`}
            recommendation={recommendation}
            media={media}
            selected={
              selectedRecommendation?.start === recommendation.start &&
              selectedRecommendation?.end === recommendation.end
            }
            onSelect={handleSelect}
            onCreateClip={onCreateClip}
          />
        ))}

        {/* Subtle footer */}
        <div className="py-8 flex flex-col items-center gap-2 opacity-30 grayscale">
          <LayoutGrid className="h-6 w-6" />
          <span className="text-[10px] font-bold uppercase tracking-widest">
            End of suggestions
          </span>
        </div>
      </div>
    </div>
  );
}
