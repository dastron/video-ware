'use client';

import React, { useMemo } from 'react';
import { useTimeline } from '@/hooks/use-timeline';
import { useTimelineRecommendations } from '@/hooks/use-timeline-recommendations';
import { TimelineRecommendationsPanel } from '@/components/recommendations/timeline-recommendations-panel';
import type { TimelineRecommendation } from '@project/shared';

export function TimelineRecommendationsPanelWrapper() {
  const { selectedClipId, removeClip, timeline, refreshTimeline } =
    useTimeline();
  const {
    recommendations,
    isLoading,
    acceptRecommendation,
    dismissRecommendation,
    refreshRecommendations,
  } = useTimelineRecommendations();

  const effectiveClipId = useMemo(() => {
    if (selectedClipId) {
      return selectedClipId;
    }
    if (timeline && timeline.clips.length > 0) {
      const sortedClips = [...timeline.clips].sort((a, b) => a.order - b.order);
      return sortedClips[sortedClips.length - 1].id;
    }
    return null;
  }, [selectedClipId, timeline]);

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
    if (!effectiveClipId) {
      alert('No clip available to replace');
      return;
    }
    try {
      await removeClip(effectiveClipId);
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
      await refreshRecommendations();
    } catch (error) {
      console.error('Failed to refresh recommendations:', error);
    }
  };

  return (
    <TimelineRecommendationsPanel
      recommendations={recommendations}
      isLoading={isLoading}
      onAdd={handleAdd}
      onReplace={handleReplace}
      onDismiss={handleDismiss}
      onMoreLikeThis={handleRefresh}
    />
  );
}
