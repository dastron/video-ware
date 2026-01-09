'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import type { MediaRecommendation } from '@project/shared';
import {
  LabelType,
  RecommendationStrategy,
  TaskType,
  TaskStatus,
} from '@project/shared';
import { MediaRecommendationMutator, TaskMutator } from '@project/shared';
import pb from '@/lib/pocketbase-client';
import type { RecordSubscription } from 'pocketbase';

interface MediaRecommendationContextType {
  // State
  recommendations: MediaRecommendation[];
  isLoading: boolean;
  error: string | null;

  // Filtering state
  selectedLabelTypes: LabelType[];

  // Operations
  fetchRecommendations: (mediaId: string) => Promise<void>;
  filterByLabelType: (labelType: LabelType) => void;
  clearLabelTypeFilter: () => void;
  setLabelTypeFilter: (labelTypes: LabelType[]) => void;
  generateRecommendations: (
    params: GenerateMediaRecommendationsParams
  ) => Promise<void>;

  // Real-time updates
  isConnected: boolean;

  // Utility methods
  refreshRecommendations: () => Promise<void>;
  clearError: () => void;
}

interface GenerateMediaRecommendationsParams {
  mediaId: string;
  strategies?: RecommendationStrategy[];
  strategyWeights?: Record<RecommendationStrategy, number>;
  filterParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
  };
  maxResults?: number;
}

const MediaRecommendationContext = createContext<
  MediaRecommendationContextType | undefined
>(undefined);

interface MediaRecommendationProviderProps {
  mediaId?: string;
  children: React.ReactNode;
}

