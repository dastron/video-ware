'use client';

import { useState } from 'react';
import type { LabelClip, Media } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, Plus, ExternalLink } from 'lucide-react';
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
  onAddToTimeline: _onAddToTimeline,
  onViewClip,
}: LabelSearchResultItemProps) {
  const [isHovering, setIsHovering] = useState(false);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getLabelName = (label: LabelClip): string => {
    const labelData = label.labelData as Record<string, unknown>;
    const fallbackName = Array.isArray(label.labelType)
      ? String(label.labelType[0] || 'Label')
      : String(label.labelType || 'Label');
    return (
      (labelData?.entityDescription as string) ||
      (labelData?.transcript as string)?.substring(0, 50) ||
      fallbackName.charAt(0).toUpperCase() + fallbackName.slice(1).toLowerCase()
    );
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const labelName = getLabelName(label);

  const handleCardClick = () => {
    onJumpToTime(label);
  };

  const handleActionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (hasDerivedClip && onViewClip) {
      onViewClip(label.id);
    } else {
      onCreateClip(label);
    }
  };

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all overflow-hidden p-0',
        'hover:shadow-md hover:border-primary/50 border-border'
      )}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={handleCardClick}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Sprite Preview */}
        <div className="w-32 shrink-0 self-stretch min-h-[80px] bg-muted/50 relative overflow-hidden rounded-l-xl border-r border-border/50">
          <SpriteAnimator
            media={media}
            start={label.start}
            end={label.end}
            isHovering={isHovering}
            className="absolute inset-0"
          />
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col justify-center min-w-0 gap-1.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className="uppercase text-[10px] font-semibold h-5 px-2 shrink-0"
            >
              {label.labelType}
            </Badge>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {formatTime(label.start)} - {formatTime(label.end)}
            </span>
          </div>

          <div className="text-sm font-medium line-clamp-2">{labelName}</div>

          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="tabular-nums">{label.duration.toFixed(1)}s</span>
            <span className="flex items-center gap-1 ml-2">
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

        {/* Action Icon CTA */}
        <div className="flex flex-col border-l border-border/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleActionClick}
            className="h-full rounded-none border-b border-border/50 hover:bg-primary/10"
            title={hasDerivedClip ? 'View clip' : 'Create clip'}
          >
            {hasDerivedClip && onViewClip ? (
              <ExternalLink className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
