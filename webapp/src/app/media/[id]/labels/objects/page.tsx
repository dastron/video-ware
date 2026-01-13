'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { usePocketBase } from '@/contexts/pocketbase-context';
import type { LabelObject, LabelTrack, Media } from '@project/shared';
import { TracksAnimator } from '@/components/labels/tracks-animator';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

type ExtendedLabelObject = LabelObject & {
  expand?: {
    LabelTrackRef?: LabelTrack;
    MediaRef?: Media;
  };
};

export default function LabelObjectsPage() {
  const { pb } = usePocketBase();
  const params = useParams();
  const mediaId = params.id as string;
  const [objects, setObjects] = useState<ExtendedLabelObject[]>([]);
  const [selectedObject, setSelectedObject] =
    useState<ExtendedLabelObject | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchObjects() {
      if (!mediaId) return;
      try {
        const records = await pb
          .collection('LabelObjects')
          .getList<ExtendedLabelObject>(1, 50, {
            filter: `MediaRef = "${mediaId}"`,
            sort: '-confidence',
            expand: 'LabelTrackRef,MediaRef',
          });
        setObjects(records.items);
        if (records.items.length > 0) {
          setSelectedObject(records.items[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchObjects();
  }, [pb, mediaId]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      <Card className="md:col-span-1 flex flex-col h-full">
        <CardHeader>
          <CardTitle>Objects</CardTitle>
          <CardDescription>Found objects in this media</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="p-4 pt-0 space-y-2">
              {objects.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No objects found.
                </p>
              ) : (
                objects.map((obj) => (
                  <Button
                    key={obj.id}
                    variant={
                      selectedObject?.id === obj.id ? 'secondary' : 'ghost'
                    }
                    className="w-full justify-start text-left h-auto py-3 flex flex-col items-start gap-1"
                    onClick={() => setSelectedObject(obj)}
                  >
                    <div className="font-medium capitalize">{obj.entity}</div>
                    <div className="text-xs text-muted-foreground">
                      Confidence: {Math.round(obj.confidence * 100)}%
                    </div>
                  </Button>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="md:col-span-2 flex flex-col h-full">
        <CardHeader>
          <CardTitle className="capitalize">
            {selectedObject?.entity || 'Select an object'}
          </CardTitle>
          <CardDescription>
            {selectedObject?.entity || 'No object'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto">
          {selectedObject &&
          selectedObject.expand?.LabelTrackRef &&
          selectedObject.expand.MediaRef ? (
            <div className="space-y-4">
              <TracksAnimator
                media={selectedObject.expand.MediaRef}
                track={selectedObject.expand.LabelTrackRef}
              />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Start Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedObject.start.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    End Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedObject.end.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Duration
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedObject.duration.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Track ID
                  </h4>
                  <p
                    className="text-sm font-mono truncate"
                    title={selectedObject.expand.LabelTrackRef.trackId}
                  >
                    {selectedObject.expand.LabelTrackRef.trackId}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {selectedObject
                ? 'No track data available for this object.'
                : 'Select an object to view details.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
