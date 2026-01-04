'use client';

import { useWorkspace } from '@/hooks/use-workspace';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Building2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceSelectorProps {
  className?: string;
}

export function WorkspaceSelector({ className }: WorkspaceSelectorProps) {
  const {
    currentWorkspace,
    workspaces,
    isLoading,
    switchWorkspace,
    hasWorkspaces,
  } = useWorkspace();

  const handleWorkspaceChange = async (workspaceId: string) => {
    try {
      await switchWorkspace(workspaceId);
    } catch (error) {
      console.error('Failed to switch workspace:', error);
    }
  };

  if (isLoading) {
    return <Skeleton className={cn('h-10 w-48', className)} />;
  }

  if (!hasWorkspaces) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 text-sm text-gray-500',
          className
        )}
      >
        <Building2 className="h-4 w-4" />
        <span>No workspaces</span>
      </div>
    );
  }

  return (
    <Select
      value={currentWorkspace?.id || ''}
      onValueChange={handleWorkspaceChange}
    >
      <SelectTrigger className={cn('w-48', className)}>
        <Building2 className="h-4 w-4 mr-2" />
        <SelectValue placeholder="Select workspace" />
      </SelectTrigger>
      <SelectContent>
        {workspaces.map((membership) => {
          const workspace = membership.expand?.WorkspaceRef;
          if (!workspace) return null;

          return (
            <SelectItem key={workspace.id} value={workspace.id}>
              <div className="flex flex-col">
                <span>{workspace.name}</span>
                {workspace.slug && (
                  <span className="text-xs text-gray-500">
                    @{workspace.slug}
                  </span>
                )}
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
