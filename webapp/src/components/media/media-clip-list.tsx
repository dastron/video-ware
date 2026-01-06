import { useState } from 'react';
import type { Media, MediaClip } from '@project/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '../sprite/sprite-animator';

interface MediaClipListProps {
  media: Media;
  clips: MediaClip[];
  onClipSelect: (clip: MediaClip) => void;
  activeClipId?: string;
  className?: string;
}

export function MediaClipList({
  media,
  clips,
  onClipSelect,
  activeClipId,
  className,
}: MediaClipListProps) {
  if (clips.length === 0) {
    return (
      <div className={cn('text-center py-8 text-muted-foreground', className)}>
        No clips found for this media.
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      {clips.map((clip) => (
        <MediaClipItem
          key={clip.id}
          clip={clip}
          media={media}
          isActive={activeClipId === clip.id}
          onClick={() => onClipSelect(clip)}
        />
      ))}
    </div>
  );
}

function MediaClipItem({
  clip,
  media,
  isActive,
  onClick,
}: {
  clip: MediaClip;
  media: Media;
  isActive: boolean;
  onClick: () => void;
}) {
  const [isHovering, setIsHovering] = useState(false);

  const formatTime = (seconds: number) => {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all overflow-hidden p-0',
        isActive
          ? 'border-primary shadow-md bg-primary/5'
          : 'hover:shadow-md hover:border-primary/50 border-border'
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <CardContent className="p-0 flex items-stretch">
        {/* Sprite Preview */}
        <div className="w-32 shrink-0 self-stretch min-h-[80px] bg-muted/50 relative overflow-hidden rounded-l-xl border-r border-border/50">
          <SpriteAnimator
            media={media}
            start={clip.start}
            end={clip.end}
            isHovering={isHovering}
            className="absolute inset-0"
          />
        </div>

        {/* Content */}
        <div className="p-4 flex-1 flex flex-col justify-center min-w-0 gap-1.5">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'uppercase text-[10px] font-semibold h-5 px-2',
                isActive && 'border-primary/50 bg-primary/10'
              )}
            >
              {clip.type}
            </Badge>
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {formatTime(clip.start)} - {formatTime(clip.end)}
            </span>
          </div>

          <div
            className={cn(
              'text-sm font-medium truncate',
              isActive && 'text-primary'
            )}
          >
            {(clip.clipData as any)?.label || 'Clip'}
          </div>

          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span className="tabular-nums">{clip.duration.toFixed(1)}s</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
