'use client';

import { TimelineRecommendation } from '@project/shared';
import { TimelineRecommendationCard } from './timeline-recommendation-card';
import { Button } from '@/components/ui/button';
import { Sparkles, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineRecommendationsPanelProps {
  recommendations: TimelineRecommendation[];
  isLoading?: boolean;
  onAdd?: (recommendation: TimelineRecommendation) => void;
  onReplace?: (recommendation: TimelineRecommendation) => void;
  onDismiss?: (recommendation: TimelineRecommendation) => void;
  onMoreLikeThis?: () => void;
  className?: string;
}

/**
 * TimelineRecommendationsPanel Component
 *
 * Displays a panel of timeline recommendations with:
 * - "Recommendations" header
 * - List of TimelineRecommendationCards
 * - "More like this" button to trigger regeneration
 * - Empty state when no recommendations available
 *
 * Requirements: 11.1, 11.6
 */
export function TimelineRecommendationsPanel({
  recommendations,
  isLoading = false,
  onAdd,
  onReplace,
  onDismiss,
  onMoreLikeThis,
  className,
}: TimelineRecommendationsPanelProps) {
  // Show loading state
  if (isLoading) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        {/* Header */}
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" disabled className="h-8 w-8">
            <RefreshCw className="h-4 w-4 animate-spin" />
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommendations</h2>
        </div>

        {/* Loading skeleton */}
        <div className="grid grid-cols-1 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-64 bg-muted/50 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  // Show empty state
  if (!recommendations || recommendations.length === 0) {
    return (
      <div className={cn('flex flex-col gap-4', className)}>
        {/* Header */}
        <div className="flex items-center gap-2">
          {onMoreLikeThis && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMoreLikeThis}
              className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
              title="Refresh recommendations"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommendations</h2>
        </div>

        {/* Empty state */}
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center border-2 border-dashed border-border rounded-lg bg-muted/20">
          <Sparkles className="h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-base font-medium text-foreground mb-2">
            No recommendations available
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mb-4">
            Select a clip in your timeline or click refresh to get intelligent
            suggestions for what to add next.
          </p>
          {onMoreLikeThis && (
            <Button
              variant="outline"
              size="sm"
              onClick={onMoreLikeThis}
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Show recommendations
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Header with "Refresh" button on the left */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {onMoreLikeThis && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onMoreLikeThis}
              className="h-8 w-8 hover:bg-primary/10 hover:text-primary transition-colors"
              title="Refresh recommendations"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Recommendations</h2>
          <span className="text-sm text-muted-foreground ml-1">
            ({recommendations.length})
          </span>
        </div>
      </div>

      {/* Recommendations list */}
      <div className="grid grid-cols-1 gap-4 pb-8">
        {recommendations.map((recommendation) => (
          <TimelineRecommendationCard
            key={recommendation.id}
            recommendation={recommendation}
            onAdd={onAdd}
            onReplace={onReplace}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}
