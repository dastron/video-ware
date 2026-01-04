'use client';

import { useState, useRef } from 'react';
import Image from 'next/image';
import type { Media } from '@project/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Film, Clock, Maximize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import pb from '@/lib/pocketbase';

interface MediaCardProps {
  media: Media;
  onClick?: () => void;
  className?: string;
}

export function MediaCard({ media, onClick, className }: MediaCardProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [spritePosition, setSpritePosition] = useState({ x: 0, y: 0 });
  const cardRef = useRef<HTMLDivElement>(null);

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDimensions = (width?: number, height?: number): string => {
    if (!width || !height) return 'Unknown';
    return `${width}×${height}`;
  };

  const getCodec = (): string => {
    if (media.mediaData && typeof media.mediaData === 'object') {
      const data = media.mediaData as Record<string, unknown>;
      return (data.codec as string) || 'Unknown';
    }
    return 'Unknown';
  };

  const getDimensions = (): { width?: number; height?: number } => {
    if (media.mediaData && typeof media.mediaData === 'object') {
      const data = media.mediaData as Record<string, unknown>;
      return {
        width: data.width as number | undefined,
        height: data.height as number | undefined,
      };
    }
    return {};
  };

  // Get thumbnail URL
  const getThumbnailUrl = (): string | null => {
    if (!media.expand?.thumbnailFile) return null;
    const file = media.expand.thumbnailFile;
    if (!file.blob) return null;

    try {
      return pb.files.getUrl(file, file.blob);
    } catch (error) {
      console.error('Failed to get thumbnail URL:', error);
      return null;
    }
  };

  // Get sprite URL
  const getSpriteUrl = (): string | null => {
    if (!media.expand?.spriteFile) return null;
    const file = media.expand.spriteFile;
    if (!file.blob) return null;

    try {
      return pb.files.getUrl(file, file.blob);
    } catch (error) {
      console.error('Failed to get sprite URL:', error);
      return null;
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current || !getSpriteUrl()) return;

    const rect = cardRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const percentX = x / rect.width;
    const percentY = y / rect.height;

    // Assuming sprite sheet is 10x10 grid (100 frames)
    const cols = 10;
    const rows = 10;
    const frameX = Math.floor(percentX * cols);
    const frameY = Math.floor(percentY * rows);

    setSpritePosition({ x: frameX, y: frameY });
  };

  const thumbnailUrl = getThumbnailUrl();
  const spriteUrl = getSpriteUrl();
  const dimensions = getDimensions();

  return (
    <Card
      ref={cardRef}
      className={cn(
        'overflow-hidden cursor-pointer transition-all hover:shadow-lg',
        className
      )}
      onClick={onClick}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onMouseMove={handleMouseMove}
    >
      {/* Thumbnail/Sprite preview */}
      <div className="relative aspect-video bg-gray-100 overflow-hidden">
        {thumbnailUrl ? (
          <>
            {/* Static thumbnail */}
            <Image
              src={thumbnailUrl}
              alt={`Thumbnail for media ${media.id}`}
              fill
              className={cn(
                'object-cover transition-opacity',
                isHovering && spriteUrl ? 'opacity-0' : 'opacity-100'
              )}
              unoptimized
            />

            {/* Sprite sheet preview on hover */}
            {isHovering && spriteUrl && (
              <div
                className="absolute inset-0 bg-cover bg-no-repeat transition-all"
                style={{
                  backgroundImage: `url(${spriteUrl})`,
                  backgroundPosition: `${spritePosition.x * -100}% ${spritePosition.y * -100}%`,
                  backgroundSize: '1000% 1000%', // 10x10 grid
                }}
              />
            )}
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Film className="h-12 w-12 text-gray-400" />
          </div>
        )}

        {/* Duration badge */}
        <div className="absolute bottom-2 right-2">
          <Badge variant="secondary" className="bg-black/70 text-white">
            <Clock className="h-3 w-3 mr-1" />
            {formatDuration(media.duration)}
          </Badge>
        </div>
      </div>

      {/* Media info */}
      <CardContent className="p-4 space-y-2">
        {/* Media type badge */}
        <div className="flex items-center gap-2">
          <Badge variant="outline">{media.mediaType}</Badge>
          {dimensions.width && dimensions.height && (
            <Badge variant="outline" className="text-xs">
              <Maximize2 className="h-3 w-3 mr-1" />
              {formatDimensions(dimensions.width, dimensions.height)}
            </Badge>
          )}
        </div>

        {/* Codec info */}
        <div className="text-sm text-gray-600">
          <span className="font-medium">Codec:</span> {getCodec()}
        </div>

        {/* Upload reference */}
        {media.expand?.upload && (
          <div className="text-xs text-gray-500 truncate">
            {media.expand.upload.name}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
