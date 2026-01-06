'use client';

import React, { useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useMediaDetails } from '@/hooks/use-media-details';
import { MediaVideoPlayer } from '@/components/video/media-video-player';
import { MediaClipList } from '@/components/media-clip/media-clip-list';
import { Button } from '@/components/ui/button';
import { ArrowLeft, RefreshCw, Calendar, FileVideo, Clock } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { MediaClip } from '@project/shared';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function MediaDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;
  const { media, clips, isLoading, error, refresh } = useMediaDetails(id);

  // Get clip ID from URL query parameter
  const clipIdFromUrl = searchParams.get('clip');

  // Derive active clip ID from URL parameter, verifying it exists in loaded clips
  const activeClipId = useMemo(() => {
    if (!clipIdFromUrl || clips.length === 0) {
      return undefined;
    }
    // Verify the clip exists in the loaded clips
    const clipExists = clips.some((clip) => clip.id === clipIdFromUrl);
    return clipExists ? clipIdFromUrl : undefined;
  }, [clipIdFromUrl, clips]);

  const activeClip = useMemo(
    () => clips.find((c) => c.id === activeClipId),
    [clips, activeClipId]
  );

  const handleClipSelect = (clip: MediaClip) => {
    // If clicking the same clip, toggle it off (return to full video)
    if (activeClipId === clip.id) {
      // Remove clip parameter from URL
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.delete('clip');
      router.push(
        `/media/${id}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`,
        { scroll: false }
      );
    } else {
      // Update URL with clip parameter
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.set('clip', clip.id);
      router.push(`/media/${id}?${newSearchParams.toString()}`, {
        scroll: false,
      });
    }
  };

  const handleBack = () => {
    router.push('/media');
  };

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !media) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Button variant="ghost" className="mb-4" onClick={handleBack}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Gallery
        </Button>
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>
            {error?.message || 'Media not found'}
          </AlertDescription>
        </Alert>
        <Button className="mt-4" onClick={() => refresh()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={handleBack}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {media.expand?.UploadRef?.name || 'Untitled Media'}
            </h1>
            <div className="text-sm text-muted-foreground flex items-center gap-4 mt-1">
              <span className="flex items-center gap-1">
                <Calendar className="h-3 w-3" />
                {new Date(media.created).toLocaleDateString()}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {media.duration.toFixed(1)}s
              </span>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={() => {
            // Remove clip parameter from URL
            const newSearchParams = new URLSearchParams(
              searchParams.toString()
            );
            newSearchParams.delete('clip');
            router.push(
              `/media/${id}${newSearchParams.toString() ? `?${newSearchParams.toString()}` : ''}`,
              { scroll: false }
            );
          }}
          disabled={!activeClipId}
        >
          Reset to Full Video
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content - Player */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="overflow-hidden bg-black/5 border-0 shadow-none">
            <div className="w-full aspect-video">
              <MediaVideoPlayer
                media={media}
                clip={activeClip}
                autoPlay={false}
                className="w-full h-full"
              />
            </div>
          </Card>

          {/* Metadata Card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileVideo className="h-5 w-5" />
                File Details
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block mb-1">Type</span>
                <span className="font-medium capitalize">
                  {media.mediaType}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">
                  Dimensions
                </span>
                <span className="font-medium">
                  {
                    (media.mediaData as Record<string, unknown>)
                      ?.width as number
                  }{' '}
                  x{' '}
                  {
                    (media.mediaData as Record<string, unknown>)
                      ?.height as number
                  }
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">Codec</span>
                <span className="font-medium">
                  {((media.mediaData as Record<string, unknown>)
                    ?.codec as string) || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block mb-1">FPS</span>
                <span className="font-medium">
                  {((media.mediaData as Record<string, unknown>)
                    ?.fps as number) || 'N/A'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar - Clips */}
        <div className="lg:col-span-1">
          <Card className="h-[calc(100vh-12rem)] min-h-[500px] flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Clips</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {clips.length} found
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto pr-2">
              <MediaClipList
                media={media}
                clips={clips}
                onClipSelect={handleClipSelect}
                activeClipId={activeClipId}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
