import type { Task } from '@project/shared';
import type { StepType } from './step.types';

/**
 * Base job data shared by all job types
 */
export interface BaseJobData {
  taskId: string;
  workspaceId: string;
}

/**
 * Parent job data that orchestrates child steps
 */
export interface ParentJobData extends BaseJobData {
  task: Task;
  stepResults: Record<string, StepResult>;
}

/**
 * Step job data for individual processing steps
 */
export interface StepJobData extends BaseJobData {
  stepType: StepType;
  parentJobId: string;
  input: StepInput;
}

/**
 * Simple job data for non-flow jobs (direct processing without parent-child structure)
 */
export interface SimpleJobData extends BaseJobData {
  task: Task;
  input: StepInput;
}

/**
 * Result of a step execution
 */
export interface StepResult {
  stepType: StepType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export type StepInput = object;
