'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { MediaClipMutator } from '@project/shared/mutator';
import type { MediaClip, Media } from '@project/shared';
import { ClipType } from '@project/shared';
import { useWorkspace } from '@/hooks/use-workspace';
import pb from '@/lib/pocketbase-client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Film, Clock, GripVertical, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Extended MediaClip type with expanded relations
 */
interface MediaClipWithExpand extends Omit<MediaClip, 'expand'> {
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

interface ClipBrowserProps {
  className?: string;
  onClipDragStart?: (clip: MediaClipWithExpand, e: React.DragEvent) => void;
}

const CLIP_TYPE_OPTIONS = [
  { value: 'all', label: 'All Types' },
  { value: ClipType.USER, label: 'User' },
  { value: ClipType.RANGE, label: 'Range' },
  { value: ClipType.SHOT, label: 'Shot' },
  { value: ClipType.OBJECT, label: 'Object' },
  { value: ClipType.PERSON, label: 'Person' },
  { value: ClipType.SPEECH, label: 'Speech' },
  { value: ClipType.RECOMMENDATION, label: 'Recommendation' },
];

export function ClipBrowser({ className, onClipDragStart }: ClipBrowserProps) {
  const { currentWorkspace } = useWorkspace();
  const [clips, setClips] = useState<MediaClipWithExpand[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Create mutator instance
  const mediaClipMutator = useMemo(() => new MediaClipMutator(pb), []);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load clips from workspace
  const loadClips = useCallback(async () => {
    if (!currentWorkspace) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await mediaClipMutator.getByWorkspace(
        currentWorkspace.id,
        1,
        100,
        {
          type: typeFilter !== 'all' ? typeFilter : undefined,
          searchQuery: debouncedSearchQuery || undefined,
        }
      );
      setClips(result.items as MediaClipWithExpand[]);
    } catch (err) {
      console.error('Failed to load clips:', err);
      setError(err instanceof Error ? err.message : 'Failed to load clips');
    } finally {
      setIsLoading(false);
    }
  }, [currentWorkspace, mediaClipMutator, typeFilter, debouncedSearchQuery]);

  // Load clips when workspace or filters change
  useEffect(() => {
    loadClips();
  }, [loadClips]);

  if (!currentWorkspace) {
    return (
      <div className={cn('p-4', className)}>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Select a workspace to browse clips.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Search and Filter Controls */}
      <div className="p-3 space-y-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clips..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            {CLIP_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Clips List */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {isLoading && clips.length === 0 ? (
            // Loading skeletons
            Array.from({ length: 5 }).map((_, i) => (
              <ClipItemSkeleton key={i} />
            ))
          ) : error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : clips.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Film className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No clips found</p>
              {searchQuery && (
                <p className="text-xs mt-1">Try adjusting your search</p>
              )}
            </div>
          ) : (
            clips.map((clip) => (
              <ClipBrowserItem
                key={clip.id}
                clip={clip}
                onDragStart={onClipDragStart}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer with count */}
      {clips.length > 0 && (
        <div className="p-2 border-t text-xs text-muted-foreground text-center">
          {clips.length} clip{clips.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

interface ClipBrowserItemProps {
  clip: MediaClipWithExpand;
  onDragStart?: (clip: MediaClipWithExpand, e: React.DragEvent) => void;
}

function ClipBrowserItem({ clip, onDragStart }: ClipBrowserItemProps) {
  const duration = clip.end - clip.start;
  const media = clip.expand?.MediaRef;
  const upload = media?.expand?.UploadRef;
  const thumbnailFile = media?.expand?.thumbnailFileRef;

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

  const handleDragStart = (e: React.DragEvent) => {
    // Set drag data with clip information
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

    onDragStart?.(clip, e);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'flex items-center gap-2 p-2 rounded-md border bg-card',
        'cursor-grab active:cursor-grabbing',
        'hover:bg-accent hover:border-accent-foreground/20',
        'transition-colors'
      )}
    >
      {/* Drag Handle */}
      <div className="text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Thumbnail */}
      <div className="relative w-16 h-10 bg-muted rounded overflow-hidden flex-shrink-0">
        {thumbnailUrl ? (
          <Image
            src={thumbnailUrl}
            alt={`Thumbnail for ${mediaName}`}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <Film className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Clip Info */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={mediaName}>
          {mediaName}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatTime(duration)}</span>
          </div>
          <span className="text-muted-foreground/50">•</span>
          <span>
            {formatTime(clip.start)} - {formatTime(clip.end)}
          </span>
        </div>
      </div>

      {/* Type Badge */}
      <Badge variant="outline" className="text-xs flex-shrink-0">
        {clip.type}
      </Badge>
    </div>
  );
}

function ClipItemSkeleton() {
  return (
    <div className="flex items-center gap-2 p-2 rounded-md border">
      <Skeleton className="h-4 w-4" />
      <Skeleton className="w-16 h-10 rounded" />
      <div className="flex-1 space-y-1">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-5 w-12 rounded-full" />
    </div>
  );
}

export type { MediaClipWithExpand };
