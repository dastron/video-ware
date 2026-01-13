'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { Media, LabelTrack } from '@project/shared';
import { MediaVideoPlayer } from '@/components/video/media-video-player';

interface Keyframe {
  timeOffset: number;
  boundingBox: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  confidence: number;
}

interface TracksAnimatorProps {
  media: Media;
  track: LabelTrack;
  className?: string;
}

export function TracksAnimator({
  media,
  track,
  className,
}: TracksAnimatorProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentBox, setCurrentBox] = useState<Keyframe['boundingBox'] | null>(
    null
  );

  // Sort keyframes by timeOffset just in case
  const sortedKeyframes = useMemo(() => {
    const kf = (track.keyframes as unknown as Keyframe[]) || [];
    return [...kf].sort((a, b) => a.timeOffset - b.timeOffset);
  }, [track.keyframes]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animationFrameId: number;

    const update = () => {
      const time = video.currentTime;

      // We need to find the bounding box for the current time.
      // Since keyframes might be sparse, we could interpolate.
      // For now, let's find the closest keyframe or the one that covers the current time.
      // Assuming keyframes are samples at specific times.

      // Simple approach: Find the last keyframe that is <= current time,
      // but only if it's within a reasonable threshold (e.g. 1 second or duration of sample).
      // However, usually tracks are continuous.

      // Binary search or simple find (optimization possible later)
      // Since the list might be long, let's optimize slightly if needed, but linear scan is fine for < 1000 items usually.

      // Actually, if we want smooth animation, we should interpolate.
      // Let's implement simple interpolation between two frames.

      // Find indices
      let prevIdx = -1;
      for (let i = 0; i < sortedKeyframes.length; i++) {
        if (sortedKeyframes[i].timeOffset <= time) {
          prevIdx = i;
        } else {
          break;
        }
      }

      if (prevIdx === -1) {
        // Before first keyframe
        if (sortedKeyframes.length > 0 && Math.abs(sortedKeyframes[0].timeOffset - time) < 0.5) {
             setCurrentBox(sortedKeyframes[0].boundingBox);
        } else {
             setCurrentBox(null);
        }
        return;
      }

      const prev = sortedKeyframes[prevIdx];
      const next = sortedKeyframes[prevIdx + 1];

      if (!next) {
        // After last keyframe
        if (Math.abs(time - prev.timeOffset) < 0.5) { // Show for 0.5s after last keyframe?
            setCurrentBox(prev.boundingBox);
        } else {
            setCurrentBox(null);
        }
        return;
      }

      // Interpolate
      const dt = next.timeOffset - prev.timeOffset;
      if (dt <= 0) {
        setCurrentBox(prev.boundingBox);
        return;
      }

      const t = (time - prev.timeOffset) / dt;

      // Linear interpolation
      const box = {
        left: prev.boundingBox.left + (next.boundingBox.left - prev.boundingBox.left) * t,
        top: prev.boundingBox.top + (next.boundingBox.top - prev.boundingBox.top) * t,
        right: prev.boundingBox.right + (next.boundingBox.right - prev.boundingBox.right) * t,
        bottom: prev.boundingBox.bottom + (next.boundingBox.bottom - prev.boundingBox.bottom) * t,
      };

      setCurrentBox(box);
    };

    // Use requestAnimationFrame for smoother updates than 'timeupdate' event
    const loop = () => {
      update();
      animationFrameId = requestAnimationFrame(loop);
    };

    // Start loop
    loop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [sortedKeyframes]);

  return (
    <div className={`relative aspect-video bg-black rounded-lg overflow-hidden ${className}`}>
      <MediaVideoPlayer
        ref={videoRef}
        media={media}
        startTime={track.start} // Start playing at the track start
        autoPlay={false}
        className="w-full h-full"
      />
      {currentBox && (
        <div
            className="absolute border-2 border-red-500 pointer-events-none transition-all duration-75 ease-linear"
            style={{
                left: `${currentBox.left * 100}%`,
                top: `${currentBox.top * 100}%`,
                width: `${(currentBox.right - currentBox.left) * 100}%`,
                height: `${(currentBox.bottom - currentBox.top) * 100}%`,
            }}
        />
      )}
    </div>
  );
}
