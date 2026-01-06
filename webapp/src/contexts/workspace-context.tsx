'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import type { Workspace, WorkspaceMember } from '@project/shared';
import { WorkspaceService } from '@/services/workspace';
import pb from '@/lib/pocketbase-client';
import { useAuth } from '@/hooks/use-auth';

interface WorkspaceContextType {
  // Current workspace state
  currentWorkspace: Workspace | null;
  workspaces: WorkspaceMember[];
  isLoading: boolean;
  error: string | null;

  // Workspace operations
  switchWorkspace: (workspaceId: string) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  clearError: () => void;

  // Computed values
  hasWorkspaces: boolean;
  currentMembership: WorkspaceMember | null;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(
  undefined
);

interface WorkspaceProviderProps {
  children: React.ReactNode;
}

export function WorkspaceProvider({ children }: WorkspaceProviderProps) {
  // State
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Auth context
  const { user, isAuthenticated } = useAuth();

  // Create workspace service - memoized to prevent recreation
  const workspaceService = useMemo(() => new WorkspaceService(pb), []);

  // Clear error helper
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Error handler
  const handleError = useCallback((error: unknown, operation: string) => {
    console.error(`Workspace ${operation} error:`, error);
    const message =
      error instanceof Error
        ? error.message
        : `Failed to ${operation} workspace`;
    setError(message);
  }, []);

  // Load user's workspaces
  const loadWorkspaces = useCallback(async () => {
    if (!user || !isAuthenticated) {
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    clearError();

    try {
      const userWorkspaces = await workspaceService.getUserWorkspaces(user.id);
      setWorkspaces(userWorkspaces);

      // Check if we need to set a workspace (only on initial load)
      setCurrentWorkspace((prev) => {
        // If we already have a workspace, don't change it
        if (prev) return prev;

        // Try to restore from localStorage first
        const storedWorkspaceId = localStorage.getItem('currentWorkspaceId');
        if (storedWorkspaceId) {
          const storedMembership = userWorkspaces.find(
            (m) => m.expand?.WorkspaceRef?.id === storedWorkspaceId
          );
          if (storedMembership?.expand?.WorkspaceRef) {
            return storedMembership.expand.WorkspaceRef;
          }
        }

        // Otherwise, set the first workspace
        if (userWorkspaces.length > 0) {
          const firstWorkspace = userWorkspaces[0].expand?.WorkspaceRef;
          if (firstWorkspace) {
            localStorage.setItem('currentWorkspaceId', firstWorkspace.id);
            return firstWorkspace;
          }
        }

        return prev;
      });
    } catch (error) {
      handleError(error, 'load');
    } finally {
      setIsLoading(false);
    }
  }, [user, isAuthenticated, workspaceService, clearError, handleError]);

  // Refresh workspaces
  const refreshWorkspaces = useCallback(async () => {
    await loadWorkspaces();
  }, [loadWorkspaces]);

  // Switch to a different workspace
  const switchWorkspace = useCallback(
    async (workspaceId: string) => {
      if (!user) throw new Error('Not authenticated');

      clearError();
      setIsLoading(true);

      try {
        // Verify user has membership in this workspace
        const membership = await workspaceService.getMembership(
          user.id,
          workspaceId
        );

        if (!membership) {
          throw new Error('You do not have access to this workspace');
        }

        // Get the full workspace details
        const workspace = await workspaceService.getWorkspace(workspaceId);

        if (!workspace) {
          throw new Error('Workspace not found');
        }

        setCurrentWorkspace(workspace);
        // Store in localStorage for persistence
        localStorage.setItem('currentWorkspaceId', workspaceId);
      } catch (error) {
        handleError(error, 'switch');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [user, workspaceService, clearError, handleError]
  );

  // Computed values
  const hasWorkspaces = workspaces.length > 0;

  const currentMembership = useMemo(() => {
    if (!currentWorkspace) return null;
    return (
      workspaces.find(
        (m) => m.expand?.WorkspaceRef?.id === currentWorkspace.id
      ) || null
    );
  }, [currentWorkspace, workspaces]);

  // Initialize workspaces when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      loadWorkspaces();
    } else {
      // Clear workspaces when not authenticated
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setIsLoading(false);
      localStorage.removeItem('currentWorkspaceId');
    }
  }, [isAuthenticated, user, loadWorkspaces]);

  const value: WorkspaceContextType = {
    // State
    currentWorkspace,
    workspaces,
    isLoading,
    error,

    // Operations
    switchWorkspace,
    refreshWorkspaces,
    clearError,

    // Computed values
    hasWorkspaces,
    currentMembership,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// Export the context for use in the hook
export { WorkspaceContext };
