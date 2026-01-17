'use client';

import React, { useMemo, useEffect, useRef } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { useTimelineRecommendations } from '@/hooks/use-timeline-recommendations';
import { TimelineRecommendationsPanel } from '@/components/recommendations/timeline-recommendations-panel';
import {
  type TimelineRecommendation,
  RecommendationTargetMode,
} from '@project/shared';

export function TimelineRecommendationsPanelWrapper() {
  const { selectedClipId, removeClip, timeline, refreshTimeline } =
    useTimeline();
  const {
    recommendations,
    isLoading,
    acceptRecommendation,
    dismissRecommendation,
    generateRecommendations,
  } = useTimelineRecommendations();

  // Track which clips we have requested recommendations for to avoid infinite loops
  const requestedClipIds = useRef<Set<string>>(new Set());

  const lastClipId = useMemo(() => {
    if (timeline && timeline.clips.length > 0) {
      const sortedClips = [...timeline.clips].sort((a, b) => a.order - b.order);
      return sortedClips[sortedClips.length - 1].id;
    }
    return null;
  }, [timeline]);

  // Filter recommendations for the end of the timeline (Primary)
  const timelineRecs = useMemo(() => {
    if (!lastClipId) return [];
    return recommendations.filter((r) => r.SeedClipRef === lastClipId);
  }, [recommendations, lastClipId]);

  // Filter recommendations for the selected clip (Secondary)
  const selectedRecs = useMemo(() => {
    if (!selectedClipId || selectedClipId === lastClipId) return [];
    return recommendations.filter((r) => r.SeedClipRef === selectedClipId);
  }, [recommendations, selectedClipId, lastClipId]);

  // Trigger generation for last clip if needed
  useEffect(() => {
    if (
      timeline &&
      lastClipId &&
      !requestedClipIds.current.has(lastClipId) &&
      timelineRecs.length === 0 &&
      !isLoading
    ) {
      requestedClipIds.current.add(lastClipId);
      generateRecommendations({
        timelineId: timeline.id,
        seedClipId: lastClipId,
        targetMode: RecommendationTargetMode.APPEND,
      }).catch((err) => {
        console.error('Failed to generate timeline recommendations:', err);
        // Allow retrying later if needed
        requestedClipIds.current.delete(lastClipId);
      });
    }
  }, [timeline, lastClipId, timelineRecs.length, isLoading, generateRecommendations]);

  // Trigger generation for selected clip if needed
  useEffect(() => {
    if (
      timeline &&
      selectedClipId &&
      selectedClipId !== lastClipId &&
      !requestedClipIds.current.has(selectedClipId) &&
      selectedRecs.length === 0 &&
      !isLoading
    ) {
      requestedClipIds.current.add(selectedClipId);
      generateRecommendations({
        timelineId: timeline.id,
        seedClipId: selectedClipId,
        targetMode: RecommendationTargetMode.APPEND,
      }).catch((err) => {
        console.error('Failed to generate selected clip recommendations:', err);
        requestedClipIds.current.delete(selectedClipId);
      });
    }
  }, [
    timeline,
    selectedClipId,
    lastClipId,
    selectedRecs.length,
    isLoading,
    generateRecommendations,
  ]);

  const handleAdd = async (recommendation: TimelineRecommendation) => {
    try {
      await acceptRecommendation(recommendation.id);
      // Ensure the timeline editor immediately reflects the newly added clip
      await refreshTimeline();
    } catch (error) {
      console.error('Failed to add recommendation:', error);
      alert(error instanceof Error ? error.message : 'Failed to add clip');
    }
  };

  const handleReplace = async (recommendation: TimelineRecommendation) => {
    // Determine target clip: use SeedClipRef if available, otherwise selectedClipId or lastClipId
    const targetClipId =
      recommendation.SeedClipRef || selectedClipId || lastClipId;

    if (!targetClipId) {
      alert('No clip available to replace');
      return;
    }
    try {
      await removeClip(targetClipId);
      await acceptRecommendation(recommendation.id);
      // Ensure the timeline editor immediately reflects the newly added replacement clip
      await refreshTimeline();
    } catch (error) {
      console.error('Failed to replace clip:', error);
      alert(error instanceof Error ? error.message : 'Failed to replace clip');
    }
  };

  const handleDismiss = async (recommendation: TimelineRecommendation) => {
    try {
      await dismissRecommendation(recommendation.id);
    } catch (error) {
      console.error('Failed to dismiss recommendation:', error);
    }
  };

  const handleRefresh = async () => {
    if (!timeline) return;

    try {
      // Refresh timeline recommendations
      if (lastClipId) {
        requestedClipIds.current.delete(lastClipId);
        await generateRecommendations({
          timelineId: timeline.id,
          seedClipId: lastClipId,
          targetMode: RecommendationTargetMode.APPEND,
        });
      }

      // Refresh selected clip recommendations if applicable
      if (selectedClipId && selectedClipId !== lastClipId) {
        requestedClipIds.current.delete(selectedClipId);
        await generateRecommendations({
          timelineId: timeline.id,
          seedClipId: selectedClipId,
          targetMode: RecommendationTargetMode.APPEND,
        });
      }

      // If neither (empty timeline), generate generic ones?
      if (!lastClipId && !selectedClipId) {
         await generateRecommendations({
          timelineId: timeline.id,
          targetMode: RecommendationTargetMode.APPEND,
        });
      }

    } catch (error) {
      console.error('Failed to refresh recommendations:', error);
    }
  };

  return (
    <TimelineRecommendationsPanel
      recommendations={timelineRecs}
      selectedClipRecommendations={selectedRecs}
      isLoading={isLoading}
      onAdd={handleAdd}
      onReplace={handleReplace}
      onDismiss={handleDismiss}
      onMoreLikeThis={handleRefresh}
    />
  );
}
