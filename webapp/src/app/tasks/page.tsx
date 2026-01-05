'use client';

import React from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { TaskProvider } from '@/contexts/task-context';
import { useTasks } from '@/hooks/use-tasks';
import { TaskMonitor } from '@/components/task';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import Link from 'next/link';

function TasksPageContent() {
    const { tasks, isLoading: tasksLoading } = useTasks();
    const { currentWorkspace } = useWorkspace();

    if (!currentWorkspace) {
        return null;
    }

    return (
        <div className="container mx-auto px-4 py-8 max-w-4xl">
            {/* Page Header */}
            <div className="mb-8">
                <h1 className="text-4xl font-bold text-foreground mb-2">Background Tasks</h1>
                <p className="text-lg text-muted-foreground">
                    Monitor and manage background operations in {currentWorkspace.name}
                </p>
            </div>

            <TaskMonitor tasks={tasks} isLoading={tasksLoading} />
        </div>
    );
}

export default function TasksPage() {
    const { isAuthenticated, isLoading: authLoading } = useAuth();
    const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

    // Show loading state
    if (authLoading || workspaceLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    // Redirect to login if not authenticated
    if (!isAuthenticated) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Authentication Required</AlertTitle>
                    <AlertDescription>
                        Please{' '}
                        <Link href="/login" className="underline">
                            log in
                        </Link>{' '}
                        to access tasks.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    // Show workspace selection prompt if no workspace selected
    if (!currentWorkspace) {
        return (
            <div className="container mx-auto px-4 py-8 max-w-4xl">
                <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Workspace Required</AlertTitle>
                    <AlertDescription>
                        Please select a workspace from the navigation bar to view tasks.
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    return (
        <TaskProvider workspaceId={currentWorkspace.id}>
            <TasksPageContent />
        </TaskProvider>
    );
}
