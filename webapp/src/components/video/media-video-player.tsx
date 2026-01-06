'use client';

import React from 'react';
import type { Media, MediaClip } from '@project/shared';
import { useVideoSource } from '@/hooks/use-video-source';
import { VideoPlayerUI } from './video-player-ui';

interface MediaVideoPlayerProps {
  media: Media;
  clip?: MediaClip;
  autoPlay?: boolean;
  className?: string;
}

export function MediaVideoPlayer({
  media,
  clip,
  autoPlay = false,
  className,
}: MediaVideoPlayerProps) {
  const { src, poster, startTime, endTime, isLoading } = useVideoSource(
    media,
    clip
  );

  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-black rounded-lg aspect-video ${className}`}
      >
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-muted rounded-lg aspect-video ${className}`}
      >
        <p className="text-muted-foreground">No video source available</p>
      </div>
    );
  }

  return (
    <VideoPlayerUI
      src={src}
      poster={poster}
      startTime={startTime}
      endTime={endTime}
      autoPlay={autoPlay}
      className={className}
    />
  );
}
