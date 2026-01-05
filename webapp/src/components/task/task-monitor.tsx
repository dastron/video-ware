'use client';

import type { Task } from '@project/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  AlertCircle,
  RefreshCw,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTasks } from '@/hooks/use-tasks';
import { Button } from '@/components/ui/button';

interface TaskMonitorProps {
  tasks: Task[];
  isLoading?: boolean;
  className?: string;
}

export function TaskMonitor({
  tasks,
  isLoading = false,
  className,
}: TaskMonitorProps) {
  const { retryTask, cancelTask } = useTasks();
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />;
      case 'queued':
        return <Clock className="h-5 w-5 text-gray-400" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-400" />;
    }
  };

  const getStatusBadgeVariant = (
    status: string
  ): 'default' | 'secondary' | 'destructive' | 'outline' => {
    switch (status) {
      case 'success':
        return 'default';
      case 'failed':
        return 'destructive';
      case 'running':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  const formatTaskType = (type: string): string => {
    return type
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
        </CardHeader>
        <CardContent className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <span>Background Tasks</span>
            <Badge variant="secondary">{tasks.length}</Badge>
          </CardTitle>
        </div>
      </CardHeader>

      <CardContent>
        {tasks.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Clock className="h-6 w-6" />
              </EmptyMedia>
              <EmptyTitle>No active tasks</EmptyTitle>
              <EmptyDescription>
                Background tasks will appear here when processing uploads
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-4">
            {tasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'p-4 border rounded-lg space-y-3',
                  task.status === 'failed' && 'border-red-200 bg-red-50'
                )}
              >
                {/* Task header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {/* Status icon */}
                    <div className="flex-shrink-0 mt-0.5">
                      {getStatusIcon(task.status as string)}
                    </div>

                    {/* Task info */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">
                          {formatTaskType(task.type)}
                        </p>
                        <Badge
                          variant={getStatusBadgeVariant(task.status as string)}
                        >
                          {task.status}
                        </Badge>
                      </div>

                      {/* Task metadata */}
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <span>{formatDate(task.created)}</span>
                        {task.attempts > 0 && (
                          <>
                            <span>•</span>
                            <span>Attempt {task.attempts}</span>
                          </>
                        )}
                        {task.provider && (
                          <>
                            <span>•</span>
                            <span className="capitalize">{task.provider}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Progress percentage or actions */}
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {task.status === 'running' && (
                      <div className="text-sm font-medium text-gray-600">
                        {task.progress}%
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      {(task.status === 'failed' ||
                        task.status === 'canceled') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-500 hover:text-blue-600"
                          onClick={() => retryTask(task.id)}
                          title="Retry task"
                        >
                          <RefreshCw className="h-4 w-4" />
                        </Button>
                      )}

                      {(task.status === 'queued' ||
                        task.status === 'running') && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-gray-500 hover:text-red-600"
                          onClick={() => cancelTask(task.id)}
                          title="Cancel task"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Progress bar for running tasks */}
                {task.status === 'running' && (
                  <Progress value={task.progress} className="h-2" />
                )}

                {/* Error log for failed tasks */}
                {task.status === 'failed' && task.errorLog && (
                  <div className="flex items-start gap-2 p-2 bg-red-100 border border-red-200 rounded">
                    <AlertCircle className="h-4 w-4 text-red-600 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-red-700">{task.errorLog}</p>
                  </div>
                )}

                {/* Processor version for completed tasks */}
                {task.status === 'success' && task.version && (
                  <div className="text-xs text-gray-500">
                    Processed with {task.version}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
