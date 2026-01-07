'use client';

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import Image from 'next/image';
import { MediaClipMutator } from '@project/shared/mutator';
import type { MediaClip, Media } from '@project/shared';
import { ClipType } from '@project/shared';
import { useWorkspace } from '@/hooks/use-workspace';
import { useTimeline } from '@/hooks/use-timeline';
import pb from '@/lib/pocketbase-client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, Film, Clock, Plus, AlertCircle } from 'lucide-react';
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
  height: number;
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

// Card dimensions
const CARD_WIDTH = 200;
const CARD_HEIGHT = 160;
const GAP = 12;
const HEADER_HEIGHT = 60;

export function ClipBrowser({ height }: ClipBrowserProps) {
  const { currentWorkspace } = useWorkspace();
  const { addClip } = useTimeline();
  const [clips, setClips] = useState<MediaClipWithExpand[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Create mutator instance
  const mediaClipMutator = useMemo(() => new MediaClipMutator(pb), []);

  // Calculate grid dimensions based on available space
  const gridDimensions = useMemo(() => {
    const availableHeight = height - HEADER_HEIGHT;
    const rows = Math.max(1, Math.floor(availableHeight / (CARD_HEIGHT + GAP)));
    return { rows };
  }, [height]);

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

  const handleAddClip = useCallback(
    async (clip: MediaClipWithExpand) => {
      try {
        await addClip(clip.MediaRef, clip.start, clip.end, clip.id);
      } catch (err) {
        console.error('Failed to add clip:', err);
      }
    },
    [addClip]
  );

  // Handle horizontal scroll with vertical mouse wheel
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      // Only handle vertical wheel events
      if (e.deltaY !== 0) {
        e.preventDefault();
        // Scroll horizontally based on vertical wheel movement
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  if (!currentWorkspace) {
    return (
      <div className="p-4 h-full flex items-center justify-center">
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
    <div className="h-full flex flex-col">
      {/* Header with Search and Filter */}
      <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clips..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px] h-9">
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
        {clips.length > 0 && (
          <div className="text-sm text-muted-foreground">
            {clips.length} clip{clips.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Clips Grid with Horizontal Scroll */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-x-auto overflow-y-hidden px-4 py-3"
        style={{
          scrollbarWidth: 'thin',
        }}
      >
        {isLoading && clips.length === 0 ? (
          // Loading skeletons in grid
          <div
            className="inline-grid gap-3 h-full"
            style={{
              gridTemplateRows: `repeat(${gridDimensions.rows}, ${CARD_HEIGHT}px)`,
              gridAutoFlow: 'column',
              gridAutoColumns: `${CARD_WIDTH}px`,
            }}
          >
            {Array.from({ length: gridDimensions.rows * 3 }).map((_, i) => (
              <ClipCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="h-full flex items-center justify-center">
            <Alert variant="destructive" className="max-w-md">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : clips.length === 0 ? (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <Film className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm font-medium">No clips found</p>
              {searchQuery && (
                <p className="text-xs mt-1">Try adjusting your search</p>
              )}
            </div>
          </div>
        ) : (
          <div
            className="inline-grid gap-3 h-full"
            style={{
              gridTemplateRows: `repeat(${gridDimensions.rows}, ${CARD_HEIGHT}px)`,
              gridAutoFlow: 'column',
              gridAutoColumns: `${CARD_WIDTH}px`,
            }}
          >
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                onAddToTimeline={handleAddClip}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ClipCardProps {
  clip: MediaClipWithExpand;
  onAddToTimeline: (clip: MediaClipWithExpand) => void;
}

function ClipCard({ clip, onAddToTimeline }: ClipCardProps) {
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

  return (
    <Card
      draggable
      onDragStart={handleDragStart}
      className={cn(
        'cursor-grab active:cursor-grabbing relative group',
        'hover:shadow-md transition-shadow overflow-hidden',
        'p-0 gap-0' // Override default Card padding and gap
      )}
      style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
    >
      <CardContent className="p-2.5 h-full flex flex-col">
        {/* Thumbnail */}
        <div className="relative w-full h-24 bg-muted rounded overflow-hidden mb-2 flex-shrink-0">
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
              <Film className="h-6 w-6 text-muted-foreground" />
            </div>
          )}
          {/* Duration Badge */}
          <div className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-xs px-2 py-0.5 rounded font-medium">
            {formatTime(duration)}
          </div>

          {/* Add to Timeline Icon Button - Overlay on thumbnail */}
          <Button
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onAddToTimeline(clip);
            }}
            className="absolute top-1.5 right-1.5 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity shadow-md"
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

function ClipCardSkeleton() {
  return (
    <Card
      className="overflow-hidden"
      style={{ width: `${CARD_WIDTH}px`, height: `${CARD_HEIGHT}px` }}
    >
      <CardContent className="p-2 h-full flex flex-col">
        <Skeleton className="w-full h-24 rounded mb-2 flex-shrink-0" />
        <div className="flex-1 flex flex-col gap-1 min-h-0">
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </CardContent>
    </Card>
  );
}

export type { MediaClipWithExpand };
