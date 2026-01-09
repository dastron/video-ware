'use client';

import React, {
  createContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
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
  createWorkspace: (name: string, slug?: string) => Promise<Workspace>;
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
  // Initialize with stored workspace ID if available (for better persistence)
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | null>(
    null
  );
  const [workspaces, setWorkspaces] = useState<WorkspaceMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use a ref to track current workspace for synchronous access during load
  const currentWorkspaceRef = useRef<Workspace | null>(null);
  currentWorkspaceRef.current = currentWorkspace;

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
      currentWorkspaceRef.current = null;
      setIsLoading(false);
      // Don't remove localStorage key - keep it for next login
      return;
    }

    setIsLoading(true);
    clearError();

    try {
      const userWorkspaces = await workspaceService.getUserWorkspaces(user.id);
      setWorkspaces(userWorkspaces);

      // Priority 1: Check localStorage first
      const storedWorkspaceId = localStorage.getItem('currentWorkspaceId');
      let workspaceToSet: Workspace | null = null;

      if (storedWorkspaceId) {
        // Try to find the stored workspace in the user's workspaces
        const storedMembership = userWorkspaces.find(
          (m) => m.expand?.WorkspaceRef?.id === storedWorkspaceId
        );
        if (storedMembership?.expand?.WorkspaceRef) {
          // Found the stored workspace in the expanded list
          workspaceToSet = storedMembership.expand.WorkspaceRef;
        } else {
          // Check if the workspace ID is in any membership (maybe expand failed)
          const membershipWithId = userWorkspaces.find(
            (m) => m.WorkspaceRef === storedWorkspaceId
          );
          if (membershipWithId) {
            // Workspace ID exists in membership but wasn't expanded - fetch it directly
            try {
              const workspace =
                await workspaceService.getWorkspace(storedWorkspaceId);
              if (workspace) {
                workspaceToSet = workspace;
              }
            } catch (error) {
              console.error('Failed to fetch stored workspace:', error);
              // Don't remove localStorage key - keep it even if fetch fails
            }
          }
        }
      }

      // Priority 2: If no stored workspace found, use current workspace from state if valid
      if (!workspaceToSet && currentWorkspaceRef.current) {
        const prevWorkspace = currentWorkspaceRef.current;
        const stillValid = userWorkspaces.some(
          (m) => m.expand?.WorkspaceRef?.id === prevWorkspace.id
        );
        if (stillValid) {
          workspaceToSet = prevWorkspace;
        }
      }

      // Priority 3: If still no workspace, set the first one as default (only if no stored ID exists)
      if (!workspaceToSet && !storedWorkspaceId && userWorkspaces.length > 0) {
        const firstWorkspace = userWorkspaces[0].expand?.WorkspaceRef;
        if (firstWorkspace) {
          workspaceToSet = firstWorkspace;
        }
      }

      // Set the workspace (only if it's different from current to avoid unnecessary updates)
      if (
        workspaceToSet &&
        workspaceToSet.id !== currentWorkspaceRef.current?.id
      ) {
        setCurrentWorkspace(workspaceToSet);
        currentWorkspaceRef.current = workspaceToSet;
      } else if (!workspaceToSet && currentWorkspaceRef.current) {
        // Clear workspace if we don't have a valid one
        setCurrentWorkspace(null);
        currentWorkspaceRef.current = null;
      } else if (!workspaceToSet && userWorkspaces.length === 0) {
        // No workspaces available
        setCurrentWorkspace(null);
        currentWorkspaceRef.current = null;
      }
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
        // localStorage will be updated by useEffect when currentWorkspace changes
      } catch (error) {
        handleError(error, 'switch');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [user, workspaceService, clearError, handleError]
  );

  // Create a new workspace and add the current user as a member
  const createWorkspace = useCallback(
    async (name: string, slug?: string): Promise<Workspace> => {
      if (!user) throw new Error('Not authenticated');

      clearError();
      setIsLoading(true);

      try {
        // Create workspace with membership
        const { workspace } =
          await workspaceService.createWorkspaceWithMembership(
            { name, slug },
            user.id
          );

        // Refresh workspaces list to include the new one
        await loadWorkspaces();

        // Switch to the newly created workspace
        setCurrentWorkspace(workspace);
        // localStorage will be updated by useEffect when currentWorkspace changes

        return workspace;
      } catch (error) {
        handleError(error, 'create');
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [user, workspaceService, clearError, handleError, loadWorkspaces]
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

  // Sync currentWorkspace to localStorage whenever it changes
  useEffect(() => {
    if (currentWorkspace) {
      localStorage.setItem('currentWorkspaceId', currentWorkspace.id);
    }
    // Don't remove the key if currentWorkspace is null - keep the last selected workspace
  }, [currentWorkspace]);

  // Initialize workspaces when authenticated
  useEffect(() => {
    if (isAuthenticated && user) {
      loadWorkspaces();
    } else {
      // Clear workspaces when not authenticated
      setWorkspaces([]);
      setCurrentWorkspace(null);
      setIsLoading(false);
      // Don't remove localStorage key - keep it for next login
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
    createWorkspace,
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
