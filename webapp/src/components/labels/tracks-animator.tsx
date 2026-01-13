'use client';

import React, { useMemo } from 'react';
import { type Media, type LabelTrack } from '@project/shared';
import { SpriteAnimator } from '@/components/sprite/sprite-animator';

interface Keyframe {
  t: number; // time offset
  bbox: {
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
  // Sort keyframes by time (t) just in case
  const sortedKeyframes = useMemo(() => {
    const kf = (track.keyframes as unknown as Keyframe[]) || [];
    return [...kf].sort((a, b) => a.t - b.t);
  }, [track.keyframes]);

  return (
    <div
      className={`relative aspect-video bg-black rounded-lg overflow-hidden ${className}`}
    >
      <SpriteAnimator
        media={media}
        start={track.start}
        end={track.end}
        isHovering={true}
        className="absolute inset-0"
      />

      {/* Display all keyframes as static bounding boxes */}
      {sortedKeyframes.map((keyframe, index) => (
        <div
          key={index}
          className="absolute border-2 border-red-500 pointer-events-none"
          style={{
            left: `${keyframe.bbox.left * 100}%`,
            top: `${keyframe.bbox.top * 100}%`,
            width: `${(keyframe.bbox.right - keyframe.bbox.left) * 100}%`,
            height: `${(keyframe.bbox.bottom - keyframe.bbox.top) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
