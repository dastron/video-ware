'use client';

import React from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Film, Clock, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TimelineTrack } from './timeline-track';
import { TimelineControls } from './timeline-controls';

interface TimelineEditorProps {
  className?: string;
}

export function TimelineEditor({ className }: TimelineEditorProps) {
  const { timeline, isLoading, error, hasUnsavedChanges } = useTimeline();

  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return '0:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const calculateTotalDuration = (): number => {
    if (!timeline) return 0;
    return timeline.clips.reduce(
      (sum, clip) => sum + (clip.end - clip.start),
      0
    );
  };

  if (isLoading && !timeline) {
    return (
      <div className={cn('space-y-4', className)}>
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-32 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!timeline) {
    return (
      <Alert className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Timeline not found</AlertDescription>
      </Alert>
    );
  }

  const totalDuration = calculateTotalDuration();

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Film className="h-6 w-6 text-primary" />
              <div>
                <CardTitle className="text-2xl">{timeline.name}</CardTitle>
                <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatDuration(totalDuration)}</span>
                  </div>
                  <div>Version {timeline.version}</div>
                  {hasUnsavedChanges && (
                    <div className="text-amber-600 dark:text-amber-400 font-medium">
                      • Unsaved changes
                    </div>
                  )}
                </div>
              </div>
            </div>
            <TimelineControls />
          </div>
        </CardHeader>
      </Card>

      {/* Timeline Track */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Timeline Track</CardTitle>
        </CardHeader>
        <CardContent>
          <TimelineTrack />
        </CardContent>
      </Card>

      {/* Empty State */}
      {timeline.clips.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            This timeline has no clips yet. Add clips from your media library to
            start building your sequence.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
