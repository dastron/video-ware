'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { TimelineProvider } from '@/contexts/timeline-context';
import { TimelineEditor } from '@/components/timeline/timeline-editor';
import { ClipBrowser } from '@/components/timeline/clip-browser';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertCircle,
  ArrowLeft,
  PanelRightClose,
  PanelRight,
  Film,
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
  const [isClipBrowserOpen, setIsClipBrowserOpen] = useState(true);

  return (
    <TimelineProvider timelineId={timelineId}>
      <div className="flex h-[calc(100vh-4rem)]">
        {/* Main Content */}
        <div className="flex-1 overflow-auto">
          <div className="container mx-auto px-4 pt-6 pb-8 max-w-7xl">
            {/* Header with Back Button */}
            <div className="mb-6">
              <Button
                variant="ghost"
                onClick={() => router.push('/timelines')}
                className="gap-2 mb-4"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Timelines
              </Button>
              <div className="flex items-center justify-between">
                <TimelineHeaderInfo />
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={() =>
                      router.push(`/timelines/${timelineId}/renders`)
                    }
                    className="gap-2"
                  >
                    <Download className="h-4 w-4" />
                    View Renders
                  </Button>
                  {!isClipBrowserOpen && (
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIsClipBrowserOpen(true)}
                      title="Open Clip Browser"
                    >
                      <PanelRight className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Timeline Editor */}
            <TimelineEditor />
          </div>
        </div>

        {/* Clip Browser Sidebar */}
        <div
          className={cn(
            'flex-shrink-0 border-l bg-background transition-all duration-300',
            isClipBrowserOpen ? 'w-[32rem]' : 'w-0'
          )}
        >
          {isClipBrowserOpen && (
            <Card className="h-full rounded-none border-0">
              <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 -ml-2"
                    onClick={() => setIsClipBrowserOpen(false)}
                    title="Collapse Clip Browser"
                  >
                    <PanelRightClose className="h-4 w-4" />
                  </Button>
                  <Film className="h-4 w-4" />
                  Clip Browser
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 h-[calc(100%-3.5rem)]">
                <ClipBrowser className="h-full" />
              </CardContent>
            </Card>
          )}
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
