'use client';

import { useState } from 'react';
import type { LabelClip, Media } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, Play, Scissors, ExternalLink, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '../sprite/sprite-animator';

interface LabelSearchResultItemProps {
  label: LabelClip;
  media: Media;
  hasDerivedClip?: boolean;
  onJumpToTime: (label: LabelClip) => void;
  onCreateClip: (label: LabelClip) => void;
  onAddToTimeline?: (label: LabelClip) => void;
  onViewClip?: (clipId: string) => void;
}

export function LabelSearchResultItem({
  label,
  media,
  hasDerivedClip = false,
  onJumpToTime,
  onCreateClip,
  onAddToTimeline,
  onViewClip,
}: LabelSearchResultItemProps) {
  const [isHovering, setIsHovering] = useState(false);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const getLabelName = (label: LabelClip): string => {
    const labelData = label.labelData as Record<string, unknown>;
    return (
      (labelData?.entityDescription as string) ||
      (labelData?.transcript as string)?.substring(0, 50) ||
      'Unknown Label'
    );
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const labelName = getLabelName(label);

  return (
    <Card
      className="hover:shadow-md transition-shadow overflow-hidden p-0"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Sprite Preview */}
        <div className="w-36 shrink-0 self-stretch min-h-[120px] bg-muted/50 relative overflow-hidden rounded-l-xl border-r border-border/50">
          <SpriteAnimator
            media={media}
            start={label.start}
            end={label.end}
            isHovering={isHovering}
            className="absolute inset-0"
          />
        </div>

        {/* Content */}
        <div className="p-4 flex-1 min-w-0 flex flex-col justify-center gap-2">
          {/* Header with Badge */}
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium truncate flex-1">{labelName}</h4>
            <Badge
              variant="outline"
              className="text-[10px] shrink-0 capitalize h-5 px-1.5"
            >
              {label.labelType}
            </Badge>
          </div>

          {/* Time, Duration, and Confidence in one row */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              <span className="tabular-nums">
                {formatTime(label.start)} - {formatTime(label.end)}
              </span>
            </div>
            <span className="tabular-nums">
              {formatDuration(label.duration)}
            </span>
            <span className="flex items-center gap-1">
              <span>Conf:</span>
              <span
                className={cn(
                  'font-medium tabular-nums',
                  getConfidenceColor(label.confidence)
                )}
              >
                {Math.round(label.confidence * 100)}%
              </span>
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 shrink-0 p-3 border-l border-border/50">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onJumpToTime(label)}
            className="gap-1.5 text-xs h-7 px-2"
          >
            <Play className="h-3 w-3" />
            Jump
          </Button>

          {hasDerivedClip && onViewClip ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onViewClip(label.id);
              }}
              className="gap-1.5 text-xs h-7 px-2"
            >
              <ExternalLink className="h-3 w-3" />
              View
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onCreateClip(label)}
              className="gap-1.5 text-xs h-7 px-2"
            >
              <Scissors className="h-3 w-3" />
              Create
            </Button>
          )}

          {/* Add to Timeline button - only shown when timeline context is available */}
          {onAddToTimeline && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAddToTimeline(label)}
              className="gap-1.5 text-xs h-7 px-2"
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
