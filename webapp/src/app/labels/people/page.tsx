'use client';

import { useState, useEffect } from 'react';
import { usePocketBase } from '@/contexts/pocketbase-context';
import type { LabelPerson, LabelTrack, Media } from '@project/shared';
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

type ExtendedLabelPerson = LabelPerson & {
  expand?: {
    LabelTrackRef?: LabelTrack;
    MediaRef?: Media;
  };
};

export default function LabelPeoplePage() {
  const { pb } = usePocketBase();
  const [people, setPeople] = useState<ExtendedLabelPerson[]>([]);
  const [selectedPerson, setSelectedPerson] =
    useState<ExtendedLabelPerson | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPeople() {
      try {
        const records = await pb
          .collection('LabelPerson')
          .getList<ExtendedLabelPerson>(1, 50, {
            sort: '-created',
            expand: 'LabelTrackRef,MediaRef',
          });
        setPeople(records.items);
        if (records.items.length > 0) {
          setSelectedPerson(records.items[0]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    fetchPeople();
  }, [pb]);

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
          <CardTitle>People</CardTitle>
          <CardDescription>Detected people</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <ScrollArea className="h-full">
            <div className="p-4 pt-0 space-y-2">
              {people.length === 0 ? (
                <p className="text-sm text-muted-foreground p-4 text-center">
                  No people found.
                </p>
              ) : (
                people.map((person) => (
                  <Button
                    key={person.id}
                    variant={
                      selectedPerson?.id === person.id ? 'secondary' : 'ghost'
                    }
                    className="w-full justify-start text-left h-auto py-3 flex flex-col items-start gap-1"
                    onClick={() => setSelectedPerson(person)}
                  >
                    <div className="font-medium">
                      Person {person.personId || person.id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Confidence: {Math.round(person.confidence * 100)}%
                    </div>
                    <div className="text-xs text-muted-foreground truncate w-full">
                      Media: {person.expand?.MediaRef?.filename || person.MediaRef}
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
          <CardTitle>Person Details</CardTitle>
          <CardDescription>
            {selectedPerson?.expand?.MediaRef?.filename}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto">
          {selectedPerson &&
          selectedPerson.expand?.LabelTrackRef &&
          selectedPerson.expand.MediaRef ? (
            <div className="space-y-4">
              <TracksAnimator
                media={selectedPerson.expand.MediaRef}
                track={selectedPerson.expand.LabelTrackRef}
              />

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Start Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedPerson.start.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    End Time
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedPerson.end.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Duration
                  </h4>
                  <p className="text-sm font-mono">
                    {selectedPerson.duration.toFixed(2)}s
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Track ID
                  </h4>
                  <p className="text-sm font-mono truncate" title={selectedPerson.expand.LabelTrackRef.trackId}>
                    {selectedPerson.expand.LabelTrackRef.trackId}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Upper Body Color
                  </h4>
                  <p className="text-sm">
                    {selectedPerson.upperBodyColor || 'Unknown'}
                  </p>
                </div>
                <div className="p-3 border rounded bg-muted/20">
                  <h4 className="text-xs font-medium uppercase text-muted-foreground mb-1">
                    Lower Body Color
                  </h4>
                  <p className="text-sm">
                    {selectedPerson.lowerBodyColor || 'Unknown'}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              {selectedPerson
                ? 'No track data available for this person.'
                : 'Select a person to view details.'}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
