'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, List, X, Loader2 } from 'lucide-react';
import { useMedia } from '@/hooks/use-media';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MediaCard } from './media-card';
import { cn } from '@/lib/utils';

interface MediaNavigationPanelProps {
  currentMediaId: string;
}

export function MediaNavigationPanel({
  currentMediaId,
}: MediaNavigationPanelProps) {
  const router = useRouter();
  const { media, isLoading } = useMedia();
  const [isOpen, setIsOpen] = React.useState(false);

  // Find current index
  const currentIndex = React.useMemo(() => {
    return media.findIndex((m) => m.id === currentMediaId);
  }, [media, currentMediaId]);

  const handlePrev = () => {
    if (currentIndex > 0) {
      router.push(`/media/${media[currentIndex - 1].id}`);
    }
  };

  const handleNext = () => {
    if (currentIndex < media.length - 1) {
      router.push(`/media/${media[currentIndex + 1].id}`);
    }
  };

  if (isLoading) {
    return (
      <div className="border-b bg-background/95 backdrop-blur py-2">
        <div className="container flex items-center justify-center h-10">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Calculate current item number (1-based)
  const currentNumber = currentIndex !== -1 ? currentIndex + 1 : 0;
  const totalItems = media.length;

  return (
    <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full shadow-sm">
      <div className="container flex items-center justify-between py-2 gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handlePrev}
            disabled={currentIndex <= 0}
            title="Previous Media"
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <span className="text-sm font-medium w-16 text-center">
            {currentNumber} / {totalItems}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleNext}
            disabled={currentIndex < 0 || currentIndex >= media.length - 1}
            title="Next Media"
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <>
                <X className="h-4 w-4" />
                Close List
              </>
            ) : (
              <>
                <List className="h-4 w-4" />
                Browse
              </>
            )}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full bg-background/95 backdrop-blur border-b shadow-lg animate-in slide-in-from-top-2 fade-in duration-200 z-40">
          <ScrollArea className="h-[50vh] w-full p-4">
            <div className="container mx-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {media.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      'rounded-lg transition-all',
                      item.id === currentMediaId &&
                        'ring-2 ring-primary ring-offset-2'
                    )}
                  >
                    <MediaCard
                      media={item}
                      onClick={() => {
                        setIsOpen(false);
                        router.push(`/media/${item.id}`);
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
