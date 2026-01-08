'use client';

import { useMemo } from 'react';
import type { LabelClip } from '@project/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Clock, Play, Scissors, ExternalLink, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LabelSearchResultsProps {
  labels: LabelClip[];
  onJumpToTime: (label: LabelClip) => void;
  onCreateClip: (label: LabelClip) => void;
  onAddToTimeline?: (label: LabelClip) => void;
  derivedClipIds?: Set<string>;
  onViewClip?: (clipId: string) => void;
  isLoading?: boolean;
}

export function LabelSearchResults({
  labels,
  onJumpToTime,
  onCreateClip,
  onAddToTimeline,
  derivedClipIds,
  onViewClip,
  isLoading,
}: LabelSearchResultsProps) {
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds: number): string => {
    if (seconds < 60) {
      return `${seconds.toFixed(1)}s`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}m ${secs}s`;
  };

  const getLabelName = (label: LabelClip): string => {
    const labelData = label.labelData as Record<string, unknown>;
    return (
      (labelData?.entityDescription as string) ||
      (labelData?.transcript as string)?.substring(0, 50) ||
      'Unknown Label'
    );
  };

  const getConfidenceColor = (confidence: number): string => {
    if (confidence >= 0.8) return 'text-green-600 dark:text-green-400';
    if (confidence >= 0.6) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (labels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">No labels found</p>
        <p className="text-xs mt-1">Try adjusting your filters</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {labels.map((label) => {
        const hasDerivedClip = derivedClipIds?.has(label.id);
        const labelName = getLabelName(label);

        return (
          <Card
            key={label.id}
            className="hover:shadow-md transition-shadow overflow-hidden"
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                {/* Label Info */}
                <div className="flex-1 min-w-0 space-y-2">
                  {/* Header */}
                  <div className="flex items-start gap-2">
                    <h4 className="text-sm font-medium truncate flex-1">
                      {labelName}
                    </h4>
                    <Badge
                      variant="outline"
                      className="text-xs shrink-0 capitalize"
                    >
                      {label.labelType}
                    </Badge>
                  </div>

                  {/* Time and Duration */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>
                        {formatTime(label.start)} - {formatTime(label.end)}
                      </span>
                    </div>
                    <span>Duration: {formatDuration(label.duration)}</span>
                  </div>

                  {/* Confidence */}
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      Confidence:
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        getConfidenceColor(label.confidence)
                      )}
                    >
                      {Math.round(label.confidence * 100)}%
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onJumpToTime(label)}
                    className="gap-1.5 text-xs h-8"
                  >
                    <Play className="h-3 w-3" />
                    Jump to Time
                  </Button>

                  {hasDerivedClip && onViewClip ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        onViewClip(label.id);
                      }}
                      className="gap-1.5 text-xs h-8"
                    >
                      <ExternalLink className="h-3 w-3" />
                      View Clip
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => onCreateClip(label)}
                      className="gap-1.5 text-xs h-8"
                    >
                      <Scissors className="h-3 w-3" />
                      Create Clip
                    </Button>
                  )}

                  {/* Add to Timeline button - only shown when timeline context is available */}
                  {onAddToTimeline && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onAddToTimeline(label)}
                      className="gap-1.5 text-xs h-8"
                    >
                      <Plus className="h-3 w-3" />
                      Add to Timeline
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
