'use client';

import { useState } from 'react';
import { MediaRecommendation } from '@project/shared';
import { MediaRecommendationCard } from './media-recommendation-card';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaRecommendationsPanelProps {
  recommendations: MediaRecommendation[];
  isLoading?: boolean;
  onCreateClip?: (recommendation: MediaRecommendation) => void;
  onPreview?: (recommendation: MediaRecommendation) => void;
  onGenerateMore?: () => void;
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
  isLoading = false,
  onCreateClip,
  onPreview,
  onGenerateMore,
  className,
}: MediaRecommendationsPanelProps) {
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<MediaRecommendation | null>(null);

  // Filter out recommendations that have already been converted to clips
  const availableRecommendations = recommendations.filter(
    (rec) => !rec.MediaClipRef
  );

  const handleSelect = (recommendation: MediaRecommendation) => {
    setSelectedRecommendation(recommendation);
    // Trigger preview when selecting
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
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Recommended Segments</h2>
          </div>
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
  if (!availableRecommendations || availableRecommendations.length === 0) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Recommended Segments</h2>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-border rounded-lg bg-muted/20">
          <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-base font-medium text-foreground mb-2">
            No recommendations available
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Generate intelligent recommendations for this media based on labels
            and content analysis.
          </p>
          {onGenerateMore && (
            <Button variant="outline" size="sm" onClick={onGenerateMore}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Generate Recommendations
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Show recommendations
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Header with "Generate More" button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommended Segments</h2>
          <span className="text-sm text-muted-foreground">
            ({availableRecommendations.length})
          </span>
        </div>

        {onGenerateMore && (
          <Button variant="outline" size="sm" onClick={onGenerateMore}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Generate More
          </Button>
        )}
      </div>

      {/* Recommendations grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {availableRecommendations.map((recommendation) => (
          <MediaRecommendationCard
            key={recommendation.id}
            recommendation={recommendation}
            selected={selectedRecommendation?.id === recommendation.id}
            onSelect={handleSelect}
            onCreateClip={onCreateClip}
          />
        ))}
      </div>
    </div>
  );
}
