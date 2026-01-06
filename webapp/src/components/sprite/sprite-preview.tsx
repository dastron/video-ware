import { cn } from '@/lib/utils';
import type { SpriteConfig } from './use-sprite-data';

interface SpritePreviewProps {
  url: string;
  config: SpriteConfig;
  frameIndex: number;
  className?: string;
}

export function SpritePreview({
  url,
  config,
  frameIndex,
  className,
}: SpritePreviewProps) {
  const { cols, rows } = config;
  const fx = frameIndex % cols;
  const fy = Math.floor(frameIndex / cols);

  return (
    <div
      className={cn('absolute inset-0 bg-cover bg-no-repeat', className)}
      style={{
        backgroundImage: `url(${url})`,
        backgroundPosition: `${cols > 1 ? (fx / (cols - 1)) * 100 : 0}% ${rows > 1 ? (fy / (rows - 1)) * 100 : 0}%`,
        backgroundSize: `${cols * 100}% ${rows * 100}%`,
      }}
    />
  );
}
