'use client';

import { LabelType, Media, MediaRecommendation } from '@project/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Play, Plus, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface MediaRecommendationCardProps {
  recommendation: MediaRecommendation;
  media?: Media;
  selected?: boolean;
  onSelect?: (recommendation: MediaRecommendation) => void;
  onCreateClip?: (recommendation: MediaRecommendation) => void;
  className?: string;
}

/**
 * MediaRecommendationCard Component
 *
 * Displays a single media recommendation with:
 * - Thumbnail/preview area
 * - Time range display
 * - Label type badge
 * - Reason text explaining the recommendation
 * - Clickable card that selects and previews the recommendation
 * - Create clip icon button
 *
 * Requirements: 10.2, 10.3, 10.4
 */
import { MediaBaseCard } from '@/components/media/media-base-card';

export function MediaRecommendationCard({
  recommendation,
  media,
  selected = false,
  onSelect,
  onCreateClip,
  className,
}: MediaRecommendationCardProps) {
  // Calculate duration
  const duration = recommendation.end - recommendation.start;

  // Normalize labelType to single value
  const labelType = Array.isArray(recommendation.labelType)
    ? (recommendation.labelType[0] as LabelType)
    : (recommendation.labelType as LabelType);

  // Get label type display name
  const getLabelTypeDisplay = (type: LabelType): string => {
    const displayMap: Record<LabelType, string> = {
      [LabelType.OBJECT]: 'Object',
      [LabelType.SHOT]: 'Shot',
      [LabelType.PERSON]: 'Person',
      [LabelType.SPEECH]: 'Speech',
      [LabelType.FACE]: 'Face',
    };
    return displayMap[type] || type;
  };

  // Get label type color variant
  const getLabelTypeVariant = (
    type: LabelType
  ): 'default' | 'secondary' | 'outline' => {
    const variantMap: Record<LabelType, 'default' | 'secondary' | 'outline'> = {
      [LabelType.OBJECT]: 'default',
      [LabelType.SHOT]: 'secondary',
      [LabelType.PERSON]: 'outline',
      [LabelType.SPEECH]: 'outline',
      [LabelType.FACE]: 'outline',
    };
    return variantMap[type] || 'outline';
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <MediaBaseCard
      media={media}
      startTime={recommendation.start}
      endTime={recommendation.end}
      className={cn(
        'group transition-all duration-300',
        selected && 'border-primary ring-2 ring-primary/20 bg-primary/5',
        className
      )}
      onSelect={() => onSelect?.(recommendation)}
      title={
        <div className="flex items-center gap-2">
          <Badge
            variant={getLabelTypeVariant(labelType)}
            className="uppercase text-[10px] font-bold h-5 px-1.5 bg-background/80 backdrop-blur-sm"
          >
            {getLabelTypeDisplay(labelType)}
          </Badge>
          <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-background/80 backdrop-blur-sm px-1.5 h-5 rounded-md">
            <Clock className="h-3 w-3" />
            {duration.toFixed(1)}s
          </div>
        </div>
      }
      subtitle={
        <div className="mt-1">
          <p className="text-[11px] leading-tight text-foreground/90 font-medium line-clamp-2">
            {recommendation.reason}
          </p>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
              {formatTime(recommendation.start)} —{' '}
              {formatTime(recommendation.end)}
            </span>
            <div className="flex items-center gap-1">
              <span className="text-[10px] font-bold text-primary">
                {Math.round(recommendation.score * 100)}%
              </span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 text-muted-foreground/30 hover:text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-[10px]">
                      Confidence: {Math.round(recommendation.score * 100)}%
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </div>
      }
      badges={
        [
          selected && (
            <div
              key="selected"
              className="bg-primary text-primary-foreground rounded-full p-1 shadow-lg animate-in zoom-in-50 duration-300"
            >
              <Play className="h-3 w-3 fill-current" />
            </div>
          ),
        ].filter(Boolean) as React.ReactNode[]
      }
      overlayActions={
        [
          onCreateClip && (
            <Button
              key="create"
              size="icon"
              variant="default"
              className="h-8 w-8 rounded-full shadow-xl lg:translate-y-2 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 transition-all duration-300"
              onClick={(e) => {
                e.stopPropagation();
                onCreateClip(recommendation);
              }}
            >
              <Plus className="h-4 w-4" />
            </Button>
          ),
        ].filter(Boolean) as React.ReactNode[]
      }
      thumbnailHeight="h-32"
    />
  );
}