export function MediaRecommendationProvider({
  mediaId,
  children,
}: MediaRecommendationProviderProps) {
  // State
  const [recommendations, setRecommendations] = useState<MediaRecommendation[]>(
    []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [selectedLabelTypes, setSelectedLabelTypes] = useState<LabelType[]>([]);

  // Refs for cleanup and tracking
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const currentMediaIdRef = useRef<string | undefined>(mediaId);

  // Create mutator - memoized to prevent recreation
  const mutator = useMemo(() => new MediaRecommendationMutator(pb), []);
  const taskMutator = useMemo(() => new TaskMutator(pb), []);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Media recommendation ${operation} error:`, error);
    const message =
      error instanceof Error
        ? error.message
        : `Failed to ${operation} media recommendations`;
    setError(message);
  }, []);

  // Load recommendations from server
  const fetchRecommendations = useCallback(
    async (targetMediaId: string) => {
      if (!targetMediaId) {
        setRecommendations([]);
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        // Fetch recommendations with optional label type filtering
        let result;
        if (selectedLabelTypes.length > 0) {
          // Fetch for each label type and combine
          const promises = selectedLabelTypes.map((labelType) =>
            mutator.getByMediaAndLabelType(targetMediaId, labelType, 1, 100)
          );
          const results = await Promise.all(promises);
          const allItems = results.flatMap((r) => r.items);

          // Sort by rank and start time
          allItems.sort((a, b) => {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.start - b.start;
          });

          setRecommendations(allItems);
        } else {
          // Fetch all recommendations for the media
          result = await mutator.getByMedia(targetMediaId, {}, 1, 100);
          setRecommendations(result.items);
        }
      } catch (error) {
        handleError(error, 'fetch');
        setRecommendations([]);
      } finally {
        setIsLoading(false);
      }
    },
    [mutator, selectedLabelTypes, clearError, handleError]
  );

  // Refresh recommendations
  const refreshRecommendations = useCallback(async () => {
    if (currentMediaIdRef.current) {
      await fetchRecommendations(currentMediaIdRef.current);
    }
  }, [fetchRecommendations]);

  // Filter by label type (toggle)
  const filterByLabelType = useCallback((labelType: LabelType) => {
    setSelectedLabelTypes((prev) => {
      if (prev.includes(labelType)) {
        // Remove if already selected
        return prev.filter((t) => t !== labelType);
      } else {
        // Add if not selected
        return [...prev, labelType];
      }
    });
  }, []);

  // Clear label type filter
  const clearLabelTypeFilter = useCallback(() => {
    setSelectedLabelTypes([]);
  }, []);

  // Set label type filter (replace)
  const setLabelTypeFilter = useCallback((labelTypes: LabelType[]) => {
    setSelectedLabelTypes(labelTypes);
  }, []);

  // Generate recommendations by creating a task
  const generateRecommendations = useCallback(
    async (params: GenerateMediaRecommendationsParams) => {
      const { mediaId, strategies, strategyWeights, filterParams, maxResults } =
        params;

      if (!mediaId) {
        setError('Media ID is required to generate recommendations');
        return;
      }

      setIsLoading(true);
      clearError();

      try {
        // Get current user
        const user = pb.authStore.model;
        if (!user) {
          throw new Error(
            'User must be authenticated to generate recommendations'
          );
        }

        // Get workspace from media (assuming we have access to it)
        // For now, we'll need to fetch the media to get the workspace
        const media = await pb.collection('Media').getOne(mediaId);
        const workspaceId = media.WorkspaceRef;

        // Create task with payload
        await taskMutator.create({
          sourceType: 'media',
          sourceId: mediaId,
          type: TaskType.GENERATE_MEDIA_RECOMMENDATIONS,
          status: TaskStatus.QUEUED,
          progress: 1,
          attempts: 1,
          priority: 0,
          payload: {
            workspaceId,
            mediaId,
            strategies: strategies || [
              RecommendationStrategy.SAME_ENTITY,
              RecommendationStrategy.ADJACENT_SHOT,
              RecommendationStrategy.TEMPORAL_NEARBY,
              RecommendationStrategy.CONFIDENCE_DURATION,
            ],
            strategyWeights,
            filterParams,
            maxResults: maxResults || 20,
          },
          WorkspaceRef: workspaceId,
          UserRef: user.id,
        });

        // The task will be picked up by the worker and recommendations will
        // appear via real-time subscription
      } catch (error) {
        handleError(error, 'generate');
      } finally {
        setIsLoading(false);
      }
    },
    [taskMutator, clearError, handleError]
  );

  // Real-time subscription management
  const subscribe = useCallback(async (targetMediaId: string) => {
    if (!targetMediaId || unsubscribeRef.current) return;

    try {
      // Subscribe to MediaRecommendations collection changes for this media
      const unsubscribe = await new Promise<() => void>((resolve) => {
        pb.collection('MediaRecommendations')
          .subscribe(
            '*',
            async (data: RecordSubscription<MediaRecommendation>) => {
              // Only handle updates for this media
              if (data.record.MediaRef !== targetMediaId) return;

              // Handle real-time updates
              if (data.action === 'create') {
                setRecommendations((prev) => {
                  // Avoid duplicates
                  const exists = prev.some((r) => r.id === data.record.id);
                  if (exists) return prev;

                  // Add and re-sort by rank and start time
                  const updated = [...prev, data.record];
                  updated.sort((a, b) => {
                    if (a.rank !== b.rank) return a.rank - b.rank;
                    return a.start - b.start;
                  });
                  return updated;
                });
              } else if (data.action === 'update') {
                setRecommendations((prev) => {
                  const updated = prev.map((r) =>
                    r.id === data.record.id ? data.record : r
                  );
                  // Re-sort in case rank changed
                  updated.sort((a, b) => {
                    if (a.rank !== b.rank) return a.rank - b.rank;
                    return a.start - b.start;
                  });
                  return updated;
                });
              } else if (data.action === 'delete') {
                setRecommendations((prev) =>
                  prev.filter((r) => r.id !== data.record.id)
                );
              }
            },
            {
              expand: 'WorkspaceRef,MediaRef,MediaClipRef',
            }
          )
          .then(() => {
            setIsConnected(true);
            return () => {
              pb.collection('MediaRecommendations').unsubscribe('*');
              setIsConnected(false);
            };
          });

        // Return the unsubscribe function
        resolve(() => {
          pb.collection('MediaRecommendations').unsubscribe('*');
          setIsConnected(false);
        });
      });

      unsubscribeRef.current = unsubscribe;
      setIsConnected(true);
    } catch (error) {
      console.error('Media recommendation subscription error:', error);
      setIsConnected(false);
    }
  }, []);

  const unsubscribe = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      setIsConnected(false);
    }
  }, []);

  // Initialize recommendations when mediaId changes
  useEffect(() => {
    currentMediaIdRef.current = mediaId;

    if (mediaId) {
      fetchRecommendations(mediaId);
      subscribe(mediaId);
    } else {
      // Clear recommendations when no media
      setRecommendations([]);
      setIsLoading(false);
      unsubscribe();
    }

    return () => {
      unsubscribe();
    };
  }, [mediaId, fetchRecommendations, subscribe, unsubscribe]);

  // Re-fetch when label type filter changes
  useEffect(() => {
    if (currentMediaIdRef.current) {
      fetchRecommendations(currentMediaIdRef.current);
    }
  }, [selectedLabelTypes, fetchRecommendations]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      unsubscribe();
    };
  }, [unsubscribe]);

  const value: MediaRecommendationContextType = {
    // State
    recommendations,
    isLoading,
    error,

    // Filtering state
    selectedLabelTypes,

    // Operations
    fetchRecommendations,
    filterByLabelType,
    clearLabelTypeFilter,
    setLabelTypeFilter,
    generateRecommendations,

    // Real-time updates
    isConnected,

    // Utility methods
    refreshRecommendations,
    clearError,
  };

  return (
    <MediaRecommendationContext.Provider value={value}>
      {children}
    </MediaRecommendationContext.Provider>
  );
}

// Export the context for use in the hook
export { MediaRecommendationContext };
