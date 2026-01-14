import { useState, useEffect, useRef } from 'react';

interface UseTimeAnimationProps {
  start: number;
  end: number;
  enabled?: boolean;
  loop?: boolean;
  speed?: number; // Playback speed multiplier (1 = normal, 2 = 2x, etc.)
}

export function useTimeAnimation({
  start,
  end,
  enabled = true,
  loop = true,
  speed = 1,
}: UseTimeAnimationProps) {
  const [currentTime, setCurrentTime] = useState(start);
  const lastUpdateRef = useRef<number>(0);
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Reset time when start/end changes or when disabled
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setCurrentTime(start);
    }, 0);
    return () => clearTimeout(timeoutId);
  }, [start, end, enabled]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const duration = end - start;
    if (duration <= 0) {
      return;
    }

    // Use requestAnimationFrame for smooth animation
    const update = (timestamp: number) => {
      if (!lastUpdateRef.current) {
        lastUpdateRef.current = timestamp;
      }

      const delta = (timestamp - lastUpdateRef.current) / 1000; // Convert to seconds
      lastUpdateRef.current = timestamp;

      setCurrentTime((prev) => {
        const next = prev + delta * speed;
        if (next >= end) {
          if (loop) {
            return start;
          } else {
            return end;
          }
        }
        return next;
      });

      animationFrameRef.current = requestAnimationFrame(update);
    };

    animationFrameRef.current = requestAnimationFrame(update);
    lastUpdateRef.current = 0;

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [start, end, enabled, loop, speed]);

  return currentTime;
}
