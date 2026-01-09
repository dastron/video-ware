'use client';

import { useState } from 'react';
import {
  TimelineRecommendation,
  RecommendationStrategy,
  MediaClip,
  Media,
} from '@project/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, Replace, X, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';

interface TimelineRecommendationCardProps {
  recommendation: TimelineRecommendation;
  onAdd?: (recommendation: TimelineRecommendation) => void;
  onReplace?: (recommendation: TimelineRecommendation) => void;
  onDismiss?: (recommendation: TimelineRecommendation) => void;
  className?: string;
}

/**
 * TimelineRecommendationCard Component
 *
 * Displays a single timeline recommendation with:
 * - Thumbnail/preview area
 * - Clip label/name
 * - Reason text explaining the recommendation
 * - Strategy badge for explainability
 * - Action buttons for "Add", "Replace", and "Dismiss"
 *
 * Requirements: 11.2, 11.3, 11.4, 11.5
 */
export function TimelineRecommendationCard({
  recommendation,
  onAdd,
  onReplace,
  onDismiss,
  className,
}: TimelineRecommendationCardProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // Get strategy display name
  const getStrategyDisplay = (strategy: RecommendationStrategy): string => {
    const displayMap: Record<RecommendationStrategy, string> = {
      [RecommendationStrategy.SAME_ENTITY]: 'Same Entity',
      [RecommendationStrategy.ADJACENT_SHOT]: 'Adjacent Shot',
      [RecommendationStrategy.TEMPORAL_NEARBY]: 'Nearby',
      [RecommendationStrategy.CONFIDENCE_DURATION]: 'High Confidence',
    };
    return displayMap[strategy] || strategy;
  };

  // Get strategy color variant
  const getStrategyVariant = (
    strategy: RecommendationStrategy
  ): 'default' | 'secondary' | 'outline' => {
    const variantMap: Record<
      RecommendationStrategy,
      'default' | 'secondary' | 'outline'
    > = {
      [RecommendationStrategy.SAME_ENTITY]: 'default',
      [RecommendationStrategy.ADJACENT_SHOT]: 'secondary',
      [RecommendationStrategy.TEMPORAL_NEARBY]: 'outline',
      [RecommendationStrategy.CONFIDENCE_DURATION]: 'default',
    };
    return variantMap[strategy] || 'outline';
  };

  // Handle action with loading state
  const handleAction = async (
    action: ((rec: TimelineRecommendation) => void | Promise<void>) | undefined,
    rec: TimelineRecommendation
  ) => {
    if (!action) return;

    setIsProcessing(true);
    try {
      await action(rec);
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Normalize strategy to single value (it can be an array due to SelectField)
  const strategy = Array.isArray(recommendation.strategy)
    ? recommendation.strategy[0]
    : recommendation.strategy;

  // Calculate score percentage for display
  const scorePercentage = Math.round(recommendation.score * 100);

  // Extract Media directly from MediaClipRef - much simpler!
  const mediaClip = recommendation.expand?.MediaClipRef as
    | (MediaClip & { expand?: { MediaRef?: Media } })
    | undefined;
  const media = mediaClip?.expand?.MediaRef as Media | undefined;
  const clipStart = mediaClip?.start;
  const clipEnd = mediaClip?.end;

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all overflow-hidden p-0 hover:shadow-md hover:border-primary/50 w-full',
        isProcessing && 'opacity-60 pointer-events-none',
        className
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <CardContent className="p-0 flex flex-col">
        {/* Thumbnail/Preview Area */}
        <div className="w-full h-20 bg-muted/50 relative overflow-hidden border-b border-border/50">
          {media && clipStart !== undefined && clipEnd !== undefined ? (
            <SpriteAnimator
              media={media}
              start={clipStart}
              end={clipEnd}
              isHovering={isHovering}
              className="absolute inset-0"
              fallbackIcon={
                <div className="flex items-center justify-center h-full text-muted-foreground/50">
                  <PlayCircle className="h-6 w-6" strokeWidth={1.5} />
                </div>
              }
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-muted-foreground/50 text-sm text-center px-4">
                Clip Preview
              </div>
            </div>
          )}

          {/* Hover overlay with action hint */}
          {isHovering && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity z-10">
              <div className="text-white/90 text-sm font-medium">
                {recommendation.targetMode === 'append'
                  ? 'Add to Timeline'
                  : 'Replace Clip'}
              </div>
            </div>
          )}

          {/* Score badge in top-right corner */}
          <div className="absolute top-2 right-2 z-10">
            <Badge
              variant="secondary"
              className="text-[10px] font-semibold h-5 px-2 bg-black/60 text-white border-0"
            >
              {scorePercentage}%
            </Badge>
          </div>
        </div>

        {/* Content */}
        <div className="p-3 flex flex-col gap-2">
          {/* Header: Strategy Badge and Rank */}
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant={getStrategyVariant(strategy)}
              className="uppercase text-[10px] font-semibold h-5 px-2"
            >
              {getStrategyDisplay(strategy)}
            </Badge>
            <span className="text-xs font-medium text-muted-foreground">
              #{recommendation.rank + 1}
            </span>
          </div>

          {/* Clip Label/Name */}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            {/* Add Button (for append mode) */}
            {recommendation.targetMode === 'append' && onAdd && (
              <Button
                size="sm"
                variant="default"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onAdd, recommendation);
                }}
                disabled={isProcessing}
                className="flex-1"
              >
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            )}

            {/* Replace Button (for replace mode) */}
            {recommendation.targetMode === 'replace' && onReplace && (
              <Button
                size="sm"
                variant="default"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onReplace, recommendation);
                }}
                disabled={isProcessing}
                className="flex-1"
              >
                <Replace className="h-3.5 w-3.5" />
                Replace
              </Button>
            )}

            {/* Dismiss Button */}
            {onDismiss && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  handleAction(onDismiss, recommendation);
                }}
                disabled={isProcessing}
                className="flex-1"
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
