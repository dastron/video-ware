'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import type { MediaClip, Media } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Film, Clock, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';

/**
 * Extended MediaClip type with expanded relations
 */
export interface MediaClipWithExpand extends Omit<MediaClip, 'expand'> {
  expand?: {
    MediaRef?: Media & {
      expand?: {
        UploadRef?: {
          filename: string;
          name?: string;
        };
        thumbnailFileRef?: {
          id: string;
          collectionId: string;
          file: string;
        };
      };
    };
  };
}

// Card dimensions
export const CARD_WIDTH = 200;
export const CARD_HEIGHT = 160;

interface ClipBrowserItemProps {
  clip: MediaClipWithExpand;
  onAddToTimeline: (clip: MediaClipWithExpand) => void;
}

export function ClipBrowserItem({
  clip,
  onAddToTimeline,
}: ClipBrowserItemProps) {
  const duration = clip.end - clip.start;
  const media = clip.expand?.MediaRef;
  const upload = media?.expand?.UploadRef;
  const thumbnailFile = media?.expand?.thumbnailFileRef;
  const [isHovering, setIsHovering] = useState(false);
  const [isClicked, setIsClicked] = useState(false);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getThumbnailUrl = (): string | null => {
    if (!thumbnailFile?.file) return null;
    try {
      return pb.files.getURL(thumbnailFile, thumbnailFile.file);
    } catch {
      return null;
    }
  };

  const thumbnailUrl = getThumbnailUrl();
  const mediaName = upload?.filename || upload?.name || 'Unknown Media';

  // Combine hover and click states for animation
  const isAnimating = isHovering || isClicked;

  // Reset click state after a delay
  useEffect(() => {
    if (isClicked) {
      const timer = setTimeout(() => {
        setIsClicked(false);
      }, 2000); // Play animation for 2 seconds on click
      return () => clearTimeout(timer);
    }
  }, [isClicked]);

  const handleDragStart = (e: React.DragEvent) => {
    // Set drag data for desktop drag-and-drop
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'media-clip',
        clipId: clip.id,
        mediaId: clip.MediaRef,
        start: clip.start,
        end: clip.end,
        clipType: clip.type,
      })
    );
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleClick = () => {
    // Trigger animation on click
    setIsClicked(true);
  };

  return (
    <Card
      draggable
      onDragStart={handleDragStart}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onClick={handleClick}
      className={cn(
        'cursor-grab active:cursor-grabbing relative group',
        'hover:shadow-md transition-shadow overflow-hidden',
        'p-0 gap-0' // Override default Card padding and gap
      )}
      style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
    >
      <CardContent className="p-2.5 h-full flex flex-col">
        {/* Thumbnail / Sprite Preview */}
        <div className="relative w-full h-24 bg-muted rounded overflow-hidden mb-2 flex-shrink-0">
          {media ? (
            <SpriteAnimator
              media={media}
              start={clip.start}
              end={clip.end}
              isHovering={isAnimating}
              className="absolute inset-0"
              fallbackIcon={
                <div className="flex items-center justify-center h-full">
                  <Film className="h-6 w-6 text-muted-foreground" />
                </div>
              }
            />
          ) : thumbnailUrl ? (
            <Image
              src={thumbnailUrl}
              alt={`Thumbnail for ${mediaName}`}
              fill
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <Film className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          {/* Duration Badge */}
          <div className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-medium z-10">
            {formatTime(duration)}
          </div>

          {/* Add to Timeline Icon Button - Overlay on thumbnail */}
          <Button
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onAddToTimeline(clip);
            }}
            className="absolute top-1.5 right-1.5 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-10"
            title="Add to Timeline"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Clip Info */}
        <div className="flex flex-col gap-1.5 flex-1 min-h-0">
          <div className="flex items-start justify-between gap-1.5 min-w-0">
            <h4
              className="text-xs font-medium text-foreground truncate flex-1 min-w-0 leading-tight"
              title={mediaName}
            >
              {mediaName}
            </h4>
            <Badge
              variant="outline"
              className="text-[10px] px-1.5 py-0.5 h-auto flex-shrink-0 whitespace-nowrap leading-none"
            >
              {clip.type}
            </Badge>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
            <Clock className="h-3 w-3 flex-shrink-0" />
            <span className="truncate font-medium">
              {formatTime(clip.start)} - {formatTime(clip.end)}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
