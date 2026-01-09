'use client';

import { useState } from 'react';
import { MediaRecommendation, LabelType, Media } from '@project/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Clock, Play, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';

interface MediaRecommendationCardProps {
  recommendation: MediaRecommendation;
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
export function MediaRecommendationCard({
  recommendation,
  selected = false,
  onSelect,
  onCreateClip,
  className,
}: MediaRecommendationCardProps) {
  const [isHovering, setIsHovering] = useState(false);

  // Format time as MM:SS
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate duration
  const duration = recommendation.end - recommendation.start;

  // Normalize labelType to single value (it can be an array due to SelectField)
  const labelType = Array.isArray(recommendation.labelType)
    ? recommendation.labelType[0]
    : recommendation.labelType;

  // Get label type display name
  const getLabelTypeDisplay = (type: LabelType): string => {
    const displayMap: Record<LabelType, string> = {
      [LabelType.OBJECT]: 'Object',
      [LabelType.SHOT]: 'Shot',
      [LabelType.PERSON]: 'Person',
      [LabelType.SPEECH]: 'Speech',
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
    };
    return variantMap[type] || 'outline';
  };

  // Get Media from expanded relations - much simpler than TimelineRecommendation!
  const media = recommendation.expand?.MediaRef as Media | undefined;

  const handleClick = () => {
    if (onSelect) {
      onSelect(recommendation);
    }
  };

  const handleCreateClip = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card selection when clicking create button
    if (onCreateClip) {
      onCreateClip(recommendation);
    }
  };

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all overflow-hidden p-0 hover:shadow-md hover:border-primary/50',
        selected && 'border-primary shadow-md ring-2 ring-primary/20',
        className
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={handleClick}
    >
      <CardContent className="p-0 flex flex-col">
        {/* Thumbnail/Preview Area */}
        <div className="w-full h-32 bg-muted/50 relative overflow-hidden border-b border-border/50">
          {media ? (
            <SpriteAnimator
              media={media}
              start={recommendation.start}
              end={recommendation.end}
              isHovering={isHovering}
              className="absolute inset-0"
              fallbackIcon={
                <div className="flex items-center justify-center h-full text-muted-foreground/50">
                  <div className="text-muted-foreground/50 text-sm text-center px-4">
                    {formatTime(recommendation.start)} -{' '}
                    {formatTime(recommendation.end)}
                  </div>
                </div>
              }
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-muted-foreground/50 text-sm">
                {formatTime(recommendation.start)} -{' '}
                {formatTime(recommendation.end)}
              </div>
            </div>
          )}

          {/* Hover overlay with play icon */}
          {isHovering && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity z-10">
              <Play className="h-12 w-12 text-white/90" />
            </div>
          )}
          {/* Selected indicator - top left */}
          {selected && (
            <div className="absolute top-2 left-2 z-20 bg-primary text-primary-foreground rounded-full p-1.5 shadow-lg">
              <Play className="h-3 w-3" />
            </div>
          )}
          {/* Create Clip button - top right */}
          {onCreateClip && (
            <div className="absolute top-2 right-2 z-20">
              <Button
                size="icon"
                variant="default"
                className="h-8 w-8 rounded-full shadow-lg hover:scale-110 transition-transform"
                onClick={handleCreateClip}
                title="Create clip"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-4 flex flex-col gap-3">
          {/* Header: Label Type Badge and Time Range */}
          <div className="flex items-center justify-between gap-2">
            <Badge
              variant={getLabelTypeVariant(labelType)}
              className="uppercase text-[10px] font-semibold h-5 px-2"
            >
              {getLabelTypeDisplay(labelType)}
            </Badge>
            <span className="text-xs font-medium tabular-nums text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {duration.toFixed(1)}s
            </span>
          </div>

          {/* Time Range */}
          <div className="text-xs font-mono text-muted-foreground">
            {formatTime(recommendation.start)} -{' '}
            {formatTime(recommendation.end)}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
