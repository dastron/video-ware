import { useState, useEffect, useCallback } from 'react';
import pb from '@/lib/pocketbase';
import type { Media, MediaClip } from '@project/shared';
import { useAuth } from './use-auth';

interface UseMediaDetailsResult {
  media: Media | null;
  clips: MediaClip[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useMediaDetails(mediaId: string): UseMediaDetailsResult {
  const [media, setMedia] = useState<Media | null>(null);
  const [clips, setClips] = useState<MediaClip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { isAuthenticated } = useAuth();

  const fetchData = useCallback(async () => {
    if (!mediaId || !isAuthenticated) return;

    try {
      setIsLoading(true);
      setError(null);

      // Fetch media details
      const mediaRecord = await pb.collection('Media').getOne<Media>(mediaId, {
        expand: 'thumbnailFileRef,spriteFileRef,proxyFileRef,UploadRef',
      });

      // Fetch associated clips
      const clipsList = await pb
        .collection('MediaClips')
        .getList<MediaClip>(1, 200, {
          filter: `MediaRef = "${mediaId}"`,
          sort: 'start',
        });

      setMedia(mediaRecord);
      setClips(clipsList.items);
    } catch (err) {
      console.error('Error fetching media details:', err);
      setError(
        err instanceof Error ? err : new Error('Failed to fetch media details')
      );
    } finally {
      setIsLoading(false);
    }
  }, [mediaId, isAuthenticated]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { media, clips, isLoading, error, refresh: fetchData };
}
