'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineProvider } from '@/contexts/timeline-context';
import { TimelineEditor } from '@/components/timeline/timeline-editor';
import { ClipBrowser } from '@/components/timeline/clip-browser';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  AlertCircle,
  ArrowLeft,
  Clock,
  ListVideo,
  Download,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { useTimeline } from '@/hooks/use-timeline';

function TimelineHeaderInfo() {
  const { timeline } = useTimeline();

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

  if (!timeline) return null;

  const totalDuration = calculateTotalDuration();
  const clipCount = timeline.clips.length;

  return (
    <div className="flex items-center gap-4 text-sm text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Clock className="h-4 w-4" />
        <span className="font-medium">{formatDuration(totalDuration)}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <ListVideo className="h-4 w-4" />
        <span className="font-medium">
          {clipCount} {clipCount === 1 ? 'clip' : 'clips'}
        </span>
      </div>
    </div>
  );
}

function TimelineEditorPageContent() {
  const params = useParams();
  const router = useRouter();
  const timelineId = params.id as string;
  const [clipBrowserHeight, setClipBrowserHeight] = useState(300);
  const [isResizing, setIsResizing] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return;

      // Calculate new height from bottom of viewport
      const newHeight = window.innerHeight - e.clientY;
      // Clamp between 200px and 600px
      const clampedHeight = Math.max(200, Math.min(600, newHeight));
      setClipBrowserHeight(clampedHeight);
    },
    [isResizing]
  );

  const handleMouseUp = useCallback(() => {
    setIsResizing(false);
  }, []);

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
    }
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <TimelineProvider timelineId={timelineId}>
      <div className="flex flex-col h-[calc(100vh-4rem)]">
        {/* Main Content - Timeline Editor */}
        <div
          className="flex-1 overflow-auto"
          style={{ height: `calc(100vh - 4rem - ${clipBrowserHeight}px)` }}
        >
          <div className="container mx-auto px-4 pt-4 pb-4 max-w-7xl">
            {/* Timeline Editor - Track First */}
            <TimelineEditor />

            {/* Header Info and Controls Below Timeline */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => router.push('/timelines')}
                  className="gap-2"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden sm:inline">Back to Timelines</span>
                  <span className="sm:hidden">Back</span>
                </Button>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <TimelineHeaderInfo />
                <Button
                  variant="outline"
                  onClick={() =>
                    router.push(`/timelines/${timelineId}/renders`)
                  }
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">View Renders</span>
                  <span className="sm:hidden">Renders</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          className={cn(
            'h-1 bg-border hover:bg-primary/50 cursor-ns-resize transition-colors',
            'relative group',
            isResizing && 'bg-primary'
          )}
        >
          <div className="absolute inset-x-0 -top-1 -bottom-1" />
          {/* Visual indicator */}
          <div className="absolute left-1/2 -translate-x-1/2 -top-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="flex flex-col gap-0.5">
              <div className="h-0.5 w-8 bg-muted-foreground/50 rounded" />
              <div className="h-0.5 w-8 bg-muted-foreground/50 rounded" />
            </div>
          </div>
        </div>

        {/* Bottom: Clip Browser Cards */}
        <div
          className="border-t bg-background overflow-hidden"
          style={{ height: `${clipBrowserHeight}px` }}
        >
          <div className="h-full">
            <ClipBrowser height={clipBrowserHeight} />
          </div>
        </div>
      </div>
    </TimelineProvider>
  );
}

export default function TimelineEditorPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  // Show loading state
  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to access the timeline editor.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show workspace selection prompt if no workspace selected
  if (!currentWorkspace) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to access the
            timeline editor.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <TimelineEditorPageContent />;
}
