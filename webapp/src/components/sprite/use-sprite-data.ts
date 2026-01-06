import { useState, useEffect } from 'react';
import type { Media, File } from '@project/shared';
import pb from '@/lib/pocketbase-client';

export interface SpriteConfig {
  cols: number;
  rows: number;
  fps: number;
}

export function useSpriteData(media: Media) {
  const [spriteFile, setSpriteFile] = useState<File | null>(
    media.expand?.spriteFileRef || null
  );
  const [isLoading, setIsLoading] = useState(
    !spriteFile && !!media.spriteFileRef
  );

  useEffect(() => {
    async function fetchSpriteFile() {
      if (!media.spriteFileRef || spriteFile) return;

      setIsLoading(true);
      try {
        const file = await pb
          .collection('Files')
          .getOne<File>(media.spriteFileRef);
        setSpriteFile(file);
      } catch (error) {
        console.error('Failed to fetch sprite file:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSpriteFile();
  }, [media.spriteFileRef, spriteFile]);

  const config: SpriteConfig = (spriteFile as any)?.meta?.spriteConfig ||
    (media.mediaData as any)?.spriteConfig || {
      cols: 10,
      rows: 10,
      fps: 1,
    };

  const url = spriteFile?.blob
    ? pb.files.getURL(spriteFile as any, spriteFile.blob as any)
    : null;

  return {
    spriteFile,
    url,
    config,
    isLoading,
  };
}
