/**
 * Flow definition types for BullMQ FlowProducer
 * Shared across all flow builders
 */

import type { Task } from '@project/shared';
import type {
  TranscodeStepType,
  RenderStepType,
  DetectLabelsStepType,
  RecommendationStepType,
} from '../types/step.types';

/**
 * Base job data shared across all jobs
 */
export interface BaseJobData {
  taskId: string;
  workspaceId: string;
  attemptNumber: number;
}

/**
 * Parent job data structure
 */
export interface ParentJobData extends BaseJobData {
  task: Task;
  stepResults: Record<string, any>;
}

/**
 * Child job options
 */
export interface ChildJobOpts {
  attempts: number;
  backoff: {
    type: 'exponential';
    delay: number;
  };
}

/**
 * Child job dependency reference
 */
export interface ChildJobDependency {
  name: string;
  queueName: string;
}

// ============================================================================
// Transcode Flow Types
// ============================================================================

export interface TranscodeFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: TranscodeChildJobDefinition[];
}

export interface TranscodeChildJobDefinition {
  name: TranscodeStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    attemptNumber: number;
    stepType: TranscodeStepType;
    parentJobId: string;
    input: any;
  };
  opts: ChildJobOpts;
  children?: ChildJobDependency[];
}

// ============================================================================
// Render Flow Types
// ============================================================================

export interface RenderFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: RenderChildJobDefinition[];
}

export interface RenderChildJobDefinition {
  name: RenderStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    attemptNumber: number;
    stepType: RenderStepType;
    parentJobId: string;
    input: any;
  };
  opts: ChildJobOpts;
  children?: ChildJobDependency[];
}

// ============================================================================
// Labels Flow Types
// ============================================================================

export interface LabelsFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: LabelsChildJobDefinition[];
}

export interface LabelsChildJobDefinition {
  name: DetectLabelsStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    attemptNumber: number;
    stepType: DetectLabelsStepType;
    parentJobId: string;
    input: any;
  };
  opts: ChildJobOpts;
  children?: ChildJobDependency[];
}

// ============================================================================
// Recommendations Flow Types
// ============================================================================

export interface RecommendationsFlowDefinition {
  name: string;
  queueName: string;
  data: ParentJobData;
  children: RecommendationsChildJobDefinition[];
}

export interface RecommendationsChildJobDefinition {
  name: RecommendationStepType;
  queueName: string;
  data: {
    taskId: string;
    workspaceId: string;
    attemptNumber: number;
    stepType: RecommendationStepType;
    parentJobId: string;
    input: any;
  };
  opts: ChildJobOpts;
  children?: ChildJobDependency[];
}

// ============================================================================
// Union Types
// ============================================================================

export type FlowDefinition =
  | TranscodeFlowDefinition
  | RenderFlowDefinition
  | LabelsFlowDefinition
  | RecommendationsFlowDefinition;
