import { useState, useEffect, useMemo } from 'react';
import type { Media, MediaClip, File } from '@project/shared';
import pb from '@/lib/pocketbase';

export interface VideoSource {
  src: string;
  poster: string;
  startTime: number;
  endTime?: number;
  isLoading: boolean;
}

export function useVideoSource(media: Media, clip?: MediaClip): VideoSource {
  const [proxyFile, setProxyFile] = useState<File | null>(
    media.expand?.proxyFileRef || null
  );
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(
    media.expand?.thumbnailFileRef || null
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function fetchFiles() {
      const needsProxy = !proxyFile && !!media.proxyFileRef;
      const needsThumbnail = !thumbnailFile && !!media.thumbnailFileRef;

      if (!needsProxy && !needsThumbnail) return;

      setIsLoading(true);
      try {
        if (needsProxy) {
          const file = await pb
            .collection('Files')
            .getOne<File>(media.proxyFileRef!);
          setProxyFile(file);
        }
        if (needsThumbnail) {
          const file = await pb
            .collection('Files')
            .getOne<File>(media.thumbnailFileRef!);
          setThumbnailFile(file);
        }
      } catch (error) {
        console.error('Failed to fetch video files:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchFiles();
  }, [media.proxyFileRef, media.thumbnailFileRef, proxyFile, thumbnailFile]);

  const src = useMemo(() => {
    if (!proxyFile?.blob) return '';
    try {
      return pb.files.getURL(proxyFile as any, proxyFile.blob as any);
    } catch (error) {
      console.error('Failed to get proxy URL:', error);
      return '';
    }
  }, [proxyFile]);

  const poster = useMemo(() => {
    if (!thumbnailFile?.blob) return '';
    try {
      return pb.files.getURL(thumbnailFile as any, thumbnailFile.blob as any);
    } catch (error) {
      console.error('Failed to get thumbnail URL:', error);
      return '';
    }
  }, [thumbnailFile]);

  return {
    src,
    poster,
    startTime: clip?.start ?? 0,
    endTime: clip?.end,
    isLoading,
  };
}
